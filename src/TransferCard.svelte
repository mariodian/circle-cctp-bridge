<script lang="ts">
  import { bridge } from "./bridge.svelte.js";
</script>

<div class="mb-4 rounded-xl border border-line bg-card p-[18px]">
  <button
    id="connect"
    class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-4 py-2.5 text-[15px] text-white disabled:cursor-default disabled:opacity-45"
    disabled={bridge.busy}
    onclick={() => bridge.connect()}>1. Connect wallet</button
  >
  <div class="my-2.5" id="acct">{bridge.acct}</div>
  <div class="my-2.5">
    Amount:
    <input
      id="amt"
      class="box-border max-w-full rounded-md border border-line bg-bg p-2 text-[15px] text-fg"
      type="text"
      size="18"
      autocomplete="off"
      disabled={bridge.busy}
      bind:value={bridge.amount}
    />
    <span id="sym">{bridge.symbol}</span>
    <button
      id="max"
      class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-2.5 py-1 text-[13px] text-white disabled:cursor-default disabled:opacity-45"
      disabled={bridge.busy}
      onclick={() => bridge.max()}>MAX</button
    >
  </div>
  {#if bridge.canWrap}
    <button
      id="wrap"
      class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-4 py-2.5 text-[15px] text-white disabled:cursor-default disabled:opacity-45"
      disabled={bridge.busy || !bridge.wrapOn}
      onclick={() => bridge.wrap()}>Wrap ETH → WETH (entered amount)</button
    >
  {/if}
  <button
    id="quote"
    class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-4 py-2.5 text-[15px] text-white disabled:cursor-default disabled:opacity-45"
    disabled={bridge.busy || !bridge.quoteOn}
    onclick={() => bridge.quote()}>2. Get fee</button
  >
  <button
    id="approve"
    class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-4 py-2.5 text-[15px] text-white disabled:cursor-default disabled:opacity-45"
    disabled={bridge.busy || !bridge.approveOn}
    onclick={() => bridge.approve()}>3. Approve</button
  >
  <button
    id="send"
    class="my-1 mr-1 ml-0 cursor-pointer rounded-lg border-0 bg-accent px-4 py-2.5 text-[15px] text-white disabled:cursor-default disabled:opacity-45"
    disabled={bridge.busy || !bridge.sendOn}
    onclick={() => bridge.send()}>4. Send</button
  >
</div>
