import type { BrowserProvider, ContractRunner, Eip1193Provider, JsonRpcSigner } from "ethers";
import {
  CCTS,
  CHAINS,
  MESSAGE_TRANSMITTER,
  ROUTES,
  TOKEN_MESSENGER_V2,
  TOKEN_MINTER_V2,
  WRAP_MAX_RESERVE,
  WRAP_MIN_LEFT,
  cctpxFeeJumped,
  feeNeedsConfirm,
  finality,
  fastAllowed,
  fastLabel,
  maxFillNote,
  maxFillReserve,
  maxFillSuffix,
  quoteStillMatches,
  routeLabel,
  selfMintLocked,
  spendError,
  transferMode,
  usdcMaxFee,
  validEntry,
  type AddressEntry,
  type ChainId,
  type QuoteSelection,
  type Route,
  type RouteKey
} from "./logic.js";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    ethers: typeof import("ethers");
  }
}

// Refuse to run inside a frame (clickjacking protection when the page is hosted somewhere).
if (window.top !== window.self) {
  document.body.textContent = "This page must not be embedded in another site. Open it directly.";
  throw new Error("framed");
}

const ethers = window.ethers;

// The ABI strings are the contract surface. ethers types every method as optional under strict index checks.
interface DynContract {
  balanceOf(...args: any[]): Promise<any>;
  allowance(...args: any[]): Promise<any>;
  approve(...args: any[]): Promise<any>;
  localMinter(...args: any[]): Promise<any>;
  resolveTokenManager(...args: any[]): Promise<any>;
  resolveTokenAddress(...args: any[]): Promise<any>;
  deposit(...args: any[]): Promise<any>;
  receiveMessage(...args: any[]): Promise<any>;
  depositForBurn(...args: any[]): Promise<any>;
  crossChainTransfer(...args: any[]): Promise<any>;
}

function contract(address: string, abi: readonly string[], runner: ContractRunner): DynContract {
  return new ethers.Contract(address, [...abi], runner) as unknown as DynContract;
}
const IRIS = "https://iris-api.circle.com";

const MESSENGER = [
  "function localMinter() view returns (address)",
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)"
];
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];
const SERVICE = [
  "function resolveTokenManager(bytes32) view returns (address)",
  "function resolveTokenAddress(bytes32) view returns (address)",
  "function crossChainTransfer(bytes32 tokenId, uint256 amount, uint32 destinationDomain, bytes destinationAddress, bytes32 destinationCaller, uint32 minFinalityThreshold, (bytes signedQuote, address refundAddress) claim, bool autoExecuteHookData, bytes hookData) payable"
];

interface CctpxQuote {
  feeTotalAmount: string;
  signedQuote: string;
  expiry?: { mode?: string; expiresAtBlock?: number; expiresAt?: number };
}

interface UsdcQuote {
  maxFee: bigint;
}

interface Pending {
  selection: QuoteSelection;
  body: UsdcQuote | CctpxQuote;
}

interface Recipient {
  address: string;
  self: boolean;
  label: string;
}

interface Attestation {
  message: string;
  attestation: string;
}

let provider: BrowserProvider | undefined;
let signer: JsonRpcSigner | undefined;
let me: string | undefined;
let pending: Pending | null = null;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

const log = (m: string): void => {
  el<HTMLElement>("log").textContent += m + "\n";
};

function isRouteKey(key: string): key is RouteKey {
  return Object.prototype.hasOwnProperty.call(ROUTES, key);
}

const route = (): Route => {
  const key = el<HTMLSelectElement>("route").value;
  if (!isRouteKey(key)) throw new Error("Unknown route.");
  return ROUTES[key];
};

const fmtAddr = (a: string): string => a.slice(0, 6) + "…" + a.slice(-4);

function errText(e: unknown): string {
  if (typeof e === "object" && e !== null && "shortMessage" in e) {
    const short = e.shortMessage;
    if (typeof short === "string" && short) return short;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

function errorCode(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "code" in e && typeof e.code === "number")
    return e.code;
  return undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

function wallet(): { provider: BrowserProvider; signer: JsonRpcSigner; me: string } {
  if (!provider || !signer || !me) throw new Error("Connect your wallet first.");
  return { provider, signer, me };
}

function ethereum(): Eip1193Provider {
  if (!window.ethereum) throw new Error("No wallet found in this browser (Rabby, MetaMask…).");
  return window.ethereum;
}

function cctpxRoute(r: Route): Route & { tokenId: string } {
  if (r.kind !== "cctpx" || !r.tokenId) throw new Error("Not a CCTPx route.");
  return { ...r, tokenId: r.tokenId };
}

// ---------------------------------------------------------------- one action at a time

// Every action runs under a lock: all buttons are disabled until it finishes, so a double click
// cannot send two transactions. Actions only record which buttons should be enabled afterwards.
const BUTTONS = ["connect", "max", "wrap", "quote", "approve", "send", "resume", "abAdd"] as const;
type ButtonId = (typeof BUTTONS)[number];

const want: Record<ButtonId, boolean> = {
  connect: true,
  max: true,
  abAdd: true,
  wrap: false,
  quote: false,
  approve: false,
  send: false,
  resume: false
};
let busy = false;

function setBtn(id: ButtonId, on: boolean): void {
  want[id] = on;
  if (!busy) el<HTMLButtonElement>(id).disabled = !on;
}

function applyButtons(): void {
  for (const id of BUTTONS) el<HTMLButtonElement>(id).disabled = busy || !want[id];
  for (const id of ["route", "rcpt", "amt", "resumeHash"])
    el<HTMLInputElement | HTMLSelectElement>(id).disabled = busy;
  const r = route();
  el<HTMLInputElement>("selfMint").disabled = busy || selfMintLocked(r);
  el<HTMLInputElement>("fast").disabled = busy || !fastAllowed(r);
  el<HTMLElement>("fastLabel").textContent = fastLabel(r);
  for (const b of document.querySelectorAll<HTMLButtonElement>("#abList button")) b.disabled = busy;
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  applyButtons();
  try {
    await fn();
  } catch (e) {
    log("ERROR: " + errText(e));
  } finally {
    busy = false;
    applyButtons();
  }
}

const onClick = (id: ButtonId, fn: () => Promise<void>): void => {
  el<HTMLButtonElement>(id).onclick = () => void run(fn);
};

// Get fee stores this snapshot on `pending`, next to the quote body.
function quoteSelection(amount: bigint, to: Recipient): QuoteSelection {
  const r = route();
  const { fast, selfMint } = transferMode(r, {
    fast: el<HTMLInputElement>("fast").checked,
    selfMint: el<HTMLInputElement>("selfMint").checked
  });
  return { key: el<HTMLSelectElement>("route").value, amount, to: to.address, fast, selfMint };
}

// ---------------------------------------------------------------- address book

const AB_KEY = "circle-cctp-bridge.addressBook";

function loadBook(): AddressEntry[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(localStorage.getItem(AB_KEY) || "[]");
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw)) return [];
  const parsed = raw.map((e) =>
    validEntry(e as { address?: unknown; label?: unknown }, ethers.getAddress)
  );
  const ok = parsed.flatMap((e) => (e.ok ? [e.entry] : []));
  if (ok.length !== raw.length)
    log(
      `Ignored ${raw.length - ok.length} invalid address book entr${raw.length - ok.length === 1 ? "y" : "ies"}.`
    );
  return ok;
}

function saveBook(b: AddressEntry[]): void {
  try {
    localStorage.setItem(AB_KEY, JSON.stringify(b));
  } catch {
    log("Could not save the address book in this browser.");
  }
}

let book = loadBook();

function renderBook(): void {
  const list = el<HTMLElement>("abList");
  list.textContent = "";
  book.forEach((e, i) => {
    const div = document.createElement("div");
    div.className = "ab-item";
    const code = document.createElement("code");
    code.textContent = `${e.label} — ${e.address}`;
    const del = document.createElement("button");
    del.className = "small";
    del.textContent = "Remove";
    del.disabled = busy;
    del.onclick = () => {
      if (busy) return;
      book.splice(i, 1);
      saveBook(book);
      renderBook();
      renderRecipients();
    };
    div.append(code, del);
    list.append(div);
  });
}

function renderRecipients(): void {
  const rcpt = el<HTMLSelectElement>("rcpt");
  const keep = rcpt.value;
  rcpt.textContent = "";
  const opt = (value: string, text: string): void => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    rcpt.append(o);
  };
  opt("self", me ? `This wallet — ${me}` : "This wallet (connect first)");
  book.forEach((e) => opt(e.address, `Saved: ${e.label} — ${e.address}`));
  if ([...rcpt.options].some((o) => o.value === keep)) rcpt.value = keep;
  showRecipientInfo();
}

function showRecipientInfo(): void {
  el<HTMLElement>("rcptInfo").textContent =
    el<HTMLSelectElement>("rcpt").value === "self"
      ? "Funds arrive at the same address on the destination network."
      : "⚠️ Funds go to a different address than the connected wallet. Check that you control it on the destination network.";
}

el<HTMLButtonElement>("abAdd").onclick = () => {
  if (busy) return;
  const result = validEntry(
    {
      label: el<HTMLInputElement>("abLabel").value,
      address: el<HTMLInputElement>("abAddr").value.trim()
    },
    ethers.getAddress
  );
  if (!result.ok) {
    log("ERROR: " + result.error);
    return;
  }
  const entry = result.entry;
  if (book.some((e) => e.address.toLowerCase() === entry.address.toLowerCase())) {
    log("This address is already in the address book.");
    return;
  }
  book.push(entry);
  saveBook(book);
  el<HTMLInputElement>("abAddr").value = "";
  el<HTMLInputElement>("abLabel").value = "";
  renderBook();
  renderRecipients();
  log(`Added to the address book: ${entry.label} — ${entry.address}`);
};
el<HTMLSelectElement>("rcpt").onchange = showRecipientInfo;

function recipient(): Recipient {
  if (!me) throw new Error("Connect your wallet first.");
  const v = el<HTMLSelectElement>("rcpt").value;
  if (v === "self") return { address: me, self: true, label: "this wallet" };
  const entry = book.find((e) => e.address === v);
  if (!entry)
    throw new Error("The recipient must be this wallet or an address from your address book.");
  return { address: ethers.getAddress(entry.address), self: false, label: entry.label };
}

// ---------------------------------------------------------------- route UI

function fillRoutes(): void {
  const sel = el<HTMLSelectElement>("route");
  sel.textContent = "";
  for (const [key, r] of Object.entries(ROUTES)) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent = routeLabel(r);
    sel.append(o);
  }
}

function showRoute(): void {
  const r = route();
  const usdc = r.kind === "usdc";
  const info = el<HTMLElement>("routeInfo");
  info.textContent = "";
  const line = (...parts: (string | { code: string })[]): void => {
    const div = document.createElement("div");
    for (const p of parts) {
      if (typeof p === "string") div.append(p);
      else {
        const c = document.createElement("code");
        c.textContent = p.code;
        div.append(c);
      }
    }
    info.append(div);
  };
  line(
    `${r.symbol} ${CHAINS[r.src.chainId].name} `,
    { code: r.src.token },
    ` → ${CHAINS[r.dst.chainId].name} `,
    { code: r.dst.token }
  );
  if (usdc) {
    const gas = maxFillNote(r);
    line(
      "Approve for Circle TokenMessengerV2 ",
      { code: TOKEN_MESSENGER_V2 },
      ", sent with depositForBurn. " +
        `You sign the mint on ${CHAINS[r.dst.chainId].name} yourself` +
        (gas ? `. ${gas}` : ` (needs a little ${CHAINS[r.dst.chainId].native} for gas).`)
    );
  } else {
    line(
      "Approve for Circle TokenManager ",
      { code: r.tokenManager },
      ", sent with CrossChainTokenService ",
      { code: CCTS },
      `. Any fee is paid in ${CHAINS[r.src.chainId].native} on ${CHAINS[r.src.chainId].name}.`
    );
  }
  const mode = transferMode(r, { fast: r.defaultFast, selfMint: r.defaultSelfMint });
  el<HTMLInputElement>("fast").checked = mode.fast;
  el<HTMLInputElement>("selfMint").checked = mode.selfMint;
  el<HTMLElement>("sym").textContent = r.symbol;
  pending = null;
  for (const id of ["wrap", "quote", "approve", "send", "resume"] as const) setBtn(id, false);
  el<HTMLElement>("acct").textContent = "";
  el<HTMLInputElement>("amt").value = "";
  applyButtons();
}

el<HTMLSelectElement>("route").onchange = () => {
  if (!busy) showRoute();
};
fillRoutes();
renderBook();
renderRecipients();
showRoute();

function amountUnits(): bigint {
  return ethers.parseUnits((el<HTMLInputElement>("amt").value || "0").trim(), route().decimals);
}

async function ensureChain(chainId: ChainId): Promise<void> {
  const c = CHAINS[chainId];
  const eth = ethereum();
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: c.hex }]
    });
  } catch (e) {
    if (errorCode(e) === 4902 && c.add) {
      await eth.request({ method: "wallet_addEthereumChain", params: [c.add] });
    } else {
      throw e;
    }
  }
  provider = new ethers.BrowserProvider(eth);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== chainId)
    throw new Error(`The wallet is not on ${c.name} (chainId ${net.chainId}).`);
  signer = await provider.getSigner();
  me = await signer.getAddress();
}

async function refreshBalances(): Promise<bigint> {
  const { provider: p, me: who } = wallet();
  const r = route();
  const bal = await contract(r.src.token, ERC20, p).balanceOf(who);
  const gas = await p.getBalance(who);
  el<HTMLElement>("acct").textContent =
    `Sender: ${who} | ${r.symbol}: ${ethers.formatUnits(bal, r.decimals)} | ${CHAINS[r.src.chainId].native} (gas): ${ethers.formatEther(gas)}`;
  return bal;
}

async function tokenBalance(token: string): Promise<bigint> {
  const { provider: p, me: who } = wallet();
  return contract(token, ERC20, p).balanceOf(who);
}

// ---------------------------------------------------------------- actions

onClick("connect", async () => {
  const eth = ethereum();
  const r = route();
  await eth.request({ method: "eth_requestAccounts" });
  await ensureChain(r.src.chainId);
  const { provider: p, me: who } = wallet();
  // verify Circle's contracts on-chain before anything else
  if (r.kind === "usdc") {
    const lm: string = await contract(TOKEN_MESSENGER_V2, MESSENGER, p).localMinter();
    if (lm.toLowerCase() !== TOKEN_MINTER_V2.toLowerCase())
      throw new Error("TokenMessengerV2 check failed: " + lm);
  } else {
    const px = cctpxRoute(r);
    const svc = contract(CCTS, SERVICE, p);
    const tm: string = await svc.resolveTokenManager(px.tokenId);
    const ta: string = await svc.resolveTokenAddress(px.tokenId);
    if (tm.toLowerCase() !== r.tokenManager.toLowerCase())
      throw new Error("TokenManager check failed: " + tm);
    if (ta.toLowerCase() !== r.src.token.toLowerCase())
      throw new Error("Token check failed: " + ta);
  }
  renderRecipients();
  const bal = await refreshBalances();
  const reserve = maxFillReserve(r);
  el<HTMLInputElement>("amt").value = ethers.formatUnits(
    bal > reserve ? bal - reserve : 0n,
    r.decimals
  );
  setBtn("quote", true);
  setBtn("resume", true);
  setBtn("wrap", !!r.canWrap);
  setBtn("approve", false);
  setBtn("send", false);
  log(`Connected on ${CHAINS[r.src.chainId].name} as ${who}. Circle contracts verified.`);
});

onClick("max", async () => {
  if (!me || !provider) throw new Error("Click 1. Connect wallet first.");
  const r = route();
  await ensureChain(r.src.chainId);
  const { provider: p, me: who } = wallet();
  const bal = await tokenBalance(r.src.token);
  if (bal === 0n && r.canWrap) {
    // nothing wrapped yet: offer the native gas token minus a gas reserve
    const native = CHAINS[r.src.chainId].native;
    const eth = await p.getBalance(who);
    const v = eth > WRAP_MAX_RESERVE ? eth - WRAP_MAX_RESERVE : 0n;
    el<HTMLInputElement>("amt").value = ethers.formatEther(v);
    log(
      `MAX: ${ethers.formatEther(v)} ${native} to wrap (${ethers.formatEther(WRAP_MAX_RESERVE)} ${native} stays for gas).`
    );
    return;
  }
  const reserve = maxFillReserve(r);
  const v = bal > reserve ? bal - reserve : 0n;
  const shown = ethers.formatUnits(v, r.decimals);
  el<HTMLInputElement>("amt").value = shown;
  log(`MAX: ${shown} ${r.symbol}${maxFillSuffix(r)}.`);
});

onClick("wrap", async () => {
  const r = route();
  if (!r.canWrap) throw new Error("Wrapping is only for the WETH Ethereum → Arc route.");
  await ensureChain(r.src.chainId);
  const { provider: p, signer: s, me: who } = wallet();
  const amount = amountUnits();
  if (amount <= 0n) throw new Error("Enter the amount of ETH to wrap.");
  const eth = await p.getBalance(who);
  const native = CHAINS[r.src.chainId].native;
  if (eth - amount < WRAP_MIN_LEFT)
    throw new Error(`Keep at least ${ethers.formatEther(WRAP_MIN_LEFT)} ${native} for gas.`);
  const weth = contract(r.src.token, ["function deposit() payable"], s);
  const tx = await weth.deposit({ value: amount });
  log("Wrap sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
  await tx.wait();
  await refreshBalances();
  log("Wrap confirmed. Continue with 2. Get fee.");
});

interface FeeTier {
  finalityThreshold: number;
  minimumFee: number | string;
}

function isFeeTier(t: unknown, threshold: number): t is FeeTier {
  if (typeof t !== "object" || t === null || !("finalityThreshold" in t)) return false;
  return t.finalityThreshold === threshold;
}

onClick("quote", async () => {
  const r = route();
  await ensureChain(r.src.chainId);
  const { provider: p, me: who } = wallet();
  const amount = amountUnits();
  const to = recipient();
  const toMode = quoteSelection(amount, to);
  const { fast, selfMint } = toMode;
  if (amount <= 0n) throw new Error("Enter an amount.");
  setBtn("approve", false);
  setBtn("send", false);
  const why = spendError(r, amount, await tokenBalance(r.src.token));
  if (why) throw new Error(why);
  let nextQuote: UsdcQuote | CctpxQuote;
  if (r.kind === "usdc") {
    const fr = await fetch(`${IRIS}/v2/burn/USDC/fees/${r.src.domain}/${r.dst.domain}`);
    if (!fr.ok) throw new Error(await fr.text());
    const tiers: unknown = await fr.json();
    const tier = Array.isArray(tiers) ? tiers.find((t) => isFeeTier(t, finality(fast))) : undefined;
    if (!tier) throw new Error("Circle returned no fee for this transfer type.");
    const maxFee = usdcMaxFee(amount, tier.minimumFee, fast);
    nextQuote = { maxFee };
    log(
      `Circle fee: at most ${ethers.formatUnits(maxFee, 6)} USDC (${fast ? "fast" : "standard"}, you sign the mint on ${CHAINS[r.dst.chainId].name}).`
    );
  } else {
    nextQuote = await fetchCctpxQuote(r, amount, to.address, fast, selfMint);
    log(
      `Fee: ${ethers.formatEther(nextQuote.feeTotalAmount)} ${CHAINS[r.src.chainId].native} (${fast ? "fast" : "standard"}, ${selfMint ? "you sign the mint" : "Circle mints for you"}). Send fetches a fresh quote right before signing.`
    );
  }
  pending = { selection: toMode, body: nextQuote };
  log(
    `Recipient: ${to.address} on ${CHAINS[r.dst.chainId].name}${to.self ? "" : `  ← ${to.label}, a DIFFERENT address than the sender`}`
  );
  const allowance: bigint = await contract(r.src.token, ERC20, p).allowance(who, r.tokenManager);
  setBtn("approve", allowance < amount);
  setBtn("send", allowance >= amount);
  log(
    allowance >= amount
      ? "Allowance is already set, you can send."
      : "Approve first (exact amount)."
  );
});

onClick("approve", async () => {
  const r = route();
  await ensureChain(r.src.chainId);
  const { signer: s } = wallet();
  const amount = amountUnits();
  const to = recipient();
  const selection = quoteSelection(amount, to);
  if (!quoteStillMatches(pending?.selection, selection))
    throw new Error("Click 2. Get fee for this route, amount, recipient and mode first.");
  const tx = await contract(r.src.token, ERC20, s).approve(r.tokenManager, amount);
  log("Approve sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
  await tx.wait();
  log("Approve confirmed. Now 4. Send (it fetches a fresh quote if needed).");
  setBtn("approve", false);
  setBtn("send", true);
});

async function fetchCctpxQuote(
  r: Route,
  amount: bigint,
  to: string,
  fast: boolean,
  selfMint: boolean
): Promise<CctpxQuote> {
  const px = cctpxRoute(r);
  const requests: { type: string; params?: { msgType: string; destinationAddress: string } }[] =
    selfMint
      ? []
      : [{ type: "FORWARD", params: { msgType: "TransferMessage", destinationAddress: to } }];
  if (fast) requests.push({ type: "PRE_FINALITY" });
  const res = await fetch(`${IRIS}/v2/quote/cctpx/${px.tokenId}/${r.src.domain}/${r.dst.domain}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amount.toString(), feeToken: ethers.ZeroAddress, requests })
  });
  if (!res.ok) throw new Error(await res.text());
  const q: unknown = await res.json();
  if (typeof q !== "object" || q === null)
    throw new Error("Circle returned a quote without a valid fee.");
  const body = q as {
    feeTotalAmount?: unknown;
    signedQuote?: unknown;
    expiry?: CctpxQuote["expiry"];
  };
  let fee: bigint;
  try {
    fee = BigInt(body.feeTotalAmount as string | number | bigint);
  } catch {
    throw new Error("Circle returned a quote without a valid fee.");
  }
  if (fee < 0n || typeof body.signedQuote !== "string" || !body.signedQuote)
    throw new Error("Circle returned an invalid quote.");
  return {
    feeTotalAmount: fee.toString(),
    signedQuote: body.signedQuote,
    ...(body.expiry ? { expiry: body.expiry } : {})
  };
}

// Circle returns the quote validity either as a time (TIMESTAMP) or as a block number (BLOCK_NUMBER)
async function quoteValidity(q: CctpxQuote): Promise<{ ok: boolean; text: string }> {
  const { provider: p } = wallet();
  const e = q.expiry || {};
  if (e.mode === "BLOCK_NUMBER" && e.expiresAtBlock) {
    const now = await p.getBlockNumber();
    return {
      ok: e.expiresAtBlock - now >= 2,
      text: `valid for ${e.expiresAtBlock - now} more blocks`
    };
  }
  if (e.expiresAt) {
    const left = Math.round(e.expiresAt - Date.now() / 1000);
    return { ok: left >= 15, text: `valid for ${left} more seconds` };
  }
  return { ok: true, text: "no expiry given" };
}

interface CircleMessage {
  status?: string;
  message?: string;
  attestation?: string;
  decodedMessage?: { destinationDomain?: number | string; sourceDomain?: number | string };
}

// Waits for Circle's attestation and signs receiveMessage on the destination network.
// For a resumed transfer it gives up after 2 minutes if Circle does not know the hash.
async function selfMintOnDestination(r: Route, burnHash: string, resume = false): Promise<void> {
  log(
    "Waiting for Circle's attestation (a standard transfer from Ethereum takes ~15–20 min, from Arc or Avalanche seconds)..."
  );
  const url = `${IRIS}/v2/messages/${r.src.domain}?transactionHash=${burnHash}`;
  const started = Date.now();
  let msg: Attestation | undefined;
  for (let i = 0; i < 480 && !msg; i++) {
    // up to 40 min
    let res: Response | null;
    try {
      res = await fetch(url);
    } catch {
      res = null;
    }
    if (res && res.status === 404 && resume && Date.now() - started > 120000)
      throw new Error(
        `Circle does not know this transaction on ${CHAINS[r.src.chainId].name}. Check the hash and that the route above matches the transfer.`
      );
    if (res && res.ok) {
      const payload = (await res.json()) as { messages?: CircleMessage[] };
      const m = payload.messages?.[0];
      const d = m && m.decodedMessage;
      if (d && Number(d.destinationDomain) !== r.dst.domain)
        throw new Error(
          `This transfer goes to Circle domain ${d.destinationDomain}, not to ${CHAINS[r.dst.chainId].name}. Pick the matching route.`
        );
      if (d && Number(d.sourceDomain) !== r.src.domain)
        throw new Error(
          `This transfer comes from Circle domain ${d.sourceDomain}, not from ${CHAINS[r.src.chainId].name}. Pick the matching route.`
        );
      if (m && m.status === "complete" && m.message && m.attestation && m.attestation !== "PENDING")
        msg = { message: m.message, attestation: m.attestation };
    }
    if (!msg) await sleep(5000);
  }
  if (!msg)
    throw new Error(
      `No attestation within 40 min. The transfer is not lost: finish it later under "Finish a pending transfer" with hash ${burnHash}`
    );
  log(
    `Attestation ready. Switching to ${CHAINS[r.dst.chainId].name}: sign receiveMessage (the mint).`
  );
  await ensureChain(r.dst.chainId);
  const { signer: s } = wallet();
  const mt = contract(
    MESSAGE_TRANSMITTER,
    ["function receiveMessage(bytes message, bytes attestation) returns (bool)"],
    s
  );
  const rtx = await mt.receiveMessage(msg.message, msg.attestation);
  log("Mint sent: " + CHAINS[r.dst.chainId].explorer + rtx.hash);
  await rtx.wait();
  log("Mint confirmed.");
}

// Extra confirmation before funds leave for an address other than the connected wallet.
async function confirmRecipient(r: Route, to: Recipient): Promise<void> {
  if (to.self) return;
  const chainName = CHAINS[r.dst.chainId].name;
  let note = "";
  try {
    const code = await new ethers.JsonRpcProvider(CHAINS[r.dst.chainId].rpc).getCode(to.address);
    if (code !== "0x")
      note = `\n\nThis address is a smart contract on ${chainName}. Make sure it can hold ${r.symbol}.`;
  } catch {
    note = `\n\nCould not check whether this address is a smart contract on ${chainName}. Confirm you control it before sending.`;
  }
  const msg =
    `Send to "${to.label}"\n${to.address}\non ${chainName}?\n\nThis is NOT the connected wallet.` +
    note;
  if (!window.confirm(msg)) throw new Error("Cancelled.");
}

function cctpxBody(body: UsdcQuote | CctpxQuote): CctpxQuote {
  if (!("feeTotalAmount" in body))
    throw new Error("Get the fee for this route, amount, recipient and mode first.");
  return body;
}

onClick("send", async () => {
  const r = route();
  await ensureChain(r.src.chainId);
  const { signer: s, me: who } = wallet();
  const amount = amountUnits();
  const to = recipient();
  const selection = quoteSelection(amount, to);
  const { fast, selfMint } = selection;
  if (!pending || !quoteStillMatches(pending.selection, selection))
    throw new Error("Get the fee for this route, amount, recipient and mode first.");
  const why = spendError(r, amount, await tokenBalance(r.src.token));
  if (why) throw new Error(why);
  await confirmRecipient(r, to);
  if (r.kind !== "usdc") {
    // a quote is only valid for a few blocks, so fetch a fresh one right before signing
    const previous = cctpxBody(pending.body);
    const fresh = await fetchCctpxQuote(r, amount, to.address, fast, selfMint);
    const v = await quoteValidity(fresh);
    if (!v.ok) throw new Error("Circle returned an already expired quote, click Send again.");
    const fee = BigInt(fresh.feeTotalAmount);
    if (cctpxFeeJumped(BigInt(previous.feeTotalAmount), fee))
      throw new Error(
        `The fee jumped to ${ethers.formatEther(fee)}. Click 2. Get fee and check it.`
      );
    if (
      feeNeedsConfirm(r.src.chainId, fee) &&
      !window.confirm(
        `Circle's fee for this transfer is ${ethers.formatEther(fee)} ${CHAINS[r.src.chainId].native}. Continue?`
      )
    )
      throw new Error("Cancelled.");
    pending = { selection, body: fresh };
    log(
      `Fresh quote: ${ethers.formatEther(fee)} ${CHAINS[r.src.chainId].native}, ${v.text}. Sign within ~2 minutes.`
    );
  }
  const quoted = pending.body;
  const destToken = contract(
    r.dst.token,
    ERC20,
    new ethers.JsonRpcProvider(CHAINS[r.dst.chainId].rpc)
  );
  const before: bigint = await destToken.balanceOf(to.address);
  let tx: { hash: string; wait: () => Promise<unknown> };
  if (r.kind === "usdc") {
    if (!("maxFee" in quoted))
      throw new Error("Get the fee for this route, amount, recipient and mode first.");
    const messenger = contract(TOKEN_MESSENGER_V2, MESSENGER, s);
    tx = await messenger.depositForBurn(
      amount,
      r.dst.domain,
      ethers.zeroPadValue(to.address, 32), // mintRecipient as bytes32
      r.src.token,
      ethers.ZeroHash, // anyone may deliver the message
      quoted.maxFee,
      finality(fast) // from Arc and Avalanche finality is near-instant anyway
    );
  } else {
    const px = cctpxRoute(r);
    const quote = cctpxBody(quoted);
    const svc = contract(CCTS, SERVICE, s);
    tx = await svc.crossChainTransfer(
      px.tokenId,
      amount,
      r.dst.domain,
      ethers.solidityPacked(["address"], [to.address]), // raw 20 bytes, not 32
      ethers.ZeroHash, // anyone may deliver the message
      finality(fast),
      { signedQuote: quote.signedQuote, refundAddress: who },
      false,
      "0x",
      { value: BigInt(quote.feeTotalAmount) }
    );
  }
  pending = null; // a quote is used only once
  setBtn("send", false);
  log("Transfer sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
  log(`Keep this hash. If you close the page, finish the transfer later with it: ${tx.hash}`);
  el<HTMLInputElement>("resumeHash").value = tx.hash;
  await tx.wait();
  log(
    `Confirmed on ${CHAINS[r.src.chainId].name}. Waiting for the mint on ${CHAINS[r.dst.chainId].name} for ${fmtAddr(to.address)}...`
  );
  if (selfMint) await selfMintOnDestination(r, tx.hash);
  for (let i = 0; i < 180; i++) {
    await sleep(10000);
    const now: bigint = await destToken.balanceOf(to.address);
    if (now > before) {
      log(
        `DONE: ${fmtAddr(to.address)} received ${ethers.formatUnits(now - before, r.decimals)} ${r.symbol} on ${CHAINS[r.dst.chainId].name}.`
      );
      return;
    }
  }
  log(
    `The mint has not shown up yet (30 min). The transfer is not lost: check the hash ${tx.hash} on the explorer or use "Finish a pending transfer".`
  );
});

onClick("resume", async () => {
  const r = route();
  const hash = el<HTMLInputElement>("resumeHash").value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
    throw new Error("Paste a transaction hash (0x followed by 64 hex characters).");
  if (!me) throw new Error("Click 1. Connect wallet first.");
  try {
    await selfMintOnDestination(r, hash, true);
  } catch (e) {
    if (/nonce already used/i.test(errText(e)))
      throw new Error("This transfer has already been minted.");
    throw e;
  }
});
