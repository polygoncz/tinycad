<script setup lang="ts">
// The host of the 3D view (spec 11, "Komponenty"): one element filling the whole area under the
// toolbar; the session mounts its viewport (canvas) into it. The floating panels are siblings of
// this element, so nothing of the UI ends up inside the viewport's DOM.
import { onMounted, useTemplateRef } from 'vue';
import { useSession } from '../composables/use-session';

const session = useSession();
const host = useTemplateRef<HTMLElement>('host');

onMounted(() => {
  if (host.value !== null) session.mountViewport(host.value);
});

/** Whether a DOM node (the target of a key event) is inside the view. */
function contains(node: Node): boolean {
  return host.value?.contains(node) === true;
}

defineExpose({ contains });
</script>

<template>
  <div ref="host" class="viewport-host" />
</template>

<style scoped>
.viewport-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
</style>
