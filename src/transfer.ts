// Quotes, the burn or CCTPx send, and the wait for the destination mint.
import type { BrowserProvider, ContractRunner, JsonRpcSigner } from "ethers";
import {
  CCTS,
  CHAINS,
  MESSAGE_TRANSMITTER,
  TOKEN_MESSENGER_V2,
  TOKEN_MINTER_V2,
  cctpxFeeJumped,
  feeNeedsConfirm,
  finality,
  parseCctpxQuote,
  quoteFresh,
  readAttestation,
  usdcQuote,
  type Attestation,
  type CctpxQuote,
  type CctpxRoute,
  type ChainId,
  type QuoteSelection,
  type Quoted,
  type Route,
  type UsdcQuote,
  type UsdcRoute
} from "./logic.js";
import {
  erc20,
  errorText,
  lib,
  messenger,
  service,
  transmitter,
  type SentTx
} from "./contracts.js";

const IRIS = "https://iris-api.circle.com";
const QUOTE_MISMATCH = "Get the fee for this route, amount, recipient and mode first.";
const ATTEST_TRIES = 480;
const ATTEST_PAUSE_MS = 5_000;
const RESUME_UNKNOWN_MS = 120_000;
const BALANCE_TRIES = 180;
const BALANCE_PAUSE_MS = 10_000;

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
const fmtAddr = (a: string): string => a.slice(0, 6) + "…" + a.slice(-4);

export interface Recipient {
  address: string;
  self: boolean;
  label: string;
}

export interface Session {
  provider: BrowserProvider;
  signer: JsonRpcSigner;
  me: string;
}

export interface Deps {
  log: (m: string) => void;
  session: () => Session;
  ensureChain: (chainId: ChainId) => Promise<void>;
  confirm: (message: string) => boolean;
}

export interface SendIntent {
  route: Route;
  amount: bigint;
  to: Recipient;
  selection: QuoteSelection;
  me: string;
  signer: JsonRpcSigner;
}

export async function verifyRoute(route: Route, runner: ContractRunner): Promise<void> {
  if (route.kind === "usdc") {
    const lm = await messenger(TOKEN_MESSENGER_V2, runner).localMinter();
    if (lm.toLowerCase() !== TOKEN_MINTER_V2.toLowerCase())
      throw new Error("TokenMessengerV2 check failed: " + lm);
    return;
  }
  const svc = service(CCTS, runner);
  const manager = await svc.resolveTokenManager(route.tokenId);
  const token = await svc.resolveTokenAddress(route.tokenId);
  if (manager.toLowerCase() !== route.tokenManager.toLowerCase())
    throw new Error("TokenManager check failed: " + manager);
  if (token.toLowerCase() !== route.src.token.toLowerCase())
    throw new Error("Token check failed: " + token);
}

async function fetchUsdcQuote(route: UsdcRoute, amount: bigint, fast: boolean): Promise<UsdcQuote> {
  const res = await fetch(`${IRIS}/v2/burn/USDC/fees/${route.src.domain}/${route.dst.domain}`);
  if (!res.ok) throw new Error(await res.text());
  return usdcQuote(amount, await res.json(), fast);
}

async function fetchCctpxQuote(
  route: CctpxRoute,
  amount: bigint,
  to: string,
  fast: boolean,
  selfMint: boolean
): Promise<CctpxQuote> {
  const requests: { type: string; params?: { msgType: string; destinationAddress: string } }[] =
    selfMint
      ? []
      : [{ type: "FORWARD", params: { msgType: "TransferMessage", destinationAddress: to } }];
  if (fast) requests.push({ type: "PRE_FINALITY" });
  const res = await fetch(
    `${IRIS}/v2/quote/cctpx/${route.tokenId}/${route.src.domain}/${route.dst.domain}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amount.toString(), feeToken: lib().ZeroAddress, requests })
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return parseCctpxQuote(await res.json());
}

export function fetchQuote(
  route: Route,
  amount: bigint,
  to: string,
  fast: boolean,
  selfMint: boolean
): Promise<Quoted> {
  if (route.kind === "usdc") return fetchUsdcQuote(route, amount, fast);
  return fetchCctpxQuote(route, amount, to, fast, selfMint);
}

export async function confirmRecipient(deps: Deps, route: Route, to: Recipient): Promise<void> {
  if (to.self) return;
  const chainName = CHAINS[route.dst.chainId].name;
  let note = "";
  try {
    const code = await new (lib().JsonRpcProvider)(CHAINS[route.dst.chainId].rpc).getCode(
      to.address
    );
    if (code !== "0x")
      note = `\n\nThis address is a smart contract on ${chainName}. Make sure it can hold ${route.symbol}.`;
  } catch {
    note = `\n\nCould not check whether this address is a smart contract on ${chainName}. Confirm you control it before sending.`;
  }
  const msg =
    `Send to "${to.label}"\n${to.address}\non ${chainName}?\n\nThis is NOT the connected wallet.` +
    note;
  if (!deps.confirm(msg)) throw new Error("Cancelled.");
}

async function refreshCctpx(
  deps: Deps,
  route: CctpxRoute,
  intent: SendIntent,
  previous: CctpxQuote
): Promise<CctpxQuote> {
  const fresh = await fetchCctpxQuote(
    route,
    intent.amount,
    intent.to.address,
    intent.selection.fast,
    intent.selection.selfMint
  );
  const block = await deps.session().provider.getBlockNumber();
  const validity = quoteFresh(fresh.expiry, block, Date.now() / 1000);
  if (!validity.ok) throw new Error("Circle returned an already expired quote, click Send again.");
  const shown = lib().formatEther(fresh.fee);
  if (cctpxFeeJumped(previous.fee, fresh.fee))
    throw new Error(`The fee jumped to ${shown}. Click 2. Get fee and check it.`);
  const native = CHAINS[route.src.chainId].native;
  if (
    feeNeedsConfirm(route.src.chainId, fresh.fee) &&
    !deps.confirm(`Circle's fee for this transfer is ${shown} ${native}. Continue?`)
  )
    throw new Error("Cancelled.");
  deps.log(`Fresh quote: ${shown} ${native}, ${validity.text}. Sign within ~2 minutes.`);
  return fresh;
}

async function burnUsdc(intent: SendIntent, quoted: UsdcQuote): Promise<SentTx> {
  const { route, amount, to, signer, selection } = intent;
  return messenger(TOKEN_MESSENGER_V2, signer).depositForBurn(
    amount,
    route.dst.domain,
    lib().zeroPadValue(to.address, 32),
    route.src.token,
    lib().ZeroHash,
    quoted.maxFee,
    finality(selection.fast)
  );
}

async function sendCctpx(
  intent: SendIntent,
  route: CctpxRoute,
  quoted: CctpxQuote
): Promise<SentTx> {
  const { amount, to, signer, me, selection } = intent;
  return service(CCTS, signer).crossChainTransfer(
    route.tokenId,
    amount,
    route.dst.domain,
    lib().solidityPacked(["address"], [to.address]),
    lib().ZeroHash,
    finality(selection.fast),
    { signedQuote: quoted.signedQuote, refundAddress: me },
    false,
    "0x",
    { value: quoted.fee }
  );
}

async function destination(
  route: Route,
  to: string
): Promise<{ token: ReturnType<typeof erc20>; before: bigint }> {
  const token = erc20(route.dst.token, new (lib().JsonRpcProvider)(CHAINS[route.dst.chainId].rpc));
  return { token, before: await token.balanceOf(to) };
}

async function finish(
  deps: Deps,
  intent: SendIntent,
  tx: SentTx,
  snap: { token: ReturnType<typeof erc20>; before: bigint },
  onSubmitted: (hash: string) => void
): Promise<void> {
  const route = intent.route;
  onSubmitted(tx.hash);
  await tx.wait();
  deps.log(
    `Confirmed on ${CHAINS[route.src.chainId].name}. Waiting for the mint on ${CHAINS[route.dst.chainId].name} for ${fmtAddr(intent.to.address)}...`
  );
  if (intent.selection.selfMint) await selfMintOnDestination(deps, route, tx.hash);
  for (let i = 0; i < BALANCE_TRIES; i++) {
    await sleep(BALANCE_PAUSE_MS);
    const now = await snap.token.balanceOf(intent.to.address);
    if (now > snap.before) {
      deps.log(
        `DONE: ${fmtAddr(intent.to.address)} received ${lib().formatUnits(now - snap.before, route.decimals)} ${route.symbol} on ${CHAINS[route.dst.chainId].name}.`
      );
      return;
    }
  }
  deps.log(
    `The mint has not shown up yet (30 min). The transfer is not lost: check the hash ${tx.hash} on the explorer or use "Finish a pending transfer".`
  );
}

export async function sendAndWatch(
  deps: Deps,
  intent: SendIntent,
  quoted: Quoted,
  hooks: { onQuote: (quote: CctpxQuote) => void; onSubmitted: (hash: string) => void }
): Promise<void> {
  const { route } = intent;
  if (route.kind === "cctpx") {
    if (quoted.kind !== "cctpx") throw new Error(QUOTE_MISMATCH);
    const fresh = await refreshCctpx(deps, route, intent, quoted);
    hooks.onQuote(fresh);
    const snap = await destination(route, intent.to.address);
    const tx = await sendCctpx(intent, route, fresh);
    await finish(deps, intent, tx, snap, hooks.onSubmitted);
    return;
  }
  if (quoted.kind !== "usdc") throw new Error(QUOTE_MISMATCH);
  const snap = await destination(route, intent.to.address);
  const tx = await burnUsdc(intent, quoted);
  await finish(deps, intent, tx, snap, hooks.onSubmitted);
}

export async function selfMintOnDestination(
  deps: Deps,
  route: Route,
  burnHash: string,
  resume = false
): Promise<void> {
  deps.log(
    "Waiting for Circle's attestation (a standard transfer from Ethereum takes ~15–20 min, from Arc or Avalanche seconds)..."
  );
  const url = `${IRIS}/v2/messages/${route.src.domain}?transactionHash=${burnHash}`;
  const started = Date.now();
  let msg: Attestation | null = null;
  for (let i = 0; i < ATTEST_TRIES && !msg; i++) {
    let res: Response | null;
    try {
      res = await fetch(url);
    } catch {
      res = null;
    }
    if (res && res.status === 404 && resume && Date.now() - started > RESUME_UNKNOWN_MS)
      throw new Error(
        `Circle does not know this transaction on ${CHAINS[route.src.chainId].name}. Check the hash and that the route above matches the transfer.`
      );
    if (res && res.ok) msg = readAttestation(await res.json(), route);
    if (!msg) await sleep(ATTEST_PAUSE_MS);
  }
  if (!msg)
    throw new Error(
      `No attestation within 40 min. The transfer is not lost: finish it later under "Finish a pending transfer" with hash ${burnHash}`
    );
  deps.log(
    `Attestation ready. Switching to ${CHAINS[route.dst.chainId].name}: sign receiveMessage (the mint).`
  );
  await deps.ensureChain(route.dst.chainId);
  const { signer } = deps.session();
  try {
    const tx = await transmitter(MESSAGE_TRANSMITTER, signer).receiveMessage(
      msg.message,
      msg.attestation
    );
    deps.log("Mint sent: " + CHAINS[route.dst.chainId].explorer + tx.hash);
    await tx.wait();
  } catch (e) {
    if (/nonce already used/i.test(errorText(e)))
      throw new Error("This transfer has already been minted.");
    throw e;
  }
  deps.log("Mint confirmed.");
}
