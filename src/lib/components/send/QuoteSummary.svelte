<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { maxFillNote, routeTime } from "$lib/cctp/logic.js";
  import { feeText, receiveText } from "$lib/format.js";

  const quote = $derived(bridge.shownQuote);
  const reserveNote = $derived(maxFillNote(bridge.route));
</script>

<dl class="grid grid-cols-[1fr_auto] items-center gap-y-2 text-sm">
  <dt class="text-muted-foreground">Time</dt>
  <dd class="text-muted-foreground justify-self-end text-right">
    {routeTime(bridge.route, bridge.mode.fast)}
  </dd>
  <dt class="text-muted-foreground flex items-center gap-1">
    Fees
    {#if reserveNote}
      <Tooltip.Root>
        <Tooltip.Trigger class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
          >?</Tooltip.Trigger
        >
        <Tooltip.Content>{reserveNote}</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  </dt>
  <dd class="text-muted-foreground justify-self-end text-right">
    {#if bridge.feeLoading}
      <Skeleton class="ml-auto h-4 w-24" />
    {:else}
      {feeText(bridge.route, bridge.amount, quote)}
    {/if}
  </dd>
  <dt>You'll receive</dt>
  <dd class="text-muted-foreground justify-self-end text-right font-medium">
    {#if bridge.feeLoading}
      <Skeleton class="ml-auto h-4 w-28" />
    {:else}
      {receiveText(bridge.route, bridge.amount, quote)}
    {/if}
  </dd>
</dl>
