<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { CHAINS } from "$lib/cctp/logic.js";
  import QuoteSummary from "./QuoteSummary.svelte";
  import RecipientDialog from "./RecipientDialog.svelte";
  import RouteDialog from "./RouteDialog.svelte";
</script>

<Card.Root>
  <Card.Content class="flex flex-col gap-6">
    <div class="flex items-center justify-center gap-3">
      <RouteDialog title="From" side="src" />
      <span class="text-muted-foreground" aria-hidden="true">→</span>
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
          class="h-auto border-0 bg-transparent px-0 text-5xl font-medium shadow-none focus-visible:ring-0 md:text-5xl"
        />
        <span class="text-muted-foreground pb-2 text-2xl" id="sym">{bridge.route.symbol}</span>
      </div>
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

    <QuoteSummary />

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
