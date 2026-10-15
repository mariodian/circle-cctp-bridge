<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
</script>

{#if bridge.logText.length > 0}
  <Card.Root>
    <Card.Content>
      <div id="log" class="font-mono text-[13px] break-words whitespace-pre-wrap">
        {bridge.logText}
      </div>
    </Card.Content>
  </Card.Root>
{/if}
