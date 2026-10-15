<script lang="ts">
  import "./app.css";
  import { bridge } from "./bridge.svelte.js";
  import ResumeCard from "./ResumeCard.svelte";
  import RouteCard from "./RouteCard.svelte";
  import TransferCard from "./TransferCard.svelte";
</script>

<h1>Circle CCTP Bridge</h1>
<p class="sub">
  Move USDC, EURC, cirBTC and WETH between Arc, Ethereum and Avalanche through Circle's own
  contracts. Circle charges no protocol fee for standard transfers. You pay only gas.
</p>

<RouteCard />
<TransferCard />
<ResumeCard />

<div class="card" class:log-empty={bridge.logText.length === 0}>
  <div id="log">{bridge.logText}</div>
</div>

<p class="muted">
  ⚠️ Unaudited personal tool, provided as is. Use it entirely at your own risk. The authors accept
  no liability for any loss of funds, bugs, misuse or abuse. You are responsible for every
  transaction you sign. Test with a small amount first. Docs: README.md.
</p>
