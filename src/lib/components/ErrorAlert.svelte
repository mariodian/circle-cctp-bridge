<script lang="ts">
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import * as Alert from "$lib/components/ui/alert/index.js";

  let { text, class: className }: { text: string; class?: string } = $props();
</script>

{#if text}
  <Alert.Root variant="destructive" class={className}>
    <CircleAlertIcon />
    <Alert.Description>{text}</Alert.Description>
  </Alert.Root>
{/if}
