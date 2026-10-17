<script setup lang="ts">
// The hint HUD of the tools (spec 11, rule 8a; spec 10, "Nástroje"): one line at the top centre of
// the view saying what the active tool waits for. What it shows is session.tools.hint, a key of the
// dictionary with its params; without a hint nothing is drawn. It ignores the pointer, so the view
// under it still orbits and picks.
import { useI18n } from 'vue-i18n';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';

const session = useSession();
const { t } = useI18n();
const hint = useObservable(session.tools.hint);
</script>

<template>
  <div v-if="hint !== null" class="tool-hint-hud" role="status">
    {{ t(hint.key, { ...hint.params }) }}
  </div>
</template>

<style scoped>
.tool-hint-hud {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - 24px);
  padding: 4px 12px;
  border-radius: var(--radius-button);
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border: 0.5px solid var(--chrome-border);
  box-shadow: var(--panel-shadow);
  font-family: var(--font-ui);
  font-size: var(--font-size);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}
</style>
