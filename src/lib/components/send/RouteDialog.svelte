<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { CHAINS, CHAIN_IDS, routeMatching, symbolsOn, type ChainId } from "$lib/cctp/logic.js";

  let { title, side }: { title: string; side: "src" | "dst" } = $props();

  let open = $state(false);

  function choose(chainId: ChainId, symbol: string): void {
    const key = routeMatching(bridge.routeKey, side, chainId, symbol);
    if (!key) return;
    bridge.setRoute(key);
    open = false;
  }
</script>

<Dialog.Root bind:open>
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
          {#if symbols.length > 0}
            <div>
              <p class="text-muted-foreground mb-2 text-xs font-medium">{chain.name}</p>
              <Separator class="mb-2" />
              <div class="flex flex-col gap-1">
                {#each symbols as symbol (symbol)}
                  <Button
                    variant="ghost"
                    class="justify-start"
                    disabled={bridge.busy}
                    onclick={() => choose(chainId, symbol)}
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
