<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
  import { shortAddress } from "$lib/format.js";
</script>

<button
  id="connect"
  type="button"
  class={buttonVariants({
    variant: "outline",
    class: "fixed top-4 right-4 z-30 rounded-full font-mono"
  })}
  disabled={bridge.busy}
  onclick={() => bridge.connect()}
>
  {bridge.me ? shortAddress(bridge.me) : "Connect wallet"}
</button>
