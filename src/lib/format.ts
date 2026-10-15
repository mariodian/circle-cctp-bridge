import { CHAINS, type Quoted, type Route } from "$lib/cctp/logic.js";
import { lib } from "$lib/cctp/contracts.js";

/** `0x17473...36ed3A` — 0x plus 5 hex chars, three dots, then the last 6. */
export function shortAddress(address: string): string {
  if (!address.startsWith("0x") || address.length < 13) return address;
  return `${address.slice(0, 7)}...${address.slice(-6)}`;
}

// Fee row. An empty amount asks for one. A positive amount with no quote is a dash.
export function feeText(route: Route, amount: string, body: Quoted | null): string {
  if (!body) return amount.trim() ? "—" : "Enter an amount";
  if (body.kind === "usdc") return `at most ${lib().formatUnits(body.maxFee, 6)} USDC`;
  return `${lib().formatEther(body.fee)} ${CHAINS[route.src.chainId].native}`;
}

// You'll-receive row. USDC subtracts the max fee. Anything else echoes the amount.
export function receiveText(route: Route, amount: string, body: Quoted | null): string {
  const symbol = route.symbol;
  if (!body || body.kind !== "usdc") {
    const entered = amount.trim();
    return `${entered || "0"} ${symbol}`;
  }
  try {
    const units = lib().parseUnits((amount || "0").trim(), route.decimals);
    const net = units > body.maxFee ? units - body.maxFee : 0n;
    return `${lib().formatUnits(net, route.decimals)} ${symbol}`;
  } catch {
    return `${amount.trim() || "0"} ${symbol}`;
  }
}
