<script lang="ts">
  import "./app.css";
  import ConnectButton from "$lib/components/ConnectButton.svelte";
  import LogCard from "$lib/components/LogCard.svelte";
  import ResumeCard from "$lib/components/ResumeCard.svelte";
  import SendCard from "$lib/components/send/SendCard.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
</script>

<Tooltip.Provider>
  <ConnectButton />
  <div class="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 pt-16 pb-6">
    <SendCard />
    <ResumeCard />
    <LogCard />

    <p class="text-muted-foreground text-sm">
      Unaudited personal tool, provided as is. Use it entirely at your own risk. The authors accept
      no liability for any loss of funds, bugs, misuse or abuse. You are responsible for every
      transaction you sign. Test with a small amount first.
    </p>
  </div>
</Tooltip.Provider>
