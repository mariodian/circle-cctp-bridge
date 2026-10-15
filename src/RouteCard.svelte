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

<div class="card">
  <div class="row">
    Route:
    <select
      id="route"
      disabled={bridge.busy}
      value={bridge.routeKey}
      onchange={(e) => bridge.setRoute(e.currentTarget.value)}
    >
      {#each bridge.routeOptions as option (option.key)}
        <option value={option.key}>{option.label}</option>
      {/each}
    </select>
  </div>
  <div class="row muted" id="routeInfo">
    {#each bridge.lines as line, i (i)}
      <div>
        {#each line as part, j (j)}
          {#if typeof part === "string"}
            {part}
          {:else}
            <code>{part.code}</code>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
  <div class="row">
    Recipient on the destination network:<br />
    <select id="rcpt" disabled={bridge.busy} bind:value={bridge.recipientKey}>
      <option value="self">
        {bridge.me ? `This wallet — ${bridge.me}` : "This wallet (connect first)"}
      </option>
      {#each bridge.book as entry (entry.address)}
        <option value={entry.address}>Saved: {entry.label} — {entry.address}</option>
      {/each}
    </select>
    <div class="row muted" id="rcptInfo">{bridge.rcptInfo}</div>
  </div>
  <details class="row">
    <summary>My other addresses (address book)</summary>
    <p class="warn">
      Add only addresses you control. Copy them from your hardware wallet or your wallet's address
      book, never from a transaction history: scammers plant look-alike addresses there (address
      poisoning). Smart contract wallets (for example a Safe) can have a different address, or no
      deployment at all, on another network.
    </p>
    <input
      id="abAddr"
      type="text"
      placeholder="0x…"
      autocomplete="off"
      spellcheck="false"
      bind:value={abAddr}
      disabled={bridge.busy}
    />
    <div class="row">
      <input
        id="abLabel"
        type="text"
        placeholder="Label, e.g. Ledger 2"
        maxlength="24"
        autocomplete="off"
        bind:value={abLabel}
        disabled={bridge.busy}
      />
      <button id="abAdd" class="small" disabled={bridge.busy} onclick={add}>Add</button>
    </div>
    <div id="abList">
      {#each bridge.book as entry, i (entry.address)}
        <div class="ab-item">
          <code>{entry.label} — {entry.address}</code>
          <button class="small" disabled={bridge.busy} onclick={() => bridge.removeEntry(i)}
            >Remove</button
          >
        </div>
      {/each}
    </div>
    <p class="muted">The address book is stored only in this browser (localStorage).</p>
  </details>
  <div class="row">
    <label>
      <input id="fast" type="checkbox" disabled={bridge.fastLocked} bind:checked={bridge.fast} />
      <span id="fastLabel">{bridge.fastText}</span>
    </label>
  </div>
  <div class="row">
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
