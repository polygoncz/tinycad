<script setup lang="ts">
// The host of the 3D view (spec 11, "Komponenty"): one element filling the whole area under the
// toolbar; the session mounts its viewport (canvas) into it. The floating panels are siblings of
// this element, so nothing of the UI ends up inside the viewport's DOM. The HUD of the manipulator
// (M19, spec 11 rule 8) is a sibling too: it lies over the host in the same frame, so its px
// match the view area of project.
import { onMounted, useTemplateRef } from 'vue';
import { useSession } from '../composables/use-session';
import ManipulatorHud from './ManipulatorHud.vue';

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
  <div class="viewport-frame">
    <div ref="host" class="viewport-host" />
    <ManipulatorHud />
  </div>
</template>

<style scoped>
.viewport-frame {
  position: absolute;
  inset: 0;
}
.viewport-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
</style>
