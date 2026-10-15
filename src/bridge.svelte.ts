import type { BrowserProvider, JsonRpcSigner } from "ethers";
import {
  CHAINS,
  ROUTES,
  WRAP_MAX_RESERVE,
  WRAP_MIN_LEFT,
  fastAllowed,
  fastLabel,
  isTxHash,
  maxFillNote,
  maxFillReserve,
  maxFillSuffix,
  quoteStillMatches,
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

/** `0x17473...36ed3A` — 0x plus 5 hex chars, then the last 6. */
export function shortAddress(address: string): string {
  if (!address.startsWith("0x") || address.length < 13) return address;
  return `${address.slice(0, 7)}...${address.slice(-6)}`;
}

interface Pending {
  selection: QuoteSelection;
  body: Quoted;
}

// Buttons and the fee skeleton are reads of this. They cannot disagree.
type FeeState =
  | { phase: "idle"; note: string }
  | { phase: "loading" }
  | { phase: "preview"; body: Quoted; note: string }
  | { phase: "ready"; body: Quoted; pending: Pending; needsApproval: boolean };

interface Intent extends SendIntent {
  provider: BrowserProvider;
}

class Bridge {
  routeKey = $state<RouteKey>("usdc_eth_arc");
  fast = $state(false);
  selfMint = $state(true);
  amount = $state("");
  resumeHash = $state("");
  balanceText = $state("");
  logText = $state("");
  book = $state<AddressEntry[]>([]);
  recipientKey = $state("self");
  busy = $state(false);

  #provider: BrowserProvider | undefined;
  #signer: JsonRpcSigner | undefined;
  #me = $state<string | undefined>();
  // The only quote the card can send or display. Written by #commit and the terminal send path.
  #fee = $state<FeeState>({ phase: "idle", note: "" });
  #feeTimer: ReturnType<typeof setTimeout> | undefined;
  #feeSeq = 0;

  constructor() {
    this.book = this.#loadBook();
    this.#applyRouteDefaults();
    // Module singleton: an effect root keeps the quote tied to its inputs outside a component.
    const stop = $effect.root(() => {
      $effect(() => {
        this.routeKey;
        this.amount;
        this.fast;
        this.selfMint;
        this.recipientKey;
        this.#me;
        this.busy;
        this.#invalidateQuote();
      });
    });
    import.meta.hot?.dispose(stop);
  }

  get route(): Route {
    return ROUTES[this.routeKey];
  }

  get me(): string | undefined {
    return this.#me;
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

  get mode(): { fast: boolean; selfMint: boolean } {
    return transferMode(this.route, { fast: this.fast, selfMint: this.selfMint });
  }

  get feeLoading(): boolean {
    return this.#fee.phase === "loading";
  }

  get approveOn(): boolean {
    const fee = this.#fee;
    return fee.phase === "ready" && fee.needsApproval;
  }

  get sendOn(): boolean {
    const fee = this.#fee;
    return fee.phase === "ready" && !fee.needsApproval;
  }

  get feeText(): string {
    const body = this.#shown();
    if (!body) return this.amount.trim() ? "—" : "Enter an amount";
    if (body.kind === "usdc") return `at most ${lib().formatUnits(body.maxFee, 6)} USDC`;
    return `${lib().formatEther(body.fee)} ${CHAINS[this.route.src.chainId].native}`;
  }

  get receiveText(): string {
    const symbol = this.route.symbol;
    const body = this.#shown();
    if (!body || body.kind !== "usdc") {
      const entered = this.amount.trim();
      return `${entered || "0"} ${symbol}`;
    }
    try {
      const amount = this.#amountUnits();
      const net = amount > body.maxFee ? amount - body.maxFee : 0n;
      return `${lib().formatUnits(net, this.route.decimals)} ${symbol}`;
    } catch {
      return `${this.amount.trim() || "0"} ${symbol}`;
    }
  }

  get reserveNote(): string {
    return maxFillNote(this.route);
  }

  get feeNote(): string {
    const fee = this.#fee;
    return fee.phase === "idle" || fee.phase === "preview" ? fee.note : "";
  }

  get canWrap(): boolean {
    return wraps(this.route);
  }

  get wrapOn(): boolean {
    return this.canWrap && this.#me !== undefined;
  }

  get resumeOn(): boolean {
    return this.#me !== undefined;
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
    this.#applyRouteDefaults();
    if (!this.#me) return;
    void this.#run(async () => {
      await this.#ensureChain(this.route.src.chainId);
      await verifyRoute(this.route, this.#wallet().provider);
      await this.#refreshBalances();
    });
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
      this.log(`Connected on ${CHAINS[r.src.chainId].name} as ${who}. Circle contracts verified.`);
    });
  }

  async max(): Promise<void> {
    await this.#run(async () => {
      if (!this.#me || !this.#provider) throw new Error("Connect your wallet first.");
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
      this.log("Wrap confirmed.");
    });
  }

  async approve(): Promise<void> {
    await this.#run(async () => {
      const intent = await this.#readIntent();
      if (!quoteStillMatches(this.#pending()?.selection, intent.selection))
        throw new Error("Wait for the fee for this route, amount, recipient and mode.");
      const tx = await erc20(intent.route.src.token, intent.signer).approve(
        intent.route.tokenManager,
        intent.amount
      );
      this.log("Approve sent: " + CHAINS[intent.route.src.chainId].explorer + tx.hash);
      await tx.wait();
      this.log("Approve confirmed. Send fetches a fresh quote if needed.");
    });
  }

  async send(): Promise<void> {
    await this.#run(async () => {
      const intent = await this.#readIntent();
      const pending = this.#pending();
      if (!pending || !quoteStillMatches(pending.selection, intent.selection))
        throw new Error("Wait for the fee for this route, amount, recipient and mode.");
      const why = spendError(
        intent.route,
        intent.amount,
        await this.#tokenBalance(intent.route.src.token)
      );
      if (why) throw new Error(why);
      await confirmRecipient(this.#deps(), intent.route, intent.to);
      const quoted = pending.body;
      await sendAndWatch(this.#deps(), intent, quoted, {
        onQuote: (body) => {
          const fee = this.#fee;
          if (fee.phase !== "ready") return;
          this.#fee = {
            phase: "ready",
            body,
            pending: { selection: intent.selection, body },
            needsApproval: false
          };
        },
        onSubmitted: (hash) => {
          this.#showPreview(quoted);
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
      if (!this.#me) throw new Error("Connect your wallet first.");
      await selfMintOnDestination(this.#deps(), r, hash, true);
    });
  }

  #applyRouteDefaults(): void {
    const r = this.route;
    const mode = transferMode(r, { fast: r.defaultFast, selfMint: r.defaultSelfMint });
    this.fast = mode.fast;
    this.selfMint = mode.selfMint;
    this.#bumpQuote();
    this.#fee = { phase: "idle", note: "" };
    this.balanceText = "";
  }

  #shown(): Quoted | null {
    const fee = this.#fee;
    return fee.phase === "preview" || fee.phase === "ready" ? fee.body : null;
  }

  #pending(): Pending | null {
    return this.#fee.phase === "ready" ? this.#fee.pending : null;
  }

  #showPreview(fallback: Quoted): void {
    const fee = this.#fee;
    const body = fee.phase === "ready" || fee.phase === "preview" ? fee.body : fallback;
    this.#fee = { phase: "preview", body, note: "" };
  }

  // Drop a scheduled or in-flight quote so it cannot commit over a newer input or a transaction.
  #bumpQuote(): void {
    this.#feeSeq++;
    if (this.#feeTimer !== undefined) {
      clearTimeout(this.#feeTimer);
      this.#feeTimer = undefined;
    }
  }

  #commit(seq: number, next: FeeState): void {
    if (seq !== this.#feeSeq || this.busy) return;
    this.#fee = next;
  }

  // Re-reads the inputs the effect tracked. A transaction keeps the current phase until it unlocks.
  #invalidateQuote(): void {
    this.#bumpQuote();
    if (this.busy) return;
    const parsed = this.#tryAmount();
    if (!parsed.ok) {
      this.#fee = { phase: "idle", note: "Enter a valid amount." };
      return;
    }
    if (parsed.amount <= 0n) {
      this.#fee = { phase: "idle", note: "" };
      return;
    }
    const seq = this.#feeSeq;
    this.#fee = { phase: "loading" };
    this.#feeTimer = setTimeout(() => {
      this.#feeTimer = undefined;
      void this.#loadFee(seq);
    }, 400);
  }

  #tryAmount(): { ok: true; amount: bigint } | { ok: false } {
    try {
      return { ok: true, amount: this.#amountUnits() };
    } catch {
      return { ok: false };
    }
  }

  async #loadFee(seq: number): Promise<void> {
    if (seq !== this.#feeSeq || this.busy) return;
    const parsed = this.#tryAmount();
    if (!parsed.ok) {
      this.#commit(seq, { phase: "idle", note: "Enter a valid amount." });
      return;
    }
    const amount = parsed.amount;
    if (amount <= 0n) {
      this.#commit(seq, { phase: "idle", note: "" });
      return;
    }
    const r = this.route;
    const mode = transferMode(r, { fast: this.fast, selfMint: this.selfMint });
    try {
      const next = await fetchQuote(r, amount, this.#quoteRecipient(), mode.fast, mode.selfMint);
      if (seq !== this.#feeSeq || this.busy) return;
      if (!this.#me || !this.#provider) {
        this.#commit(seq, { phase: "preview", body: next, note: "" });
        return;
      }
      const to = this.#recipient();
      const why = spendError(r, amount, await this.#tokenBalance(r.src.token));
      if (seq !== this.#feeSeq || this.busy) return;
      if (why) {
        this.#commit(seq, { phase: "preview", body: next, note: why });
        return;
      }
      const allowance = await erc20(r.src.token, this.#provider).allowance(
        this.#me,
        r.tokenManager
      );
      this.#commit(seq, {
        phase: "ready",
        body: next,
        pending: {
          selection: {
            key: this.routeKey,
            amount,
            to: to.address,
            fast: mode.fast,
            selfMint: mode.selfMint
          },
          body: next
        },
        needsApproval: allowance < amount
      });
    } catch (e) {
      if (seq !== this.#feeSeq || this.busy) return;
      const message = errorText(e);
      this.#commit(seq, { phase: "idle", note: message });
      this.log("ERROR: " + message);
    }
  }

  #quoteRecipient(): string {
    if (this.recipientKey !== "self") {
      const entry = this.book.find((item) => item.address === this.recipientKey);
      if (entry) return lib().getAddress(entry.address);
    }
    return this.#me ?? lib().ZeroAddress;
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
    const amount = lib().formatUnits(bal, r.decimals);
    this.balanceText = `You have ${amount} ${r.symbol} on ${CHAINS[r.src.chainId].name} · ${lib().formatEther(gas)} ${CHAINS[r.src.chainId].native} for gas`;
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
    // Cancel before the first await. The effect also sees busy, but only after this stack yields.
    this.#bumpQuote();
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      this.log("ERROR: " + errorText(e));
    } finally {
      const fee = this.#fee;
      if (fee.phase === "ready") this.#fee = { phase: "preview", body: fee.body, note: "" };
      this.busy = false;
    }
  }
}

export const bridge = new Bridge();
