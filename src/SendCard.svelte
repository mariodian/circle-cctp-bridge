<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { bridge, shortAddress } from "./bridge.svelte.js";
  import { CHAINS, routeMatching, routeTime, symbolsOn, type ChainId } from "./logic.js";

  const chainOrder: ChainId[] = [1, 5042, 43114];

  let fromOpen = $state(false);
  let toOpen = $state(false);
  let recipientOpen = $state(false);
  let abAddr = $state("");
  let abLabel = $state("");

  function choose(side: "src" | "dst", chainId: ChainId, symbol: string): void {
    const key = routeMatching(bridge.routeKey, side, chainId, symbol);
    if (!key) return;
    bridge.setRoute(key);
    fromOpen = false;
    toOpen = false;
  }

  function add(): void {
    if (bridge.addEntry(abLabel, abAddr)) {
      abAddr = "";
      abLabel = "";
    }
  }

  const recipientLabel = $derived.by(() => {
    if (bridge.recipientKey === "self") return bridge.me ? shortAddress(bridge.me) : "—";
    const entry = bridge.book.find((item) => item.address === bridge.recipientKey);
    return shortAddress(entry?.address ?? bridge.recipientKey);
  });
</script>

{#snippet tokenDialog(title: string, side: "src" | "dst", open: boolean)}
  <Dialog.Root
    {open}
    onOpenChange={(next) => {
      if (side === "src") fromOpen = next;
      else toOpen = next;
    }}
  >
    <Dialog.Trigger
      class={buttonVariants({
        variant: "outline",
        class: "h-auto min-w-32 flex-col gap-0 rounded-full px-4 py-2"
      })}
      disabled={bridge.busy}
    >
      {@const end = side === "src" ? bridge.route.src : bridge.route.dst}
      <span class="text-sm font-medium">{bridge.route.symbol}</span>
      <span class="text-muted-foreground text-xs">{CHAINS[end.chainId].name}</span>
    </Dialog.Trigger>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>Tokens grouped by network.</Dialog.Description>
      </Dialog.Header>
      <ScrollArea class="h-80 pr-3">
        <div class="flex flex-col gap-4">
          {#each chainOrder as chainId (chainId)}
            {@const symbols = symbolsOn(side, chainId)}
            {#if symbols.length > 0}
              <div>
                <p class="text-muted-foreground mb-2 text-xs font-medium">{CHAINS[chainId].name}</p>
                <Separator class="mb-2" />
                <div class="flex flex-col gap-1">
                  {#each symbols as symbol (symbol)}
                    <Button
                      variant="ghost"
                      class="justify-start"
                      disabled={bridge.busy}
                      onclick={() => choose(side, chainId, symbol)}
                    >
                      {symbol}
                    </Button>
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </ScrollArea>
    </Dialog.Content>
  </Dialog.Root>
{/snippet}

<Card.Root>
  <Card.Content class="flex flex-col gap-6">
    <div class="flex items-center justify-center gap-3">
      {@render tokenDialog("From", "src", fromOpen)}
      <span class="text-muted-foreground" aria-hidden="true">→</span>
      {@render tokenDialog("To", "dst", toOpen)}
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
          class="h-auto border-0 bg-transparent px-0 text-5xl font-medium shadow-none focus-visible:ring-0 md:text-5xl"
        />
        <span class="text-muted-foreground pb-2 text-2xl" id="sym">{bridge.symbol}</span>
      </div>
      <p class="text-muted-foreground mt-2 text-sm">
        {bridge.balanceText ||
          `You have no ${bridge.symbol} balance loaded on ${CHAINS[bridge.route.src.chainId].name}`}
        <Button
          id="max"
          variant="link"
          class="h-auto px-1"
          disabled={bridge.busy}
          onclick={() => bridge.max()}>Max</Button
        >
      </p>
    </div>

    <Dialog.Root bind:open={recipientOpen}>
      <Dialog.Trigger
        id="rcpt"
        class={buttonVariants({
          variant: "outline",
          class: "h-14 w-full justify-between rounded-2xl px-4"
        })}
        disabled={bridge.busy}
      >
        <span>Recipient</span>
        <span class="text-muted-foreground font-mono text-xs">{recipientLabel}</span>
      </Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Recipient</Dialog.Title>
          <Dialog.Description>
            Choose this wallet or an address from the address book.
          </Dialog.Description>
        </Dialog.Header>
        <div class="flex flex-col gap-2">
          <Button
            variant="ghost"
            class="justify-start"
            disabled={bridge.busy}
            onclick={() => {
              bridge.recipientKey = "self";
              recipientOpen = false;
            }}
          >
            {bridge.me ? `This wallet — ${shortAddress(bridge.me)}` : "This wallet (connect first)"}
          </Button>
          {#each bridge.book as entry (entry.address)}
            <Button
              variant="ghost"
              class="justify-start"
              disabled={bridge.busy}
              onclick={() => {
                bridge.recipientKey = entry.address;
                recipientOpen = false;
              }}
            >
              {entry.label} — {shortAddress(entry.address)}
            </Button>
          {/each}
        </div>
        <Separator />
        <div class="flex flex-col gap-3">
          <p class="text-sm font-medium">Address book</p>
          <p class="text-muted-foreground text-sm">
            Add only addresses you control. Copy them from your hardware wallet or your wallet's
            address book, never from a transaction history: scammers plant look-alike addresses
            there (address poisoning). Smart contract wallets (for example a Safe) can have a
            different address, or no deployment at all, on another network. The address book is
            stored only in this browser.
          </p>
          <Input
            id="abAddr"
            type="text"
            placeholder="0x…"
            autocomplete="off"
            spellcheck="false"
            bind:value={abAddr}
            disabled={bridge.busy}
            class="font-mono"
          />
          <Input
            id="abLabel"
            type="text"
            placeholder="Label, e.g. Ledger 2"
            maxlength={24}
            autocomplete="off"
            bind:value={abLabel}
            disabled={bridge.busy}
          />
          <Button id="abAdd" variant="secondary" disabled={bridge.busy} onclick={add}>Add</Button>
          <div id="abList" class="flex flex-col gap-2">
            {#each bridge.book as entry, i (entry.address)}
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs break-all">{entry.label} — {entry.address}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={bridge.busy}
                  onclick={() => bridge.removeEntry(i)}>Remove</Button
                >
              </div>
            {/each}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
    <p class="text-muted-foreground -mt-4 text-sm" id="rcptInfo">{bridge.rcptInfo}</p>

    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-4">
        <Label for="fast">Speed</Label>
        <div class="flex items-center gap-2">
          <span class="text-sm">Fast</span>
          <Switch id="fast" disabled={bridge.fastLocked} bind:checked={bridge.fast} />
        </div>
      </div>
      <p class="text-muted-foreground -mt-2 text-xs" id="fastLabel">{bridge.fastText}</p>
      <div class="flex items-center justify-between gap-4">
        <Label for="selfMint">Mint</Label>
        <div class="flex items-center gap-2">
          <span class="text-sm">I sign</span>
          <Switch id="selfMint" disabled={bridge.selfMintDisabled} bind:checked={bridge.selfMint} />
        </div>
      </div>
    </div>

    <dl class="grid grid-cols-[1fr_auto] items-center gap-y-2 text-sm">
      <dt class="text-muted-foreground">Time</dt>
      <dd class="text-muted-foreground justify-self-end text-right">
        {routeTime(bridge.route, bridge.mode.fast)}
      </dd>
      <dt class="text-muted-foreground flex items-center gap-1">
        Fees
        {#if bridge.reserveNote}
          <Tooltip.Root>
            <Tooltip.Trigger class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
              >?</Tooltip.Trigger
            >
            <Tooltip.Content>{bridge.reserveNote}</Tooltip.Content>
          </Tooltip.Root>
        {/if}
      </dt>
      <dd class="text-muted-foreground justify-self-end text-right">
        {#if bridge.feeLoading}
          <Skeleton class="ml-auto h-4 w-24" />
        {:else}
          {bridge.feeText}
        {/if}
      </dd>
      <dt>You'll receive</dt>
      <dd class="text-muted-foreground justify-self-end text-right font-medium">
        {#if bridge.feeLoading}
          <Skeleton class="ml-auto h-4 w-28" />
        {:else}
          {bridge.receiveText}
        {/if}
      </dd>
    </dl>

    {#if bridge.feeNote}
      <p class="text-sm">{bridge.feeNote}</p>
    {/if}

    <div class="flex flex-wrap gap-2">
      {#if bridge.canWrap}
        <Button
          id="wrap"
          variant="secondary"
          disabled={bridge.busy || !bridge.wrapOn}
          onclick={() => bridge.wrap()}>Wrap ETH</Button
        >
      {/if}
      <Button
        id="approve"
        variant="secondary"
        disabled={bridge.busy || !bridge.approveOn}
        onclick={() => bridge.approve()}>Approve</Button
      >
    </div>
    <Button
      id="send"
      class="h-12 w-full text-base"
      disabled={bridge.busy || !bridge.sendOn}
      onclick={() => bridge.send()}>Send</Button
    >
  </Card.Content>
</Card.Root>
