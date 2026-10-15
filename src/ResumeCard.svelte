<script lang="ts">
  import { bridge } from "./bridge.svelte.js";
</script>

<div class="card">
  <h2>Finish a pending transfer</h2>
  <p class="muted">
    If you closed this page before the mint on the destination network, pick the same route above,
    connect your wallet and paste the hash of the transfer transaction on the source network.
  </p>
  <input
    id="resumeHash"
    type="text"
    placeholder="0x… transaction hash on the source network"
    autocomplete="off"
    spellcheck="false"
    disabled={bridge.busy}
    bind:value={bridge.resumeHash}
  />
  <div class="row">
    <button id="resume" disabled={bridge.busy || !bridge.resumeOn} onclick={() => bridge.resume()}
      >Finish mint</button
    >
  </div>
</div>
