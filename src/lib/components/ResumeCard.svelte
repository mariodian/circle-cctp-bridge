<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Card from "$lib/components/ui/card/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { bridge } from "$lib/bridge/bridge.svelte.js";
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Finish a pending transfer</Card.Title>
    <Card.Description>
      If you closed this page before the mint on the destination network, pick the same route above,
      connect your wallet and paste the hash of the transfer transaction on the source network.
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-3">
    <Input
      id="resumeHash"
      type="text"
      placeholder="0x… transaction hash on the source network"
      autocomplete="off"
      spellcheck="false"
      disabled={bridge.busy}
      bind:value={bridge.resumeHash}
      class="font-mono"
    />
    <Button
      id="resume"
      variant="secondary"
      disabled={bridge.busy || !bridge.resumeOn}
      onclick={() => bridge.resume()}>Finish mint</Button
    >
  </Card.Content>
</Card.Root>
