<script lang="ts">
  import { bridge } from "./bridge.svelte.js";
</script>

<div class="mb-4 rounded-xl border border-line bg-card p-[18px]">
  <h2 class="m-0 mb-2 text-[17px] font-bold">Finish a pending transfer</h2>
  <p class="text-sm text-muted">
    If you closed this page before the mint on the destination network, pick the same route above,
    connect your wallet and paste the hash of the transfer transaction on the source network.
  </p>
  <input
    id="resumeHash"
    class="box-border w-full max-w-full rounded-md border border-line bg-bg p-2 font-mono text-[13px] text-fg"
    type="text"
    placeholder="0x… transaction hash on the source network"
    autocomplete="off"
    spellcheck="false"
    disabled={bridge.busy}
    bind:value={bridge.resumeHash}
  />
  <div class="my-2.5">
    <button
      id="resume"
      class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-4 py-2.5 text-[15px] text-white disabled:cursor-default disabled:opacity-45"
      disabled={bridge.busy || !bridge.resumeOn}
      onclick={() => bridge.resume()}>Finish mint</button
    >
  </div>
</div>
