<script lang="ts">
  import ArrowRightLeftIcon from "@lucide/svelte/icons/arrow-right-left";
  import MoveRightIcon from "@lucide/svelte/icons/move-right";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { CHAINS, reverseRoute } from "$lib/cctp/logic.js";
  import ErrorAlert from "$lib/components/ErrorAlert.svelte";
  import QuoteSummary from "./QuoteSummary.svelte";
  import RecipientDialog from "./RecipientDialog.svelte";
  import RouteDialog from "./RouteDialog.svelte";
  import WrapDialog from "./WrapDialog.svelte";

  const swapped = $derived(reverseRoute(bridge.routeKey));
  const amountError = $derived(bridge.feeNote?.reason ? bridge.feeNote.text : "");
  const formError = $derived(bridge.feeNote && !bridge.feeNote.reason ? bridge.feeNote.text : "");

  const AMOUNT_MAX_PX = 48;
  const AMOUNT_MIN_PX = 24;
  let amtRef = $state<HTMLInputElement | null>(null);
  let measure: CanvasRenderingContext2D | null = null;
  let sheet: CSSStyleSheet | undefined;

  // script-src already trusts this page, so a constructable sheet can set the size.
  // A style attribute cannot: production CSP is style-src 'self'.
  function applySize(size: number) {
    sheet ??= new CSSStyleSheet();
    if (!document.adoptedStyleSheets.includes(sheet)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(`input#amt { font-size: ${size}px }`);
  }

  function textWidth(style: CSSStyleDeclaration, px: number, text: string) {
    if (!measure) return 0;
    measure.font = style.font.replace(/(\d+(?:\.\d+)?)px/, `${px}px`);
    const spacing = style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing);
    const extra = Number.isFinite(spacing) ? spacing * Math.max(0, text.length - 1) : 0;
    return measure.measureText(text).width + extra;
  }

  function fitAmount() {
    const el = amtRef;
    if (!el || el.clientWidth === 0) return;
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return;
    const style = getComputedStyle(el);
    const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const room = el.clientWidth - (Number.isFinite(pad) ? pad : 0);
    const text = el.value;
    if (text === "") {
      applySize(AMOUNT_MAX_PX);
      return;
    }
    const full = textWidth(style, AMOUNT_MAX_PX, text);
    let size =
      full <= room
        ? AMOUNT_MAX_PX
        : Math.max(AMOUNT_MIN_PX, Math.floor((AMOUNT_MAX_PX * room) / full));
    while (size > AMOUNT_MIN_PX && textWidth(style, size, text) > room) size -= 1;
    applySize(size);
  }

  $effect(() => {
    bridge.amount;
    fitAmount();
  });

  $effect(() => {
    const el = amtRef;
    if (!el) return;
    const observer = new ResizeObserver(() => fitAmount());
    observer.observe(el);
    return () => observer.disconnect();
  });

  $effect(() => {
    return () => {
      if (!sheet) return;
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
    };
  });
</script>

<Card.Root>
  <Card.Content class="flex flex-col gap-6">
    <div class="flex items-center justify-center gap-3">
      <RouteDialog title="From" side="src" />
      <Button
        id="swap"
        variant="ghost"
        size="icon"
        class="text-muted-foreground border-transparent bg-transparent shadow-none hover:border-border hover:bg-transparent"
        aria-label="Swap From and To"
        disabled={bridge.busy || swapped === undefined}
        onclick={() => {
          if (swapped) bridge.setRoute(swapped);
        }}
      >
        <MoveRightIcon class="group-hover/button:hidden" />
        <ArrowRightLeftIcon class="hidden group-hover/button:block" />
      </Button>
      <RouteDialog title="To" side="dst" />
    </div>

    <div>
      <div class="flex items-end gap-3">
        <Input
          id="amt"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          disabled={bridge.busy}
          bind:value={bridge.amount}
          bind:ref={amtRef}
          class="h-auto border-0 bg-transparent px-0 font-medium shadow-none focus-visible:ring-0"
        />
        <span class="text-muted-foreground pb-2 text-2xl" id="sym">{bridge.route.symbol}</span>
      </div>
      <ErrorAlert text={amountError} class="mt-3" />
      <p class="text-muted-foreground mt-2 text-sm">
        {bridge.balanceText ||
          `You have no ${bridge.route.symbol} balance loaded on ${CHAINS[bridge.route.src.chainId].name}`}
        <Button
          id="max"
          variant="link"
          class="h-auto px-1"
          disabled={bridge.busy}
          onclick={() => bridge.max()}>Max</Button
        >
      </p>
    </div>

    <RecipientDialog />

    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-4">
        <Label for="fast">Fast transfer</Label>
        <div class="flex items-center gap-2">
          <span class="text-sm">Fast</span>
          <Switch id="fast" disabled={bridge.fastLocked} bind:checked={bridge.fast} />
        </div>
      </div>
      <p class="text-muted-foreground -mt-2 text-xs" id="fastLabel">{bridge.fastText}</p>
      <div class="flex items-center justify-between gap-4">
        <Label for="selfMint">Sign the mint</Label>
        <div class="flex items-center gap-2">
          <span class="text-sm">I sign</span>
          <Switch id="selfMint" disabled={bridge.selfMintDisabled} bind:checked={bridge.selfMint} />
        </div>
      </div>
      <p class="text-muted-foreground -mt-2 text-xs" id="selfMintLabel">{bridge.selfMintText}</p>
    </div>

    <QuoteSummary />

    <div class="flex flex-wrap gap-2">
      {#if bridge.canWrap}
        <WrapDialog />
      {/if}
      <Button
        id="approve"
        variant="secondary"
        disabled={bridge.busy || !bridge.approveOn}
        onclick={() => bridge.approve()}>Approve</Button
      >
    </div>
    <div class="flex flex-col gap-3">
      <Button
        id="send"
        class="h-12 w-full text-base"
        disabled={bridge.busy || !bridge.sendOn}
        onclick={() => bridge.send()}>Send</Button
      >
      <ErrorAlert text={formError} />
      <ErrorAlert text={bridge.actionError} />
    </div>
  </Card.Content>
</Card.Root>

<style>
  /* :global because #amt is the root of the Input child. Size comes from the adopted sheet. */
  :global(#amt) {
    font-size: 48px;
    line-height: 1.1;
  }
</style>
