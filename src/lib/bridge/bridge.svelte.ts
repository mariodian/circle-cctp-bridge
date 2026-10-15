import type { BrowserProvider, Eip1193Provider, JsonRpcSigner } from "ethers";
import {
  CHAINS,
  ROUTES,
  WRAP_MAX_RESERVE,
  WRAP_MIN_LEFT,
  assetsOn,
  fastAllowed,
  fastLabel,
  selfMintLabel,
  fillable,
  isChainId,
  isTxHash,
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
} from "$lib/cctp/logic.js";
import { erc20, errorText, lib, weth } from "$lib/cctp/contracts.js";
import {
  confirmRecipient,
  fetchQuote,
  selfMintOnDestination,
  sendAndWatch,
  verifyRoute,
  type Deps,
  type Recipient,
  type SendIntent
} from "$lib/cctp/transfer.js";

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

export type RecipientKey = "self" | `0x${string}`;

export type Holding = {
  id: string;
  kind: "native" | "token";
  symbol: string;
  amount: string;
  raw: bigint;
};

export type Holdings =
  | { phase: "idle" }
  | { phase: "loading"; account: string; chainId: number }
  | { phase: "error"; account: string; chainId: number }
  | { phase: "ready"; account: string; chainId: number; native: string; rows: Holding[] };

type WalletEvents = {
  on: (event: string, cb: (accounts: unknown) => void) => void;
  removeListener: (event: string, cb: (accounts: unknown) => void) => void;
};

type WalletSession = {
  provider: BrowserProvider;
  signer: JsonRpcSigner;
  account: string;
  chainId: number;
};

type AmountFill = "always" | "ifEmpty" | "keep";

function walletEvents(eth: Eip1193Provider): WalletEvents | undefined {
  if (!("on" in eth) || typeof eth.on !== "function") return undefined;
  if (!("removeListener" in eth) || typeof eth.removeListener !== "function") return undefined;
  return eth as Eip1193Provider & WalletEvents;
}

function accountList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}

function sessionKey(session: WalletSession): string {
  return `${session.account.toLowerCase()}:${session.chainId}`;
}

function isAddressKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

// `invalid` is a bad amount. `spend` is spendError. Any other note is a form message.
type AmountReason = "invalid" | "spend";

type FeeNote = { note: string; reason?: AmountReason };

// Buttons and the fee skeleton are reads of this. They cannot disagree.
// `selection` says which inputs produced `body`. Only `ready` may be sent.
// `needsApproval` is the last allowance read for that selection. Loading keeps it
// across a reload, and preview keeps it while a transaction holds the quote.
// A new selection, a disconnect, an invalid amount, or a quote error clears it.
type FeeState =
  | ({ phase: "idle" } & FeeNote)
  | { phase: "loading"; needsApproval: boolean; selection: QuoteSelection | null }
  | ({
      phase: "preview";
      body: Quoted;
      selection: QuoteSelection;
      needsApproval: boolean;
    } & FeeNote)
  | { phase: "ready"; body: Quoted; selection: QuoteSelection; needsApproval: boolean };

export type RecipientChoice =
  { kind: "self" } | { kind: "book"; entry: AddressEntry } | { kind: "missing" };

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
  // Connect, route change, max, approve, send, resume, and a failed wallet follow. Shown under Send.
  actionError = $state("");
  // Address-book add and save failures. Shown in that dialog.
  bookError = $state("");
  book = $state<AddressEntry[]>([]);
  recipientKey = $state<RecipientKey>("self");
  busy = $state(false);
  holdings = $state<Holdings>({ phase: "idle" });
  #me = $state<string | undefined>();
  #chainId = $state<number | undefined>();

  #provider: BrowserProvider | undefined;
  #signer: JsonRpcSigner | undefined;
  #offWallet: (() => void) | undefined;
  // Bumped on disconnect and at the start of every background wallet read.
  // A wallet read publishes only when it still owns this value.
  #live = 0;
  // Account or chain changed during #run. Follow the wallet once busy clears.
  #resync = false;
  // Portfolio reads. Independent of #live, so a send cannot discard or clobber one.
  #portfolioGen = 0;
  #portfolioKey: string | undefined;
  #portfolioTask: Promise<void> = Promise.resolve();
  // Displayed quote. #invalidateQuote owns every exit. #commit publishes a fetch. Send replaces body only.
  #fee = $state<FeeState>({ phase: "idle", note: "" });
  #feeTimer: ReturnType<typeof setTimeout> | undefined;
  #feeSeq = 0;

  me = $derived(this.#me);
  networkName = $derived.by(() => {
    const id = this.#chainId;
    if (id === undefined) return "";
    return isChainId(id) ? CHAINS[id].name : `Chain ${id}`;
  });
  route = $derived(ROUTES[this.routeKey]);
  recipient = $derived.by((): RecipientChoice => this.#choice());
  shownQuote = $derived.by(() => this.#shown());
  fastLocked = $derived(this.busy || !fastAllowed(this.route));
  selfMintDisabled = $derived(this.busy || selfMintLocked(this.route));
  fastText = $derived(fastLabel(this.route));
  selfMintText = $derived(selfMintLabel(this.route));
  mode = $derived(transferMode(this.route, { fast: this.fast, selfMint: this.selfMint }));
  feeLoading = $derived(this.#fee.phase === "loading");
  // Label only. approveOn and sendOn stay the "ready right now" gates.
  needsApproval = $derived(this.#fee.phase !== "idle" && this.#fee.needsApproval);
  approveOn = $derived.by(() => {
    const fee = this.#fee;
    return fee.phase === "ready" && fee.needsApproval;
  });
  sendOn = $derived.by(() => {
    const fee = this.#fee;
    return fee.phase === "ready" && !fee.needsApproval;
  });
  // Null when the quote has nothing to say. `reason` marks an amount-field note.
  feeNote = $derived.by((): { text: string; reason?: AmountReason } | null => {
    const fee = this.#fee;
    if ((fee.phase !== "idle" && fee.phase !== "preview") || fee.note === "") return null;
    return fee.reason ? { text: fee.note, reason: fee.reason } : { text: fee.note };
  });
  canWrap = $derived(wraps(this.route));
  wrapOn = $derived(this.canWrap && this.me !== undefined);
  resumeOn = $derived(this.me !== undefined);

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
        this.me;
        this.#invalidateQuote();
      });
      // Dismiss a send or wallet error when the form changes. `me` is left out so a
      // failed wallet follow can publish the error after it clears the session.
      // The first run is the subscription, not a user edit.
      let formReady = false;
      $effect(() => {
        this.routeKey;
        this.amount;
        this.fast;
        this.selfMint;
        this.recipientKey;
        if (!formReady) {
          formReady = true;
          return;
        }
        this.actionError = "";
      });
    });
    import.meta.hot?.dispose(() => {
      stop();
      this.#offWallet?.();
    });
    void this.#restore();
  }

  selectRecipient(key: string): void {
    if (this.busy) return;
    if (key === "self") {
      this.recipientKey = "self";
      return;
    }
    if (isAddressKey(key)) this.recipientKey = key;
  }

  log(m: string): void {
    this.logText += m + "\n";
  }

  setRoute(key: string): void {
    if (this.busy || !isRouteKey(key) || key === this.routeKey) return;
    this.routeKey = key;
    this.#applyRouteDefaults();
    // The old source is no longer on screen. Rewrite or clear before the chain switch.
    this.#syncBalanceText();
    if (!this.me) return;
    void this.#run(async () => {
      await this.#ensureChain(this.route.src.chainId);
      await this.#matchRoute(this.#live, "keep");
    });
  }

  addEntry(label: string, address: string): boolean {
    if (this.busy) return false;
    const result = validEntry({ label, address: address.trim() }, lib().getAddress);
    if (!result.ok) {
      this.bookError = result.error;
      return false;
    }
    const entry = result.entry;
    if (this.book.some((e) => e.address.toLowerCase() === entry.address.toLowerCase())) {
      this.bookError = "This address is already in the address book.";
      return false;
    }
    this.bookError = "";
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

  async disconnect(): Promise<void> {
    if (this.busy) return;
    const eth = window.ethereum;
    if (eth) {
      try {
        await eth.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }]
        });
      } catch {
        // Wallets without revoke still drop the page session below.
      }
    }
    this.#clearSession();
  }

  async connect(): Promise<void> {
    await this.#run(async () => {
      const eth = this.#ethereum();
      this.#listen(eth);
      const r = this.route;
      await eth.request({ method: "eth_requestAccounts" });
      await this.#ensureChain(r.src.chainId);
      const live = this.#live;
      await this.#matchRoute(live, "always");
      if (live !== this.#live) return;
      this.log(
        `Connected on ${CHAINS[r.src.chainId].name} as ${this.#wallet().me}. Circle contracts verified.`
      );
    });
  }

  async max(): Promise<void> {
    await this.#run(async () => {
      if (!this.me || !this.#provider) throw new Error("Connect your wallet first.");
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

  // undefined when the deposit finished. A string when it did not, "" if the wallet was busy.
  async wrap(amount: bigint): Promise<string | undefined> {
    return this.#attempt(async () => {
      const r = this.route;
      if (!wraps(r)) throw new Error("Wrapping is only for the WETH Ethereum → Arc route.");
      await this.#ensureChain(r.src.chainId);
      const { provider: p, signer: s, me: who } = this.#wallet();
      const eth = await p.getBalance(who);
      const native = CHAINS[r.src.chainId].native;
      if (eth - amount < WRAP_MIN_LEFT)
        throw new Error(`Keep at least ${lib().formatEther(WRAP_MIN_LEFT)} ${native} for gas.`);
      const tx = await weth(r.src.token, s).deposit({ value: amount });
      this.log("Wrap sent: " + CHAINS[r.src.chainId].explorer + tx.hash);
      await tx.wait();
      await this.reloadPortfolio();
      this.log("Wrap confirmed.");
    });
  }

  async approve(): Promise<void> {
    const ready = this.#readySelection();
    await this.#run(async () => {
      const intent = await this.#readIntent();
      if (!quoteStillMatches(ready, intent.selection))
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
    const ready = this.#readySelection();
    const quoted = this.#shown();
    await this.#run(async () => {
      const intent = await this.#readIntent();
      if (!ready || !quoted || !quoteStillMatches(ready, intent.selection))
        throw new Error("Wait for the fee for this route, amount, recipient and mode.");
      const why = spendError(
        intent.route,
        intent.amount,
        await this.#tokenBalance(intent.route.src.token)
      );
      // The quote reload shows this under the amount field. It is not an action error.
      if (why) return;
      await confirmRecipient(this.#deps(), intent.route, intent.to);
      await sendAndWatch(this.#deps(), intent, quoted, {
        onQuote: (body) => {
          const fee = this.#fee;
          if (fee.phase !== "ready" && fee.phase !== "preview") return;
          this.#fee = { ...fee, body };
        },
        onSubmitted: (hash) => {
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
      if (!this.me) throw new Error("Connect your wallet first.");
      await selfMintOnDestination(this.#deps(), r, hash, true);
    });
  }

  #applyRouteDefaults(): void {
    const r = this.route;
    const mode = transferMode(r, { fast: r.defaultFast, selfMint: r.defaultSelfMint });
    this.fast = mode.fast;
    this.selfMint = mode.selfMint;
    this.balanceText = "";
    this.#invalidateQuote();
  }

  #shown(): Quoted | null {
    const fee = this.#fee;
    return fee.phase === "preview" || fee.phase === "ready" ? fee.body : null;
  }

  #readySelection(): QuoteSelection | null {
    return this.#fee.phase === "ready" ? this.#fee.selection : null;
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

  // Re-reads the inputs the effect tracked. A transaction keeps a matching quote on screen.
  #invalidateQuote(): void {
    this.#bumpQuote();
    const parsed = this.#tryAmount();
    if (!parsed.ok) {
      this.#fee = { phase: "idle", note: "Enter a valid amount.", reason: "invalid" };
      return;
    }
    if (parsed.amount <= 0n) {
      this.#fee = { phase: "idle", note: "" };
      return;
    }
    if (this.busy) {
      this.#holdQuote(parsed.amount);
      return;
    }
    const seq = this.#feeSeq;
    const carried = this.me ? this.#carriedApproval(parsed.amount) : false;
    this.#fee = {
      phase: "loading",
      needsApproval: carried,
      selection: carried ? this.#quotedSelection(parsed.amount) : null
    };
    const amount = parsed.amount;
    this.#feeTimer = setTimeout(() => {
      this.#feeTimer = undefined;
      void this.#loadFee(seq, amount);
    }, 400);
  }

  // Keep the numbers only when they still describe this form. Ready is no longer sendable.
  #holdQuote(amount: bigint): void {
    const fee = this.#fee;
    if (fee.phase === "loading") {
      if (fee.selection && this.#sameSelection(fee.selection, amount)) return;
      this.#fee = { phase: "idle", note: "" };
      return;
    }
    if (
      (fee.phase === "ready" || fee.phase === "preview") &&
      this.#sameSelection(fee.selection, amount)
    ) {
      if (fee.phase === "ready")
        this.#fee = {
          phase: "preview",
          body: fee.body,
          selection: fee.selection,
          needsApproval: fee.needsApproval,
          note: ""
        };
      return;
    }
    if (fee.phase !== "idle") this.#fee = { phase: "idle", note: "" };
  }

  // True when the fee on screen is an allowance shortfall for this amount.
  #carriedApproval(amount: bigint): boolean {
    const fee = this.#fee;
    if (fee.phase === "idle" || !fee.needsApproval || fee.selection === null) return false;
    return this.#sameSelection(fee.selection, amount);
  }

  #quotedSelection(amount: bigint): QuoteSelection | null {
    const to = this.#quoteTo();
    return to === undefined ? null : this.#selection(amount, to);
  }

  #sameSelection(selection: QuoteSelection, amount: bigint): boolean {
    const to = this.#quoteTo();
    const mode = this.mode;
    return (
      selection.key === this.routeKey &&
      selection.amount === amount &&
      selection.fast === mode.fast &&
      selection.selfMint === mode.selfMint &&
      to !== undefined &&
      selection.to === to
    );
  }

  #selection(amount: bigint, to: string): QuoteSelection {
    const mode = this.mode;
    return {
      key: this.routeKey,
      amount,
      to,
      fast: mode.fast,
      selfMint: mode.selfMint
    };
  }

  #tryAmount(): { ok: true; amount: bigint } | { ok: false } {
    try {
      return { ok: true, amount: this.#amountUnits() };
    } catch {
      return { ok: false };
    }
  }

  async #loadFee(seq: number, amount: bigint): Promise<void> {
    if (seq !== this.#feeSeq || this.busy) return;
    const quotedTo = this.#quoteTo();
    if (quotedTo === undefined) {
      this.#commit(seq, { phase: "idle", note: "Pick a recipient from the address book." });
      return;
    }
    const r = this.route;
    const mode = this.mode;
    try {
      const next = await fetchQuote(r, amount, quotedTo, mode.fast, mode.selfMint);
      if (seq !== this.#feeSeq || this.busy) return;
      if (!this.me || !this.#provider) {
        this.#commit(seq, {
          phase: "preview",
          body: next,
          selection: this.#selection(amount, quotedTo),
          needsApproval: false,
          note: ""
        });
        return;
      }
      const to = this.#recipient();
      const why = spendError(r, amount, await this.#tokenBalance(r.src.token));
      if (seq !== this.#feeSeq || this.busy) return;
      const selection = this.#selection(amount, to.address);
      if (why) {
        const fee = this.#fee;
        this.#commit(seq, {
          phase: "preview",
          body: next,
          selection,
          needsApproval: fee.phase === "loading" && fee.needsApproval,
          note: why,
          reason: "spend"
        });
        return;
      }
      const allowance = await erc20(r.src.token, this.#provider).allowance(this.me, r.tokenManager);
      this.#commit(seq, {
        phase: "ready",
        body: next,
        selection,
        needsApproval: allowance < amount
      });
    } catch (e) {
      if (seq !== this.#feeSeq || this.busy) return;
      this.#commit(seq, { phase: "idle", note: errorText(e) });
    }
  }

  #choice(): RecipientChoice {
    if (this.recipientKey === "self") return { kind: "self" };
    const entry = this.book.find((item) => item.address === this.recipientKey);
    return entry ? { kind: "book", entry } : { kind: "missing" };
  }

  // Address the quote is priced for. Undefined when the key is not in the book.
  #quoteTo(): string | undefined {
    const choice = this.#choice();
    if (choice.kind === "missing") return undefined;
    if (choice.kind === "book") return lib().getAddress(choice.entry.address);
    return this.me ?? lib().ZeroAddress;
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
    if (ok.length !== raw.length) {
      const n = raw.length - ok.length;
      this.log(`Ignored ${n} invalid address book entr${n === 1 ? "y" : "ies"}.`);
    }
    return ok;
  }

  #saveBook(): void {
    try {
      localStorage.setItem(AB_KEY, JSON.stringify(this.book));
    } catch {
      this.bookError = "Could not save the address book in this browser.";
    }
  }

  #wallet(): { provider: BrowserProvider; signer: JsonRpcSigner; me: string } {
    if (!this.#provider || !this.#signer || !this.me) throw new Error("Connect your wallet first.");
    return { provider: this.#provider, signer: this.#signer, me: this.me };
  }

  #ethereum(): NonNullable<Window["ethereum"]> {
    if (!window.ethereum) throw new Error("No wallet found in this browser (Rabby, MetaMask…).");
    return window.ethereum;
  }

  // Silent restore. eth_accounts returns an already-approved account and does not prompt.
  async #restore(): Promise<void> {
    if (!window.ethereum) return;
    this.#listen(window.ethereum);
    await this.#followWallet();
  }

  #listen(eth: Eip1193Provider): void {
    if (this.#offWallet) return;
    const events = walletEvents(eth);
    if (!events) return;
    const onAccounts = (value: unknown) => {
      const accounts = accountList(value);
      if (!accounts) return;
      this.#onAccounts(accounts);
    };
    const onChain = () => {
      this.#onChain();
    };
    events.on("accountsChanged", onAccounts);
    events.on("chainChanged", onChain);
    this.#offWallet = () => {
      events.removeListener("accountsChanged", onAccounts);
      events.removeListener("chainChanged", onChain);
    };
  }

  #onAccounts(accounts: string[]): void {
    if (this.busy) {
      this.#resync = true;
      return;
    }
    if (accounts.length === 0 || !window.ethereum) {
      this.#clearSession();
      return;
    }
    void this.#followWallet();
  }

  #onChain(): void {
    if (!this.me) return;
    if (this.busy) {
      this.#resync = true;
      return;
    }
    void this.#followWallet();
  }

  #clearSession(): void {
    this.#live += 1;
    this.#me = undefined;
    this.#chainId = undefined;
    this.#provider = undefined;
    this.#signer = undefined;
    this.balanceText = "";
    this.#portfolioGen += 1;
    this.#portfolioKey = undefined;
    this.holdings = { phase: "idle" };
  }

  #session(): WalletSession | undefined {
    const provider = this.#provider;
    const signer = this.#signer;
    const account = this.#me;
    const chainId = this.#chainId;
    if (!provider || !signer || !account || chainId === undefined) return undefined;
    return { provider, signer, account, chainId };
  }

  // Route dialog and wrap. Always reads again. The send line follows the same snapshot.
  async reloadPortfolio(): Promise<void> {
    const session = this.#session();
    if (!session) {
      this.#portfolioGen += 1;
      this.#portfolioKey = undefined;
      this.holdings = { phase: "idle" };
      return;
    }
    this.#reloadHoldings(session);
    await this.#waitPortfolio();
  }

  // Reads the injected wallet and writes nothing.
  async #readWallet(eth: Eip1193Provider): Promise<WalletSession> {
    const provider = new (lib().BrowserProvider)(eth);
    const net = await provider.getNetwork();
    const signer = await provider.getSigner();
    const account = await signer.getAddress();
    return { provider, signer, account, chainId: Number(net.chainId) };
  }

  // Only writer of a connected wallet session.
  // Skips the portfolio when this account and chain are already on screen.
  #publish(session: WalletSession): void {
    this.#provider = session.provider;
    this.#signer = session.signer;
    this.#me = session.account;
    this.#chainId = session.chainId;
    const book = this.holdings;
    if (
      sessionKey(session) === this.#portfolioKey &&
      book.phase === "ready" &&
      book.account === session.account &&
      book.chainId === session.chainId
    ) {
      this.#syncBalanceText();
      return;
    }
    this.#reloadHoldings(session);
  }

  #reloadHoldings(session: WalletSession): void {
    const gen = ++this.#portfolioGen;
    this.#portfolioKey = sessionKey(session);
    this.#portfolioTask = this.#loadPortfolio(session, gen);
  }

  async #waitPortfolio(): Promise<void> {
    for (;;) {
      const task = this.#portfolioTask;
      await task;
      if (task === this.#portfolioTask) return;
    }
  }

  // eth_accounts first so a locked or revoked wallet does not prompt.
  async #followWallet(): Promise<void> {
    if (this.busy) {
      this.#resync = true;
      return;
    }
    const eth = window.ethereum;
    if (!eth) {
      this.#clearSession();
      return;
    }
    const live = ++this.#live;
    try {
      const accounts = accountList(await eth.request({ method: "eth_accounts" }));
      if (live !== this.#live || this.busy) return;
      if (!accounts || accounts.length === 0) {
        this.#clearSession();
        return;
      }
      const session = await this.#readWallet(eth);
      if (live !== this.#live || this.busy) return;
      this.#publish(session);
      await this.#matchRoute(live, "ifEmpty");
    } catch (e) {
      if (live !== this.#live || this.busy) return;
      this.#clearSession();
      this.actionError = errorText(e);
    }
  }

  // Route source only. `keep` leaves the typed amount alone.
  async #matchRoute(live: number, fill: AmountFill): Promise<void> {
    if (live !== this.#live) return;
    if (this.#chainId !== this.route.src.chainId) {
      this.balanceText = "";
      return;
    }
    await verifyRoute(this.route, this.#wallet().provider);
    if (live !== this.#live) return;
    await this.#waitPortfolio();
    if (live !== this.#live) return;
    this.#syncBalanceText();
    const bal = this.#sourceRow()?.raw;
    if (bal === undefined) return;
    if (fill === "keep") return;
    if (fill === "always" || !this.amount.trim())
      this.amount = lib().formatUnits(
        fillable(bal, maxFillReserve(this.route)),
        this.route.decimals
      );
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
    const live = this.#live;
    const session = await this.#readWallet(eth);
    if (live !== this.#live) throw new Error("The wallet changed. Try again.");
    if (session.chainId !== chainId)
      throw new Error(`The wallet is not on ${c.name} (chainId ${session.chainId}).`);
    this.#publish(session);
  }

  // Send line for the route source.
  // Only a ready read for this account on that chain keeps the line. Every other phase clears it.
  #syncBalanceText(): void {
    const book = this.holdings;
    const route = this.route;
    const token = this.#sourceRow();
    const gas = book.phase === "ready" ? book.rows.find((row) => row.kind === "native") : undefined;
    if (!token || !gas) {
      this.balanceText = "";
      return;
    }
    const chain = CHAINS[route.src.chainId];
    this.balanceText =
      `You have ${token.amount} ${route.symbol} on ${chain.name}` +
      ` · ${gas.amount} ${chain.native} for gas`;
  }

  // Route-source row once the portfolio is ready for that account and chain.
  #sourceRow(): Holding | undefined {
    const book = this.holdings;
    const route = this.route;
    if (book.phase !== "ready" || book.account !== this.#me || book.chainId !== route.src.chainId)
      return undefined;
    const token = route.src.token.toLowerCase();
    return book.rows.find((row) => row.kind === "token" && row.id.toLowerCase() === token);
  }

  // Native gas plus each token this app bridges on the wallet's current chain.
  async #loadPortfolio(session: WalletSession, gen: number): Promise<void> {
    const shown = this.holdings;
    const keep =
      shown.phase === "ready" &&
      shown.account === session.account &&
      shown.chainId === session.chainId;
    if (!keep) {
      this.holdings = { phase: "loading", account: session.account, chainId: session.chainId };
      // Drop the previous account or chain before the read returns.
      this.#syncBalanceText();
    }
    try {
      const chainId = session.chainId;
      const known = isChainId(chainId);
      const native = known ? CHAINS[chainId].native : "Native";
      const assets = known ? assetsOn(chainId) : [];
      const [gas, bals] = await Promise.all([
        session.provider.getBalance(session.account),
        Promise.all(
          assets.map((asset) => erc20(asset.token, session.provider).balanceOf(session.account))
        )
      ]);
      if (gen !== this.#portfolioGen) return;
      const rows: Holding[] = [
        {
          id: "native",
          kind: "native",
          symbol: native,
          amount: lib().formatEther(gas),
          raw: gas
        }
      ];
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const bal = bals[i];
        if (!asset || bal === undefined) continue;
        rows.push({
          id: asset.token,
          kind: "token",
          symbol: asset.symbol,
          amount: lib().formatUnits(bal, asset.decimals),
          raw: bal
        });
      }
      this.holdings = { phase: "ready", account: session.account, chainId, native, rows };
      this.#syncBalanceText();
    } catch {
      if (gen !== this.#portfolioGen) return;
      this.holdings = { phase: "error", account: session.account, chainId: session.chainId };
      this.#syncBalanceText();
    }
  }

  async #tokenBalance(token: string): Promise<bigint> {
    const { provider: p, me: who } = this.#wallet();
    return erc20(token, p).balanceOf(who);
  }

  #recipient(): Recipient {
    if (!this.me) throw new Error("Connect your wallet first.");
    const choice = this.#choice();
    if (choice.kind === "self") return { address: this.me, self: true, label: "this wallet" };
    if (choice.kind === "book")
      return {
        address: lib().getAddress(choice.entry.address),
        self: false,
        label: choice.entry.label
      };
    throw new Error("The recipient must be this wallet or an address from your address book.");
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

  // Clears the send-card error only when this call starts. A busy return leaves it.
  async #run(fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.actionError = "";
    const error = await this.#attempt(fn);
    if (error) this.actionError = error;
  }

  // undefined when the body finished. "" when the wallet was already busy. Otherwise the caught message.
  async #attempt(fn: () => Promise<void>): Promise<string | undefined> {
    if (this.busy) return "";
    this.busy = true;
    // Drop a background wallet read and sendable quote state before the first await.
    this.#live += 1;
    this.#invalidateQuote();
    try {
      await fn();
      return undefined;
    } catch (e) {
      return errorText(e);
    } finally {
      this.busy = false;
      this.#invalidateQuote();
      if (this.#resync) {
        this.#resync = false;
        void this.#followWallet();
      }
    }
  }
}

export const bridge = new Bridge();
