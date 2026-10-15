<script lang="ts">
  import { bridge } from "./bridge.svelte.js";

  let abAddr = $state("");
  let abLabel = $state("");

  function add(): void {
    if (bridge.addEntry(abLabel, abAddr)) {
      abAddr = "";
      abLabel = "";
    }
  }
</script>

<div class="mb-4 rounded-xl border border-line bg-card p-[18px]">
  <div class="my-2.5">
    Route:
    <select
      id="route"
      class="box-border max-w-full rounded-md border border-line bg-bg p-2 text-[15px] text-fg"
      disabled={bridge.busy}
      value={bridge.routeKey}
      onchange={(e) => bridge.setRoute(e.currentTarget.value)}
    >
      {#each bridge.routeOptions as option (option.key)}
        <option value={option.key}>{option.label}</option>
      {/each}
    </select>
  </div>
  <div class="my-2.5 text-sm text-muted" id="routeInfo">
    {#each bridge.lines as line, i (i)}
      <div>
        {#each line as part, j (j)}
          {#if typeof part === "string"}
            {part}
          {:else}
            <code class="text-xs break-all">{part.code}</code>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
  <div class="my-2.5">
    Recipient on the destination network:<br />
    <select
      id="rcpt"
      class="box-border w-full max-w-full rounded-md border border-line bg-bg p-2 font-mono text-[13px] text-fg"
      disabled={bridge.busy}
      bind:value={bridge.recipientKey}
    >
      <option value="self">
        {bridge.me ? `This wallet — ${bridge.me}` : "This wallet (connect first)"}
      </option>
      {#each bridge.book as entry (entry.address)}
        <option value={entry.address}>Saved: {entry.label} — {entry.address}</option>
      {/each}
    </select>
    <div class="my-2.5 text-sm text-muted" id="rcptInfo">{bridge.rcptInfo}</div>
  </div>
  <details class="my-2.5">
    <summary>My other addresses (address book)</summary>
    <p class="text-warn">
      Add only addresses you control. Copy them from your hardware wallet or your wallet's address
      book, never from a transaction history: scammers plant look-alike addresses there (address
      poisoning). Smart contract wallets (for example a Safe) can have a different address, or no
      deployment at all, on another network.
    </p>
    <input
      id="abAddr"
      class="box-border w-full max-w-full rounded-md border border-line bg-bg p-2 font-mono text-[13px] text-fg"
      type="text"
      placeholder="0x…"
      autocomplete="off"
      spellcheck="false"
      bind:value={abAddr}
      disabled={bridge.busy}
    />
    <div class="my-2.5">
      <input
        id="abLabel"
        class="box-border max-w-full rounded-md border border-line bg-bg p-2 text-[15px] text-fg"
        type="text"
        placeholder="Label, e.g. Ledger 2"
        maxlength="24"
        autocomplete="off"
        bind:value={abLabel}
        disabled={bridge.busy}
      />
      <button
        id="abAdd"
        class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-2.5 py-1 text-[13px] text-white disabled:cursor-default disabled:opacity-45"
        disabled={bridge.busy}
        onclick={add}>Add</button
      >
    </div>
    <div id="abList">
      {#each bridge.book as entry, i (entry.address)}
        <div class="my-1 flex items-center gap-2 text-[13px]">
          <code class="flex-1 text-xs break-all">{entry.label} — {entry.address}</code>
          <button
            class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-2.5 py-1 text-[13px] text-white disabled:cursor-default disabled:opacity-45"
            disabled={bridge.busy}
            onclick={() => bridge.removeEntry(i)}>Remove</button
          >
        </div>
      {/each}
    </div>
    <p class="text-sm text-muted">
      The address book is stored only in this browser (localStorage).
    </p>
  </details>
  <div class="my-2.5">
    <label>
      <input id="fast" type="checkbox" disabled={bridge.fastLocked} bind:checked={bridge.fast} />
      <span id="fastLabel">{bridge.fastText}</span>
    </label>
  </div>
  <div class="my-2.5">
    <label>
      <input
        id="selfMint"
        type="checkbox"
        disabled={bridge.selfMintDisabled}
        bind:checked={bridge.selfMint}
      />
      I sign the mint on the destination network myself (no forwarding fee, needs a little gas there)
    </label>
  </div>
</div>
