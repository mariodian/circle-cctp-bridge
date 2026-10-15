<script lang="ts">
  import { bridge } from "./bridge.svelte.js";
</script>

<div class="card">
  <button id="connect" disabled={bridge.busy} onclick={() => bridge.connect()}
    >1. Connect wallet</button
  >
  <div class="row" id="acct">{bridge.acct}</div>
  <div class="row">
    Amount:
    <input
      id="amt"
      type="text"
      size="18"
      autocomplete="off"
      disabled={bridge.busy}
      bind:value={bridge.amount}
    />
    <span id="sym">{bridge.symbol}</span>
    <button id="max" class="small" disabled={bridge.busy} onclick={() => bridge.max()}>MAX</button>
  </div>
  {#if bridge.canWrap}
    <button id="wrap" disabled={bridge.busy || !bridge.wrapOn} onclick={() => bridge.wrap()}
      >Wrap ETH → WETH (entered amount)</button
    >
  {/if}
  <button id="quote" disabled={bridge.busy || !bridge.quoteOn} onclick={() => bridge.quote()}
    >2. Get fee</button
  >
  <button id="approve" disabled={bridge.busy || !bridge.approveOn} onclick={() => bridge.approve()}
    >3. Approve</button
  >
  <button id="send" disabled={bridge.busy || !bridge.sendOn} onclick={() => bridge.send()}
    >4. Send</button
  >
</div>
