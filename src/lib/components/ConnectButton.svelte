<script lang="ts">
  import { Button, buttonVariants } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import ErrorAlert from "$lib/components/ErrorAlert.svelte";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { shortAddress } from "$lib/format.js";

  let open = $state(false);

  function disconnect(): void {
    void bridge.disconnect();
    open = false;
  }

  function holdingLabel(kind: "native" | "token", symbol: string, native: string): string {
    if (kind === "token" && symbol === native) return `${symbol} token`;
    return symbol;
  }
</script>

{#if bridge.me}
  <Dialog.Root bind:open>
    <Dialog.Trigger
      id="connect"
      class={buttonVariants({
        variant: "outline",
        class: "fixed top-4 right-4 z-30 rounded-full font-mono"
      })}
      disabled={bridge.busy}
    >
      {shortAddress(bridge.me)}
    </Dialog.Trigger>
    <Dialog.Content showCloseButton={false}>
      <Dialog.Header class="pr-28">
        <Dialog.Title>{bridge.networkName}</Dialog.Title>
        <Dialog.Description class="text-foreground font-mono break-all">
          {bridge.me}
        </Dialog.Description>
      </Dialog.Header>
      <Button
        variant="outline"
        size="sm"
        class="absolute top-4 right-4"
        disabled={bridge.busy}
        onclick={disconnect}
      >
        Disconnect
      </Button>
      {#if bridge.holdings.phase === "error"}
        <ErrorAlert text="Balance unavailable on this network." />
      {:else if bridge.holdings.phase === "ready"}
        {@const rows = bridge.holdings.rows.filter(
          (row) => row.kind === "native" || row.raw !== 0n
        )}
        <ul class="flex flex-col gap-3">
          {#each rows as row (row.id)}
            <li class="flex items-baseline justify-between gap-4">
              <span class="text-muted-foreground">
                {holdingLabel(row.kind, row.symbol, bridge.holdings.native)}
              </span>
              <span class="font-mono">{row.amount}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted-foreground">Loading balances…</p>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
{:else}
  <button
    id="connect"
    type="button"
    class={buttonVariants({
      variant: "outline",
      class: "fixed top-4 right-4 z-30 rounded-full font-mono"
    })}
    disabled={bridge.busy}
    onclick={() => bridge.connect()}
  >
    Connect wallet
  </button>
{/if}
