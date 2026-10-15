<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { shortAddress } from "$lib/format.js";

  let open = $state(false);
  let abAddr = $state("");
  let abLabel = $state("");

  const choice = $derived(bridge.recipient);
  const recipientLabel = $derived(
    choice.kind === "self"
      ? bridge.me
        ? shortAddress(bridge.me)
        : "—"
      : choice.kind === "book"
        ? shortAddress(choice.entry.address)
        : "—"
  );
  const rcptInfo = $derived(
    choice.kind === "self"
      ? "Funds arrive at the same address on the destination network."
      : "⚠️ Funds go to a different address than the connected wallet. Check that you control it on the destination network."
  );

  function add(): void {
    if (bridge.addEntry(abLabel, abAddr)) {
      abAddr = "";
      abLabel = "";
    }
  }
</script>

<div class="flex flex-col gap-2">
  <Dialog.Root bind:open>
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
            bridge.selectRecipient("self");
            open = false;
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
              bridge.selectRecipient(entry.address);
              open = false;
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
          address book, never from a transaction history: scammers plant look-alike addresses there
          (address poisoning). Smart contract wallets (for example a Safe) can have a different
          address, or no deployment at all, on another network. The address book is stored only in
          this browser.
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
  <p class="text-muted-foreground text-sm" id="rcptInfo">{rcptInfo}</p>
</div>
