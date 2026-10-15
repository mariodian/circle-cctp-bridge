import type { BrowserProvider, JsonRpcSigner } from "ethers";
import {
  CCTS,
  CHAINS,
  ROUTES,
  TOKEN_MESSENGER_V2,
  WRAP_MAX_RESERVE,
  WRAP_MIN_LEFT,
  fastAllowed,
  fastLabel,
  isTxHash,
  maxFillNote,
  maxFillReserve,
  maxFillSuffix,
  quoteStillMatches,
  routeLabel,
  selfMintLocked,
  spendError,
  transferMode,
  validEntry,
  type AddressEntry,
  type ChainId,
  type QuoteSelection,
  type Quoted,
  type Route,
  type RouteKey
} from "./logic.js";
import { erc20, errorText, lib, weth } from "./contracts.js";
import {
  confirmRecipient,
  fetchQuote,
  selfMintOnDestination,
  sendAndWatch,
  verifyRoute,
  type Deps,
  type Recipient,
  type SendIntent
} from "./transfer.js";

// Refuse to run inside a frame (clickjacking protection when the page is hosted somewhere).
if (window.top !== window.self) {
  document.body.textContent = "This page must not be embedded in another site. Open it directly.";
  throw new Error("framed");
}

let provider: BrowserProvider | undefined;
let signer: JsonRpcSigner | undefined;
let me: string | undefined;

interface Pending {
  selection: QuoteSelection;
  body: Quoted;
}

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

function openRoute(): { key: RouteKey; route: Route } {
  const key = el<HTMLSelectElement>("route").value;
  if (!isRouteKey(key)) throw new Error("Unknown route.");
  return { key, route: ROUTES[key] };
}

const route = (): Route => openRoute().route;

const wraps = (r: Route): boolean => r.kind === "cctpx" && !!r.canWrap;

function errorCode(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "code" in e && typeof e.code === "number")
    return e.code;
  return undefined;
}

function wallet(): { provider: BrowserProvider; signer: JsonRpcSigner; me: string } {
  if (!provider || !signer || !me) throw new Error("Connect your wallet first.");
  return { provider, signer, me };
}

function ethereum(): NonNullable<Window["ethereum"]> {
  if (!window.ethereum) throw new Error("No wallet found in this browser (Rabby, MetaMask…).");
  return window.ethereum;
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
    log("ERROR: " + errorText(e));
  } finally {
    busy = false;
    applyButtons();
  }
}

const onClick = (id: ButtonId, fn: () => Promise<void>): void => {
  el<HTMLButtonElement>(id).onclick = () => void run(fn);
};

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
  const parsed = raw.map((e) => validEntry(e, lib().getAddress));
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
    lib().getAddress
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
  return { address: lib().getAddress(entry.address), self: false, label: entry.label };
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
  if (r.kind === "usdc") {
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

function amountUnits(decimals = route().decimals): bigint {
  return lib().parseUnits((el<HTMLInputElement>("amt").value || "0").trim(), decimals);
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
  provider = new (lib().BrowserProvider)(eth);
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== chainId)
    throw new Error(`The wallet is not on ${c.name} (chainId ${net.chainId}).`);
  signer = await provider.getSigner();
  me = await signer.getAddress();
}

async function refreshBalances(): Promise<bigint> {
  const { provider: p, me: who } = wallet();
  const r = route();
  const bal = await erc20(r.src.token, p).balanceOf(who);
  const gas = await p.getBalance(who);
  el<HTMLElement>("acct").textContent =
    `Sender: ${who} | ${r.symbol}: ${lib().formatUnits(bal, r.decimals)} | ${CHAINS[r.src.chainId].native} (gas): ${lib().formatEther(gas)}`;
  return bal;
}

async function tokenBalance(token: string): Promise<bigint> {
  const { provider: p, me: who } = wallet();
  return erc20(token, p).balanceOf(who);
}

interface Intent extends SendIntent {
  provider: BrowserProvider;
}

async function readIntent(): Promise<Intent> {
  const { key, route: r } = openRoute();
  await ensureChain(r.src.chainId);
  const session = wallet();
  const amount = amountUnits(r.decimals);
  const to = recipient();
  const mode = transferMode(r, {
    fast: el<HTMLInputElement>("fast").checked,
    selfMint: el<HTMLInputElement>("selfMint").checked
  });
  return {
    route: r,
    amount,
    to,
    selection: { key, amount, to: to.address, fast: mode.fast, selfMint: mode.selfMint },
    ...session
  };
}

const deps: Deps = {
  log,
  session: wallet,
  ensureChain,
  confirm: (message) => window.confirm(message)
};

const fillable = (bal: bigint, reserve: bigint): bigint => (bal > reserve ? bal - reserve : 0n);

// ---------------------------------------------------------------- actions

onClick("connect", async () => {
  const eth = ethereum();
  const r = route();
  await eth.request({ method: "eth_requestAccounts" });
  await ensureChain(r.src.chainId);
  const { provider: p, me: who } = wallet();
  await verifyRoute(r, p);
  renderRecipients();
  const bal = await refreshBalances();
  el<HTMLInputElement>("amt").value = lib().formatUnits(
    fillable(bal, maxFillReserve(r)),
    r.decimals
  );
  setBtn("quote", true);
  setBtn("resume", true);
  setBtn("wrap", wraps(r));
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
  if (bal === 0n && wraps(r)) {
    const native = CHAINS[r.src.chainId].native;
    const eth = await p.getBalance(who);
    const v = fillable(eth, WRAP_MAX_RESERVE);
    el<HTMLInputElement>("amt").value = lib().formatEther(v);
    log(
      `MAX: ${lib().formatEther(v)} ${native} to wrap (${lib().formatEther(WRAP_MAX_RESERVE)} ${native} stays for gas).`
    );
    return;
  }
  const shown = lib().formatUnits(fillable(bal, maxFillReserve(r)), r.decimals);
  el<HTMLInputElement>("amt").value = shown;
  log(`MAX: ${shown} ${r.symbol}${maxFillSuffix(r)}.`);
});

onClick("wrap", async () => {
  const r = route();
  if (!wraps(r)) throw new Error("Wrapping is only for the WETH Ethereum → Arc route.");
  await ensureChain(r.src.chainId);
  const { provider: p, signer: s, me: who } = wallet();
  const amount = amountUnits();
  if (amount <= 0n) throw new Error("Enter the amount of ETH to wrap.");
  const eth = await p.getBalance(who);
  const native = CHAINS[r.src.chainId].native;
  if (eth - amount < WRAP_MIN_LEFT)
    throw new Error(`Keep at least ${lib().formatEther(WRAP_MIN_LEFT)} ${native} for gas.`);
  const tx = await weth(r.src.token, s).deposit({ value: amount });
  log("Wrap sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
  await tx.wait();
  await refreshBalances();
  log("Wrap confirmed. Continue with 2. Get fee.");
});

onClick("quote", async () => {
  const intent = await readIntent();
  const { route: r, amount, to, selection } = intent;
  const { fast, selfMint } = selection;
  if (amount <= 0n) throw new Error("Enter an amount.");
  setBtn("approve", false);
  setBtn("send", false);
  const why = spendError(r, amount, await tokenBalance(r.src.token));
  if (why) throw new Error(why);
  const next = await fetchQuote(r, amount, to.address, fast, selfMint);
  if (next.kind === "usdc")
    log(
      `Circle fee: at most ${lib().formatUnits(next.maxFee, 6)} USDC (${fast ? "fast" : "standard"}, you sign the mint on ${CHAINS[r.dst.chainId].name}).`
    );
  else
    log(
      `Fee: ${lib().formatEther(next.fee)} ${CHAINS[r.src.chainId].native} (${fast ? "fast" : "standard"}, ${selfMint ? "you sign the mint" : "Circle mints for you"}). Send fetches a fresh quote right before signing.`
    );
  pending = { selection, body: next };
  log(
    `Recipient: ${to.address} on ${CHAINS[r.dst.chainId].name}${to.self ? "" : `  ← ${to.label}, a DIFFERENT address than the sender`}`
  );
  const allowance = await erc20(r.src.token, intent.provider).allowance(intent.me, r.tokenManager);
  setBtn("approve", allowance < amount);
  setBtn("send", allowance >= amount);
  log(
    allowance >= amount
      ? "Allowance is already set, you can send."
      : "Approve first (exact amount)."
  );
});

onClick("approve", async () => {
  const intent = await readIntent();
  if (!quoteStillMatches(pending?.selection, intent.selection))
    throw new Error("Click 2. Get fee for this route, amount, recipient and mode first.");
  const tx = await erc20(intent.route.src.token, intent.signer).approve(
    intent.route.tokenManager,
    intent.amount
  );
  log("Approve sent: " + CHAINS[intent.route.src.chainId].explorer + tx.hash);
  await tx.wait();
  log("Approve confirmed. Now 4. Send (it fetches a fresh quote if needed).");
  setBtn("approve", false);
  setBtn("send", true);
});

onClick("send", async () => {
  const intent = await readIntent();
  if (!pending || !quoteStillMatches(pending.selection, intent.selection))
    throw new Error("Get the fee for this route, amount, recipient and mode first.");
  const why = spendError(intent.route, intent.amount, await tokenBalance(intent.route.src.token));
  if (why) throw new Error(why);
  await confirmRecipient(deps, intent.route, intent.to);
  const quoted = pending.body;
  await sendAndWatch(deps, intent, quoted, {
    onQuote(body) {
      pending = { selection: intent.selection, body };
    },
    onSubmitted(hash) {
      pending = null;
      setBtn("send", false);
      log("Transfer sent: " + CHAINS[intent.route.src.chainId].explorer + hash);
      log(`Keep this hash. If you close the page, finish the transfer later with it: ${hash}`);
      el<HTMLInputElement>("resumeHash").value = hash;
    }
  });
});

onClick("resume", async () => {
  const r = route();
  const hash = el<HTMLInputElement>("resumeHash").value.trim();
  if (!isTxHash(hash))
    throw new Error("Paste a transaction hash (0x followed by 64 hex characters).");
  if (!me) throw new Error("Click 1. Connect wallet first.");
  await selfMintOnDestination(deps, r, hash, true);
});
