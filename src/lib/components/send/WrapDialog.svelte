<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import ErrorAlert from "$lib/components/ErrorAlert.svelte";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { lib } from "$lib/cctp/contracts.js";
  import { WRAP_MAX_RESERVE, fillable } from "$lib/cctp/logic.js";

  const AMOUNT_ERROR = "Enter the amount of ETH to wrap.";

  let open = $state(false);
  let ethAmount = $state("");
  let error = $state("");

  const ethRow = $derived.by(() => {
    const book = bridge.holdings;
    const chainId = bridge.route.src.chainId;
    if (book.phase !== "ready" || book.chainId !== chainId || book.account !== bridge.me)
      return undefined;
    return book.rows.find((row) => row.kind === "native");
  });

  // bits-ui reports the next open value here. Do not reload from an $effect.
  function onOpenChange(next: boolean): void {
    open = next;
    if (!next) return;
    ethAmount = "";
    error = "";
    void bridge.reloadPortfolio();
  }

  function fillMax(): void {
    const raw = ethRow?.raw;
    if (raw === undefined) return;
    ethAmount = lib().formatEther(fillable(raw, WRAP_MAX_RESERVE));
    error = "";
  }

  function parseAmount(): bigint | undefined {
    const text = ethAmount.trim();
    if (!text) return undefined;
    try {
      const amount = lib().parseUnits(text, 18);
      return amount > 0n ? amount : undefined;
    } catch {
      return undefined;
    }
  }

  async function confirm(): Promise<void> {
    error = "";
    const amount = parseAmount();
    if (amount === undefined) {
      error = AMOUNT_ERROR;
      return;
    }
    const message = await bridge.wrap(amount);
    if (message === undefined) {
      open = false;
      return;
    }
    error = message;
  }
</script>

<Dialog.Root {onOpenChange} bind:open>
  <Dialog.Trigger id="wrap" disabled={bridge.busy || !bridge.wrapOn}>
    {#snippet child({ props })}
      <Button {...props} variant="secondary">Wrap ETH</Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Wrap ETH</Dialog.Title>
      <Dialog.Description>
        Choose how much ETH to turn into WETH. This does not change the amount you send.
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-col gap-3">
      <Label for="wrapAmt">ETH</Label>
      <Input
        id="wrapAmt"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        disabled={bridge.busy}
        bind:value={ethAmount}
      />
      <p class="text-muted-foreground text-sm">
        {ethRow ? `${ethRow.amount} ETH` : "—"}
        <Button
          variant="link"
          class="h-auto px-1"
          disabled={bridge.busy || ethRow === undefined}
          onclick={fillMax}>Max</Button
        >
      </p>
      <Button disabled={bridge.busy} onclick={confirm}>Wrap</Button>
      <ErrorAlert text={error} />
    </div>
  </Dialog.Content>
</Dialog.Root>
