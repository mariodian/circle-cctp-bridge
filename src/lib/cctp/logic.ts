// Route catalog and the safety checks shared by the page and the Bun tests.
// Checksum validation is passed in, so this file does not load ethers.

export const CCTS = "0x431871229103b780868f8C6BB820cd16ECf942BC";
export const TOKEN_MESSENGER_V2 = "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d";
export const TOKEN_MINTER_V2 = "0xfd78EE919681417d192449715b2594ab58f5D002";
export const MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64";

// Arc USDC is the gas token. MAX and the amount filled in on connect leave ARC_MAX_RESERVE.
// The quote and Send refuse when less than ARC_SPEND_RESERVE would remain.
export const ARC_MAX_RESERVE = 1_000000n;
export const ARC_SPEND_RESERVE = 500000n;
export const MAX_USDC_FEE_BPS = 20;
const E18 = 10n ** 18n;
// 0.0001 of an 18-decimal gas token, the slack on a CCTPx fee jump.
export const FEE_JUMP_SLACK = E18 / 10_000n;
// ETH left aside when MAX fills a wrap, and the minimum that must remain after it.
export const WRAP_MAX_RESERVE = (12n * E18) / 1000n; // 0.012 ETH
export const WRAP_MIN_LEFT = (5n * E18) / 1000n; // 0.005 ETH
// Balance left after a Max fill. Zero when the balance does not cover the reserve.
export const fillable = (bal: bigint, reserve: bigint): bigint =>
  bal > reserve ? bal - reserve : 0n;
export const FINALITY_FAST = 1000;
export const FINALITY_STANDARD = 2000;
export const finality = (fast: boolean): number => (fast ? FINALITY_FAST : FINALITY_STANDARD);

// From/To dialog order: Ethereum, then Arc, then Avalanche.
export const CHAIN_IDS = [1, 5042, 43114] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

export interface ChainAdd {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

export interface Chain {
  name: string;
  domain: number;
  hex: string;
  rpc: string;
  native: string;
  explorer: string;
  feeConfirm: bigint;
  add?: ChainAdd;
}

export const CHAINS: Record<ChainId, Chain> = {
  1: {
    name: "Ethereum",
    domain: 0,
    hex: "0x1",
    rpc: "https://ethereum-rpc.publicnode.com",
    native: "ETH",
    explorer: "https://etherscan.io/tx/",
    feeConfirm: (3n * E18) / 1_000n // 0.003 ETH
  },
  5042: {
    name: "Arc",
    domain: 26,
    hex: "0x13b2",
    rpc: "https://rpc.mainnet.arc.io",
    native: "USDC",
    explorer: "https://explorer.arc.io/tx/",
    feeConfirm: 3n * E18, // 3 USDC
    add: {
      chainId: "0x13b2",
      chainName: "Arc",
      rpcUrls: ["https://rpc.mainnet.arc.io"],
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      blockExplorerUrls: ["https://explorer.arc.io"]
    }
  },
  43114: {
    name: "Avalanche",
    domain: 1,
    hex: "0xa86a",
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    native: "AVAX",
    explorer: "https://snowtrace.io/tx/",
    feeConfirm: E18 / 5n, // 0.2 AVAX
    add: {
      chainId: "0xa86a",
      chainName: "Avalanche C-Chain",
      rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
      nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
      blockExplorerUrls: ["https://snowtrace.io"]
    }
  }
};

export function isChainId(id: number): id is ChainId {
  return Object.prototype.hasOwnProperty.call(CHAINS, id);
}

// One record owns the name, the Circle domain, and the fee-confirmation threshold.
// Route builders call this, so a missing or incomplete chain fails while ROUTES is built.
function chain(id: number): Chain {
  if (!isChainId(id)) throw new Error(`Unknown chain ${id}.`);
  return CHAINS[id];
}

export const USDC: Record<ChainId, string> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  5042: "0x3600000000000000000000000000000000000000",
  43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"
};

export interface Endpoint {
  chainId: ChainId;
  domain: number;
  token: string;
}

export interface UsdcRoute {
  kind: "usdc";
  symbol: "USDC";
  decimals: 6;
  src: Endpoint;
  dst: Endpoint;
  tokenManager: string;
  defaultFast: boolean;
  defaultSelfMint: boolean;
}

export interface CctpxRoute {
  kind: "cctpx";
  symbol: string;
  decimals: number;
  src: Endpoint;
  dst: Endpoint;
  tokenManager: string;
  tokenId: string;
  defaultFast: boolean;
  defaultSelfMint: boolean;
  canWrap?: boolean;
}

export type Route = UsdcRoute | CctpxRoute;

export function usdcRoute(src: ChainId, dst: ChainId, defaultFast: boolean): UsdcRoute {
  return {
    kind: "usdc",
    symbol: "USDC",
    decimals: 6,
    src: { chainId: src, domain: chain(src).domain, token: USDC[src] },
    dst: { chainId: dst, domain: chain(dst).domain, token: USDC[dst] },
    tokenManager: TOKEN_MESSENGER_V2,
    defaultFast,
    defaultSelfMint: true
  };
}

export interface TokenBook {
  tokenId: string;
  manager: string;
  1?: string;
  5042?: string;
  43114?: string;
}

export const WETH: TokenBook = {
  tokenId: "0x5c2cf12eccf48ab63313169ce192dc00af7c37a58bbc546ba4becf54df4962ea",
  manager: "0x8b86d0a92d779bbcc3208a98df0ab1926b3ac4dd",
  1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  5042: "0x128cC466B61f542da60c70e3aA11c10e19B84EDB"
};
export const CIRBTC: TokenBook = {
  tokenId: "0x3d26699fb5d40190fc3fa0dcbc1cd24e558355043c1997572ff9fd6efbb3fdca",
  manager: "0xa1db0fda2d1bfebe2e5701fe73b252bc2b25700e",
  1: "0x72DFB2E44f59C5AD2bAFE84314E5b99a7cd5075E",
  5042: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0"
};
export const EURC: TokenBook = {
  tokenId: "0x6ca9e29fa53becc29becaf4a90b9ca7a995ad4d2234880da13ca38c657fb241c",
  manager: "0x8c27579e24f9f19d96724e19fc059dacd1469e10",
  1: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
  5042: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1"
};

function tokenOn(book: TokenBook, id: ChainId, symbol: string): string {
  const address = book[id];
  if (!address) throw new Error(`No ${symbol} address on chain ${id}.`);
  return address;
}

export const cctpxRoute = (
  t: TokenBook,
  symbol: string,
  decimals: number,
  src: ChainId,
  dst: ChainId,
  defaultFast: boolean
): CctpxRoute => ({
  kind: "cctpx",
  symbol,
  decimals,
  tokenId: t.tokenId,
  tokenManager: t.manager,
  src: { chainId: src, domain: chain(src).domain, token: tokenOn(t, src, symbol) },
  dst: { chainId: dst, domain: chain(dst).domain, token: tokenOn(t, dst, symbol) },
  defaultFast,
  defaultSelfMint: true
});

export const ROUTES = {
  usdc_av_arc: usdcRoute(43114, 5042, false),
  usdc_av_eth: usdcRoute(43114, 1, false),
  usdc_eth_arc: usdcRoute(1, 5042, true),
  usdc_arc_eth: usdcRoute(5042, 1, false),
  eurc_arc_eth: cctpxRoute(EURC, "EURC", 6, 5042, 1, false),
  cirbtc_eth_arc: cctpxRoute(CIRBTC, "cirBTC", 8, 1, 5042, true),
  cirbtc_arc_eth: cctpxRoute(CIRBTC, "cirBTC", 8, 5042, 1, false),
  weth_eth_arc: {
    ...cctpxRoute(WETH, "WETH", 18, 1, 5042, true),
    canWrap: true
  },
  weth_arc_eth: cctpxRoute(WETH, "WETH", 18, 5042, 1, false)
} satisfies Record<string, Route>;

export type RouteKey = keyof typeof ROUTES;

export type ChainAsset = { symbol: string; token: string; decimals: number };

// One row per token contract this app moves on the chain, either side of a route.
export function assetsOn(chainId: ChainId): ChainAsset[] {
  const seen = new Set<string>();
  const rows: ChainAsset[] = [];
  for (const route of Object.values(ROUTES)) {
    for (const side of ["src", "dst"] as const) {
      const end = route[side];
      if (end.chainId !== chainId) continue;
      const key = end.token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ symbol: route.symbol, token: end.token, decimals: route.decimals });
    }
  }
  return rows;
}

// Symbols that already have a route on this side of the chain, in route-table order.
export function symbolsOn(side: "src" | "dst", chainId: ChainId): string[] {
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const route of Object.values(ROUTES)) {
    if (route[side].chainId !== chainId || seen.has(route.symbol)) continue;
    seen.add(route.symbol);
    symbols.push(route.symbol);
  }
  return symbols;
}

// Route for the endpoint being edited. Keeps the other endpoint when that pair exists.
export function routeMatching(
  current: RouteKey,
  side: "src" | "dst",
  chainId: ChainId,
  symbol: string
): RouteKey | undefined {
  const hold = ROUTES[current];
  const other = side === "src" ? "dst" : "src";
  const matches = (Object.entries(ROUTES) as [RouteKey, Route][]).filter(
    ([, route]) => route[side].chainId === chainId && route.symbol === symbol
  );
  const kept = matches.find(([, route]) => route[other].chainId === hold[other].chainId);
  return (kept ?? matches[0])?.[0];
}

// Same token with source and destination swapped, when that route exists.
export function reverseRoute(current: RouteKey): RouteKey | undefined {
  const hold = ROUTES[current];
  const found = (Object.entries(ROUTES) as [RouteKey, Route][]).find(
    ([, route]) =>
      route.symbol === hold.symbol &&
      route.src.chainId === hold.dst.chainId &&
      route.dst.chainId === hold.src.chainId
  );
  return found?.[0];
}

// Attestation wait from the route table in README.md. Ethereum is the slow source.
export function routeTime(r: Route, fast: boolean): string {
  if (r.src.chainId !== 1) return r.kind === "usdc" ? "seconds" : "seconds to minutes";
  if (!fast) return "~15–20 min";
  return r.kind === "usdc" ? "seconds" : "faster";
}

const ZERO = "0x0000000000000000000000000000000000000000";
// Anything this app treats as a contract is not a wallet. Tokens sent there are lost.
export const NOT_A_RECIPIENT = new Set(
  [
    CCTS,
    TOKEN_MINTER_V2,
    MESSAGE_TRANSMITTER,
    ZERO,
    ...Object.values(ROUTES).flatMap((r) => [r.src.token, r.dst.token, r.tokenManager])
  ].map((a) => a.toLowerCase())
);

const arcUsdc = (r: Route): boolean => r.kind === "usdc" && r.src.chainId === 5042;

// Whole and fractional units, with trailing zeros stripped. "1" and "0.5", never "1.0".
function formatUnits(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// Amount MAX and connect leave behind. Zero except on Arc USDC.
export const maxFillReserve = (r: Route): bigint => (arcUsdc(r) ? ARC_MAX_RESERVE : 0n);

// Clause the MAX log appends. Empty when MAX holds nothing back.
export function maxFillSuffix(r: Route): string {
  const reserve = maxFillReserve(r);
  if (reserve === 0n) return "";
  const left = formatUnits(reserve, r.decimals);
  const name = CHAINS[r.src.chainId].name;
  return ` (${left} ${r.symbol} stays on ${name} for gas)`;
}

// Sentence for the route blurb. Empty when MAX does not hold a reserve back.
export function maxFillNote(r: Route): string {
  const reserve = maxFillReserve(r);
  if (reserve === 0n) return "";
  const name = CHAINS[r.src.chainId].name;
  const left = formatUnits(reserve, r.decimals);
  const floor = formatUnits(ARC_SPEND_RESERVE, r.decimals);
  return `MAX leaves ${left} ${r.symbol} on ${name} for gas. Send keeps at least ${floor} ${r.symbol}.`;
}

// Null when the balance covers the amount and the Arc spend floor.
// The quote and Send both call this. Callers do not add their own chain check.
export function spendError(r: Route, amount: bigint, bal: bigint): string | null {
  if (bal < amount) return `Not enough ${r.symbol}.`;
  if (arcUsdc(r) && bal - amount < ARC_SPEND_RESERVE) {
    const floor = formatUnits(ARC_SPEND_RESERVE, r.decimals);
    const chainName = CHAINS[r.src.chainId].name;
    return `Keep at least ${floor} ${r.symbol} on ${chainName} for gas (${r.symbol} is the gas token there).`;
  }
  return null;
}

// Locks depend on the route alone. USDC always self-mints. Its fast tier exists only from Ethereum.
export const fastAllowed = (r: Route): boolean => r.kind !== "usdc" || r.src.chainId === 1;
export const selfMintLocked = (r: Route): boolean => r.kind === "usdc";

export interface TransferMode {
  fast: boolean;
  selfMint: boolean;
}

// Applies the checkbox values on top of the locks.
export function transferMode(r: Route, input: TransferMode): TransferMode {
  return {
    fast: fastAllowed(r) && input.fast,
    selfMint: selfMintLocked(r) ? true : input.selfMint
  };
}

export const fastLabel = (r: Route): string =>
  fastAllowed(r)
    ? "Fast transfer (small fee)"
    : "Fast transfer is not available for USDC except from Ethereum";

export const routeLabel = (r: Route): string =>
  `${r.symbol}: ${CHAINS[r.src.chainId].name} → ${CHAINS[r.dst.chainId].name}`;

export const cleanLabel = (s: unknown): string =>
  String(s || "")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
export const badLabel = (s: string): boolean => !s || /0x/i.test(s) || /wallet/i.test(s);

export interface AddressEntry {
  label: string;
  address: string;
}

export type EntryResult = { ok: true; entry: AddressEntry } | { ok: false; error: string };

function recordOf(e: unknown): Record<string, unknown> | undefined {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return undefined;
  return e as Record<string, unknown>;
}

// One shape either way: { ok: true, entry } or { ok: false, error }.
// Callers branch on ok. A string is never an entry, and an entry is never an error.
// Address and label come from the address book (typed in, or read back from localStorage).
export function validEntry(e: unknown, getAddress: (address: string) => string): EntryResult {
  const fields = recordOf(e);
  let address: string;
  try {
    address = getAddress(String(fields && fields.address));
  } catch {
    return { ok: false, error: "not a valid address (check the checksum)." };
  }
  if (NOT_A_RECIPIENT.has(address.toLowerCase()))
    return {
      ok: false,
      error: "this is a token or Circle contract, not a wallet. Tokens sent there are lost."
    };
  const label = cleanLabel(fields && fields.label);
  if (badLabel(label))
    return {
      ok: false,
      error: 'enter a short label with letters or digits only (no addresses, not "wallet").'
    };
  return { ok: true, entry: { label, address } };
}

// Circle's minimumFee is in basis points and may be fractional. Fast transfers keep 2x headroom.
export function usdcMaxFee(
  amount: bigint,
  minimumFee: number | string | undefined,
  fast: boolean
): bigint {
  const feeBps = Number(minimumFee);
  if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > MAX_USDC_FEE_BPS)
    throw new Error(`Circle's fee looks wrong (${minimumFee} bps). Refusing to send.`);
  const hundredths = BigInt(Math.ceil(feeBps * 100));
  return ((amount * hundredths + 999999n) / 1000000n) * (fast ? 2n : 1n);
}

export const cctpxFeeJumped = (oldFee: bigint, newFee: bigint): boolean =>
  newFee > (oldFee * 3n) / 2n + FEE_JUMP_SLACK;

export function feeNeedsConfirm(chainId: number, fee: bigint): boolean {
  return fee > chain(chainId).feeConfirm;
}

export interface QuoteSelection {
  key: RouteKey;
  amount: bigint;
  to: string;
  fast: boolean;
  selfMint: boolean;
}

export function quoteStillMatches(
  quotedFor: QuoteSelection | null | undefined,
  next: QuoteSelection
): boolean {
  if (!quotedFor) return false;
  return (
    quotedFor.key === next.key &&
    quotedFor.amount === next.amount &&
    quotedFor.to === next.to &&
    quotedFor.fast === next.fast &&
    quotedFor.selfMint === next.selfMint
  );
}

export interface QuoteExpiry {
  mode?: string;
  expiresAtBlock?: number;
  expiresAt?: number;
}

export interface UsdcQuote {
  kind: "usdc";
  maxFee: bigint;
}

export interface CctpxQuote {
  kind: "cctpx";
  fee: bigint;
  signedQuote: string;
  expiry?: QuoteExpiry;
}

export type Quoted = UsdcQuote | CctpxQuote;

export const isTxHash = (s: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(s);

function isFeeTier(
  t: unknown,
  threshold: number
): t is { finalityThreshold: unknown; minimumFee?: unknown } {
  return (
    typeof t === "object" &&
    t !== null &&
    "finalityThreshold" in t &&
    t.finalityThreshold === threshold
  );
}

// Circle's burn fee response is an array of tiers. The matching tier's minimumFee is bps.
export function usdcQuote(amount: bigint, tiers: unknown, fast: boolean): UsdcQuote {
  const tier = Array.isArray(tiers) ? tiers.find((t) => isFeeTier(t, finality(fast))) : undefined;
  if (!tier) throw new Error("Circle returned no fee for this transfer type.");
  const minimumFee = tier.minimumFee;
  if (typeof minimumFee !== "number" && typeof minimumFee !== "string")
    throw new Error(`Circle's fee looks wrong (${String(minimumFee)} bps). Refusing to send.`);
  return { kind: "usdc", maxFee: usdcMaxFee(amount, minimumFee, fast) };
}

function feeAmount(value: unknown): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
    throw new Error("Circle returned a quote without a valid fee.");
  let fee: bigint;
  try {
    fee = BigInt(value);
  } catch {
    throw new Error("Circle returned a quote without a valid fee.");
  }
  if (fee < 0n) throw new Error("Circle returned an invalid quote.");
  return fee;
}

function expiryOf(value: unknown): QuoteExpiry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const expiry: QuoteExpiry = {};
  if ("mode" in value && typeof value.mode === "string") expiry.mode = value.mode;
  if ("expiresAtBlock" in value && typeof value.expiresAtBlock === "number")
    expiry.expiresAtBlock = value.expiresAtBlock;
  if ("expiresAt" in value && typeof value.expiresAt === "number")
    expiry.expiresAt = value.expiresAt;
  return expiry;
}

// fee is a decimal string of wei. Booleans and objects are rejected before BigInt, which throws on them.
export function parseCctpxQuote(q: unknown): CctpxQuote {
  if (typeof q !== "object" || q === null)
    throw new Error("Circle returned a quote without a valid fee.");
  const fee = feeAmount("feeTotalAmount" in q ? q.feeTotalAmount : undefined);
  const signed = "signedQuote" in q ? q.signedQuote : undefined;
  if (typeof signed !== "string" || !signed) throw new Error("Circle returned an invalid quote.");
  const expiry = "expiry" in q ? expiryOf(q.expiry) : undefined;
  return expiry
    ? { kind: "cctpx", fee, signedQuote: signed, expiry }
    : { kind: "cctpx", fee, signedQuote: signed };
}

// Missing expiry is accepted. Circle quotes are short-lived either way, and Send fetches a fresh one.
export function quoteFresh(
  expiry: QuoteExpiry | undefined,
  nowBlock: number,
  nowSeconds: number
): { ok: boolean; text: string } {
  const e = expiry ?? {};
  if (e.mode === "BLOCK_NUMBER" && e.expiresAtBlock) {
    const left = e.expiresAtBlock - nowBlock;
    return { ok: left >= 2, text: `valid for ${left} more blocks` };
  }
  if (e.expiresAt) {
    const left = Math.round(e.expiresAt - nowSeconds);
    return { ok: left >= 15, text: `valid for ${left} more seconds` };
  }
  return { ok: true, text: "no expiry given" };
}

export interface Attestation {
  message: string;
  attestation: string;
}

// Integers and decimal strings only. Number(null) and Number(true) are real Circle domains, so they are rejected.
function circleDomain(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function wrongDomain(raw: unknown, where: "to" | "from", name: string): Error {
  const direction = where === "to" ? "goes to" : "comes from";
  return new Error(
    `This transfer ${direction} Circle domain ${String(raw)}, not ${where} ${name}. Pick the matching route.`
  );
}

// The first Iris message for this burn.
// Both domains must match the route before a completed message can be minted.
// A parsed domain that disagrees throws. A missing or non-numeric domain returns null so the poll continues.
export function readAttestation(payload: unknown, route: Route): Attestation | null {
  const messages = recordOf(payload)?.messages;
  const first = recordOf(Array.isArray(messages) ? messages[0] : undefined);
  if (!first) return null;
  const decoded = recordOf(first.decodedMessage);
  if (!decoded) return null;
  const dest = circleDomain(decoded.destinationDomain);
  const src = circleDomain(decoded.sourceDomain);
  if (dest !== undefined && dest !== route.dst.domain)
    throw wrongDomain(decoded.destinationDomain, "to", CHAINS[route.dst.chainId].name);
  if (src !== undefined && src !== route.src.domain)
    throw wrongDomain(decoded.sourceDomain, "from", CHAINS[route.src.chainId].name);
  if (dest === undefined || src === undefined) return null;
  const { status, message, attestation } = first;
  if (
    status === "complete" &&
    typeof message === "string" &&
    message &&
    typeof attestation === "string" &&
    attestation &&
    attestation !== "PENDING"
  )
    return { message, attestation };
  return null;
}
