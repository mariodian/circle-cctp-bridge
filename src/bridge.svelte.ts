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

const AB_KEY = "circle-cctp-bridge.addressBook";

export type InfoPart = string | { code: string };

const ROUTE_KEYS = Object.keys(ROUTES) as RouteKey[];

function isRouteKey(key: string): key is RouteKey {
  return Object.prototype.hasOwnProperty.call(ROUTES, key);
}

function errorCode(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null && "code" in e && typeof e.code === "number")
    return e.code;
  return undefined;
}

const wraps = (r: Route): boolean => r.kind === "cctpx" && !!r.canWrap;

const fillable = (bal: bigint, reserve: bigint): bigint => (bal > reserve ? bal - reserve : 0n);

interface Pending {
  selection: QuoteSelection;
  body: Quoted;
}

interface Intent extends SendIntent {
  provider: BrowserProvider;
}

class Bridge {
  routeKey = $state<RouteKey>(ROUTE_KEYS[0] ?? "usdc_av_arc");
  fast = $state(false);
  selfMint = $state(true);
  amount = $state("");
  resumeHash = $state("");
  acct = $state("");
  logText = $state("");
  book = $state<AddressEntry[]>([]);
  recipientKey = $state("self");
  busy = $state(false);
  quoteOn = $state(false);
  approveOn = $state(false);
  sendOn = $state(false);
  resumeOn = $state(false);
  wrapOn = $state(false);
  lines = $state<InfoPart[][]>([]);

  #provider: BrowserProvider | undefined;
  #signer: JsonRpcSigner | undefined;
  #me: string | undefined;
  #pending: Pending | null = null;

  constructor() {
    this.book = this.#loadBook();
    this.#showRoute();
  }

  get route(): Route {
    return ROUTES[this.routeKey];
  }

  get me(): string | undefined {
    return this.#me;
  }

  get routeOptions(): { key: RouteKey; label: string }[] {
    return ROUTE_KEYS.map((key) => ({ key, label: routeLabel(ROUTES[key]) }));
  }

  get fastLocked(): boolean {
    return this.busy || !fastAllowed(this.route);
  }

  get selfMintDisabled(): boolean {
    return this.busy || selfMintLocked(this.route);
  }

  get fastText(): string {
    return fastLabel(this.route);
  }

  get canWrap(): boolean {
    return wraps(this.route);
  }

  get symbol(): string {
    return this.route.symbol;
  }

  get rcptInfo(): string {
    return this.recipientKey === "self"
      ? "Funds arrive at the same address on the destination network."
      : "⚠️ Funds go to a different address than the connected wallet. Check that you control it on the destination network.";
  }

  log(m: string): void {
    this.logText += m + "\n";
  }

  setRoute(key: string): void {
    if (this.busy || !isRouteKey(key) || key === this.routeKey) return;
    this.routeKey = key;
    this.#showRoute();
  }

  addEntry(label: string, address: string): boolean {
    if (this.busy) return false;
    const result = validEntry({ label, address: address.trim() }, lib().getAddress);
    if (!result.ok) {
      this.log("ERROR: " + result.error);
      return false;
    }
    const entry = result.entry;
    if (this.book.some((e) => e.address.toLowerCase() === entry.address.toLowerCase())) {
      this.log("This address is already in the address book.");
      return false;
    }
    this.book.push(entry);
    this.#saveBook();
    this.log(`Added to the address book: ${entry.label} — ${entry.address}`);
    return true;
  }

  removeEntry(index: number): void {
    if (this.busy) return;
    const removed = this.book[index];
    this.book.splice(index, 1);
    this.#saveBook();
    if (removed && this.recipientKey === removed.address) this.recipientKey = "self";
  }

  async connect(): Promise<void> {
    await this.#run(async () => {
      const eth = this.#ethereum();
      const r = this.route;
      await eth.request({ method: "eth_requestAccounts" });
      await this.#ensureChain(r.src.chainId);
      const { provider: p, me: who } = this.#wallet();
      await verifyRoute(r, p);
      const bal = await this.#refreshBalances();
      this.amount = lib().formatUnits(fillable(bal, maxFillReserve(r)), r.decimals);
      this.quoteOn = true;
      this.resumeOn = true;
      this.wrapOn = wraps(r);
      this.approveOn = false;
      this.sendOn = false;
      this.log(`Connected on ${CHAINS[r.src.chainId].name} as ${who}. Circle contracts verified.`);
    });
  }

  async max(): Promise<void> {
    await this.#run(async () => {
      if (!this.#me || !this.#provider) throw new Error("Click 1. Connect wallet first.");
      const r = this.route;
      await this.#ensureChain(r.src.chainId);
      const { provider: p, me: who } = this.#wallet();
      const bal = await this.#tokenBalance(r.src.token);
      if (bal === 0n && wraps(r)) {
        const native = CHAINS[r.src.chainId].native;
        const eth = await p.getBalance(who);
        const v = fillable(eth, WRAP_MAX_RESERVE);
        this.amount = lib().formatEther(v);
        this.log(
          `MAX: ${lib().formatEther(v)} ${native} to wrap (${lib().formatEther(WRAP_MAX_RESERVE)} ${native} stays for gas).`
        );
        return;
      }
      const shown = lib().formatUnits(fillable(bal, maxFillReserve(r)), r.decimals);
      this.amount = shown;
      this.log(`MAX: ${shown} ${r.symbol}${maxFillSuffix(r)}.`);
    });
  }

  async wrap(): Promise<void> {
    await this.#run(async () => {
      const r = this.route;
      if (!wraps(r)) throw new Error("Wrapping is only for the WETH Ethereum → Arc route.");
      await this.#ensureChain(r.src.chainId);
      const { provider: p, signer: s, me: who } = this.#wallet();
      const amount = this.#amountUnits();
      if (amount <= 0n) throw new Error("Enter the amount of ETH to wrap.");
      const eth = await p.getBalance(who);
      const native = CHAINS[r.src.chainId].native;
      if (eth - amount < WRAP_MIN_LEFT)
        throw new Error(`Keep at least ${lib().formatEther(WRAP_MIN_LEFT)} ${native} for gas.`);
      const tx = await weth(r.src.token, s).deposit({ value: amount });
      this.log("Wrap sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
      await tx.wait();
      await this.#refreshBalances();
      this.log("Wrap confirmed. Continue with 2. Get fee.");
    });
  }

  async quote(): Promise<void> {
    await this.#run(async () => {
      const intent = await this.#readIntent();
      const { route: r, amount, to, selection } = intent;
      const { fast, selfMint } = selection;
      if (amount <= 0n) throw new Error("Enter an amount.");
      this.approveOn = false;
      this.sendOn = false;
      const why = spendError(r, amount, await this.#tokenBalance(r.src.token));
      if (why) throw new Error(why);
      const next = await fetchQuote(r, amount, to.address, fast, selfMint);
      if (next.kind === "usdc")
        this.log(
          `Circle fee: at most ${lib().formatUnits(next.maxFee, 6)} USDC (${fast ? "fast" : "standard"}, you sign the mint on ${CHAINS[r.dst.chainId].name}).`
        );
      else
        this.log(
          `Fee: ${lib().formatEther(next.fee)} ${CHAINS[r.src.chainId].native} (${fast ? "fast" : "standard"}, ${selfMint ? "you sign the mint" : "Circle mints for you"}). Send fetches a fresh quote right before signing.`
        );
      this.#pending = { selection, body: next };
      this.log(
        `Recipient: ${to.address} on ${CHAINS[r.dst.chainId].name}${to.self ? "" : `  ← ${to.label}, a DIFFERENT address than the sender`}`
      );
      const allowance = await erc20(r.src.token, intent.provider).allowance(
        intent.me,
        r.tokenManager
      );
      this.approveOn = allowance < amount;
      this.sendOn = allowance >= amount;
      this.log(
        allowance >= amount
          ? "Allowance is already set, you can send."
          : "Approve first (exact amount)."
      );
    });
  }

  async approve(): Promise<void> {
    await this.#run(async () => {
      const intent = await this.#readIntent();
      if (!quoteStillMatches(this.#pending?.selection, intent.selection))
        throw new Error("Click 2. Get fee for this route, amount, recipient and mode first.");
      const tx = await erc20(intent.route.src.token, intent.signer).approve(
        intent.route.tokenManager,
        intent.amount
      );
      this.log("Approve sent: " + CHAINS[intent.route.src.chainId].explorer + tx.hash);
      await tx.wait();
      this.log("Approve confirmed. Now 4. Send (it fetches a fresh quote if needed).");
      this.approveOn = false;
      this.sendOn = true;
    });
  }

  async send(): Promise<void> {
    await this.#run(async () => {
      const intent = await this.#readIntent();
      if (!this.#pending || !quoteStillMatches(this.#pending.selection, intent.selection))
        throw new Error("Get the fee for this route, amount, recipient and mode first.");
      const why = spendError(
        intent.route,
        intent.amount,
        await this.#tokenBalance(intent.route.src.token)
      );
      if (why) throw new Error(why);
      await confirmRecipient(this.#deps(), intent.route, intent.to);
      const quoted = this.#pending.body;
      await sendAndWatch(this.#deps(), intent, quoted, {
        onQuote: (body) => {
          this.#pending = { selection: intent.selection, body };
        },
        onSubmitted: (hash) => {
          this.#pending = null;
          this.sendOn = false;
          this.log("Transfer sent: " + CHAINS[intent.route.src.chainId].explorer + hash);
          this.log(
            `Keep this hash. If you close the page, finish the transfer later with it: ${hash}`
          );
          this.resumeHash = hash;
        }
      });
    });
  }

  async resume(): Promise<void> {
    await this.#run(async () => {
      const r = this.route;
      const hash = this.resumeHash.trim();
      if (!isTxHash(hash))
        throw new Error("Paste a transaction hash (0x followed by 64 hex characters).");
      if (!this.#me) throw new Error("Click 1. Connect wallet first.");
      await selfMintOnDestination(this.#deps(), r, hash, true);
    });
  }

  #showRoute(): void {
    const r = this.route;
    const lines: InfoPart[][] = [
      [
        `${r.symbol} ${CHAINS[r.src.chainId].name} `,
        { code: r.src.token },
        ` → ${CHAINS[r.dst.chainId].name} `,
        { code: r.dst.token }
      ]
    ];
    if (r.kind === "usdc") {
      const gas = maxFillNote(r);
      lines.push([
        "Approve for Circle TokenMessengerV2 ",
        { code: TOKEN_MESSENGER_V2 },
        ", sent with depositForBurn. " +
          `You sign the mint on ${CHAINS[r.dst.chainId].name} yourself` +
          (gas ? `. ${gas}` : ` (needs a little ${CHAINS[r.dst.chainId].native} for gas).`)
      ]);
    } else {
      lines.push([
        "Approve for Circle TokenManager ",
        { code: r.tokenManager },
        ", sent with CrossChainTokenService ",
        { code: CCTS },
        `. Any fee is paid in ${CHAINS[r.src.chainId].native} on ${CHAINS[r.src.chainId].name}.`
      ]);
    }
    this.lines = lines;
    const mode = transferMode(r, { fast: r.defaultFast, selfMint: r.defaultSelfMint });
    this.fast = mode.fast;
    this.selfMint = mode.selfMint;
    this.#pending = null;
    this.wrapOn = false;
    this.quoteOn = false;
    this.approveOn = false;
    this.sendOn = false;
    this.resumeOn = false;
    this.acct = "";
    this.amount = "";
  }

  #loadBook(): AddressEntry[] {
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
      this.log(
        `Ignored ${raw.length - ok.length} invalid address book entr${raw.length - ok.length === 1 ? "y" : "ies"}.`
      );
    return ok;
  }

  #saveBook(): void {
    try {
      localStorage.setItem(AB_KEY, JSON.stringify(this.book));
    } catch {
      this.log("Could not save the address book in this browser.");
    }
  }

  #wallet(): { provider: BrowserProvider; signer: JsonRpcSigner; me: string } {
    if (!this.#provider || !this.#signer || !this.#me)
      throw new Error("Connect your wallet first.");
    return { provider: this.#provider, signer: this.#signer, me: this.#me };
  }

  #ethereum(): NonNullable<Window["ethereum"]> {
    if (!window.ethereum) throw new Error("No wallet found in this browser (Rabby, MetaMask…).");
    return window.ethereum;
  }

  #amountUnits(decimals = this.route.decimals): bigint {
    return lib().parseUnits((this.amount || "0").trim(), decimals);
  }

  async #ensureChain(chainId: ChainId): Promise<void> {
    const c = CHAINS[chainId];
    const eth = this.#ethereum();
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
    this.#provider = new (lib().BrowserProvider)(eth);
    const net = await this.#provider.getNetwork();
    if (Number(net.chainId) !== chainId)
      throw new Error(`The wallet is not on ${c.name} (chainId ${net.chainId}).`);
    this.#signer = await this.#provider.getSigner();
    this.#me = await this.#signer.getAddress();
  }

  async #refreshBalances(): Promise<bigint> {
    const { provider: p, me: who } = this.#wallet();
    const r = this.route;
    const bal = await erc20(r.src.token, p).balanceOf(who);
    const gas = await p.getBalance(who);
    this.acct = `Sender: ${who} | ${r.symbol}: ${lib().formatUnits(bal, r.decimals)} | ${CHAINS[r.src.chainId].native} (gas): ${lib().formatEther(gas)}`;
    return bal;
  }

  async #tokenBalance(token: string): Promise<bigint> {
    const { provider: p, me: who } = this.#wallet();
    return erc20(token, p).balanceOf(who);
  }

  #recipient(): Recipient {
    if (!this.#me) throw new Error("Connect your wallet first.");
    if (this.recipientKey === "self")
      return { address: this.#me, self: true, label: "this wallet" };
    const entry = this.book.find((e) => e.address === this.recipientKey);
    if (!entry)
      throw new Error("The recipient must be this wallet or an address from your address book.");
    return { address: lib().getAddress(entry.address), self: false, label: entry.label };
  }

  async #readIntent(): Promise<Intent> {
    const key = this.routeKey;
    const r = ROUTES[key];
    await this.#ensureChain(r.src.chainId);
    const session = this.#wallet();
    const amount = this.#amountUnits(r.decimals);
    const to = this.#recipient();
    const mode = transferMode(r, { fast: this.fast, selfMint: this.selfMint });
    return {
      route: r,
      amount,
      to,
      selection: { key, amount, to: to.address, fast: mode.fast, selfMint: mode.selfMint },
      ...session
    };
  }

  #deps(): Deps {
    return {
      log: (m) => this.log(m),
      session: () => this.#wallet(),
      ensureChain: (id) => this.#ensureChain(id),
      confirm: (message) => window.confirm(message)
    };
  }

  async #run(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      this.log("ERROR: " + errorText(e));
    } finally {
      this.busy = false;
    }
  }
}

export const bridge = new Bridge();
