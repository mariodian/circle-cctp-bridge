<script lang="ts">
  import "./app.css";
  import { bridge } from "./bridge.svelte.js";
  import ResumeCard from "./ResumeCard.svelte";
  import RouteCard from "./RouteCard.svelte";
  import TransferCard from "./TransferCard.svelte";
</script>

<h1 class="mb-1 text-[22px] font-bold">Circle CCTP Bridge</h1>
<p class="mt-0 text-muted">
  Move USDC, EURC, cirBTC and WETH between Arc, Ethereum and Avalanche through Circle's own
  contracts. Circle charges no protocol fee for standard transfers. You pay only gas.
</p>

<RouteCard />
<TransferCard />
<ResumeCard />

<div
  class="mb-4 rounded-xl border border-line bg-card p-[18px]"
  class:hidden={bridge.logText.length === 0}
>
  <div id="log" class="font-mono text-[13px] break-words whitespace-pre-wrap">{bridge.logText}</div>
</div>

<p class="text-sm text-muted">
  ⚠️ Unaudited personal tool, provided as is. Use it entirely at your own risk. The authors accept
  no liability for any loss of funds, bugs, misuse or abuse. You are responsible for every
  transaction you sign. Test with a small amount first. Docs: README.md.
</p>
