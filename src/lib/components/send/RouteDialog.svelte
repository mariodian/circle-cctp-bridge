<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import {
    CHAINS,
    CHAIN_IDS,
    ROUTES,
    routeMatching,
    symbolsOn,
    type ChainId
  } from "$lib/cctp/logic.js";

  let { title, side }: { title: string; side: "src" | "dst" } = $props();

  let open = $state(false);

  // Do not load from an $effect. reloadPortfolio writes holdings, and an effect that
  // called it would track that write and run forever.
  // This callback is the only writer of `open`. bits-ui reports the next value here.
  function onOpenChange(next: boolean): void {
    open = next;
    if (next) void bridge.reloadPortfolio();
  }

  // Amount on the wallet's current chain. Another chain, and a failed read, are empty.
  // The chain section owns the failure sentence.
  function pickerAmount(
    chainId: ChainId,
    symbol: string
  ): { kind: "amount"; text: string } | { kind: "loading" } | { kind: "empty" } {
    const book = bridge.holdings;
    if (book.phase === "idle" || book.chainId !== chainId || book.account !== bridge.me)
      return { kind: "empty" };
    if (book.phase === "loading") return { kind: "loading" };
    if (book.phase === "error") return { kind: "empty" };
    const token = Object.values(ROUTES)
      .find((route) => route.symbol === symbol && route[side].chainId === chainId)
      ?.[side].token.toLowerCase();
    const row = token
      ? book.rows.find((item) => item.kind === "token" && item.id.toLowerCase() === token)
      : undefined;
    return row ? { kind: "amount", text: row.amount } : { kind: "empty" };
  }

  function choose(chainId: ChainId, symbol: string): void {
    const key = routeMatching(bridge.routeKey, side, chainId, symbol);
    if (!key) return;
    bridge.setRoute(key);
    open = false;
  }
</script>

<Dialog.Root {open} {onOpenChange}>
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
        {#each CHAIN_IDS as chainId (chainId)}
          {@const chain = CHAINS[chainId]}
          {@const symbols = symbolsOn(side, chainId)}
          {@const book = bridge.holdings}
          {@const failed =
            book.phase === "error" && book.chainId === chainId && book.account === bridge.me}
          {#if symbols.length > 0}
            <div>
              <p class="text-muted-foreground mb-2 text-xs font-medium">{chain.name}</p>
              {#if failed}
                <p class="text-muted-foreground mb-2 text-xs">
                  Balance unavailable on this network.
                </p>
              {/if}
              <Separator class="mb-2" />
              <div class="flex flex-col gap-1">
                {#each symbols as symbol (symbol)}
                  {@const amount = bridge.me ? pickerAmount(chainId, symbol) : undefined}
                  <Button
                    variant="ghost"
                    class="h-auto w-full justify-between px-2"
                    disabled={bridge.busy}
                    onclick={() => choose(chainId, symbol)}
                  >
                    <span>{symbol}</span>
                    {#if amount?.kind === "amount"}
                      <span class="text-muted-foreground font-mono text-xs">{amount.text}</span>
                    {:else if amount?.kind === "loading"}
                      <Skeleton class="h-3 w-14" />
                    {:else if amount}
                      <span class="text-muted-foreground text-xs">—</span>
                    {/if}
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
