<script lang="ts">
  import "./app.css";
  import { buttonVariants } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { bridge, shortAddress } from "./bridge.svelte.js";
  import ResumeCard from "./ResumeCard.svelte";
  import SendCard from "./SendCard.svelte";
</script>

<Tooltip.Provider>
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
  <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 pt-16 pb-6">
    <SendCard />
    <ResumeCard />

    {#if bridge.logText.length > 0}
      <Card.Root>
        <Card.Content>
          <div id="log" class="font-mono text-[13px] break-words whitespace-pre-wrap">
            {bridge.logText}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    <p class="text-muted-foreground text-sm">
      Unaudited personal tool, provided as is. Use it entirely at your own risk. The authors accept
      no liability for any loss of funds, bugs, misuse or abuse. You are responsible for every
      transaction you sign. Test with a small amount first.
    </p>
  </div>
</Tooltip.Provider>
