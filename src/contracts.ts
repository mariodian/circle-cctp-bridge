// Typed calls over the ethers UMD build. The cast stays at this boundary.
import type { ContractRunner, Eip1193Provider } from "ethers";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    ethers: typeof import("ethers");
  }
}

export function lib(): typeof import("ethers") {
  if (!window.ethers) throw new Error("ethers.js failed to load.");
  return window.ethers;
}

// Wallet rejections and contract reverts expose shortMessage. Everything else is an Error or a string.
export function errorText(e: unknown): string {
  if (typeof e === "object" && e !== null && "shortMessage" in e) {
    const short = e.shortMessage;
    if (typeof short === "string" && short) return short;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface SentTx {
  hash: string;
  wait: () => Promise<unknown>;
}

interface Erc20 {
  balanceOf(account: string): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
  approve(spender: string, amount: bigint): Promise<SentTx>;
}

interface Messenger {
  localMinter(): Promise<string>;
  depositForBurn(
    amount: bigint,
    destinationDomain: number,
    mintRecipient: string,
    burnToken: string,
    destinationCaller: string,
    maxFee: bigint,
    minFinalityThreshold: number
  ): Promise<SentTx>;
}

interface Service {
  resolveTokenManager(tokenId: string): Promise<string>;
  resolveTokenAddress(tokenId: string): Promise<string>;
  crossChainTransfer(
    tokenId: string,
    amount: bigint,
    destinationDomain: number,
    destinationAddress: string,
    destinationCaller: string,
    minFinalityThreshold: number,
    claim: { signedQuote: string; refundAddress: string },
    autoExecuteHookData: boolean,
    hookData: string,
    overrides: { value: bigint }
  ): Promise<SentTx>;
}

interface Transmitter {
  receiveMessage(message: string, attestation: string): Promise<SentTx>;
}

interface Weth9 {
  deposit(overrides: { value: bigint }): Promise<SentTx>;
}

function bind<T>(address: string, abi: readonly string[], runner: ContractRunner): T {
  return new (lib().Contract)(address, [...abi], runner) as unknown as T;
}

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

const MESSENGER = [
  "function localMinter() view returns (address)",
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)"
];

const SERVICE = [
  "function resolveTokenManager(bytes32) view returns (address)",
  "function resolveTokenAddress(bytes32) view returns (address)",
  "function crossChainTransfer(bytes32 tokenId, uint256 amount, uint32 destinationDomain, bytes destinationAddress, bytes32 destinationCaller, uint32 minFinalityThreshold, (bytes signedQuote, address refundAddress) claim, bool autoExecuteHookData, bytes hookData) payable"
];

export const erc20 = (address: string, runner: ContractRunner): Erc20 =>
  bind(address, ERC20, runner);

export const messenger = (address: string, runner: ContractRunner): Messenger =>
  bind(address, MESSENGER, runner);

export const service = (address: string, runner: ContractRunner): Service =>
  bind(address, SERVICE, runner);

export const transmitter = (address: string, runner: ContractRunner): Transmitter =>
  bind(
    address,
    ["function receiveMessage(bytes message, bytes attestation) returns (bool)"],
    runner
  );

export const weth = (address: string, runner: ContractRunner): Weth9 =>
  bind(address, ["function deposit() payable"], runner);
