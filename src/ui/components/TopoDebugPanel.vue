<script setup lang="ts">
// The debug panel of topological names (spec 11, "Komponenty"; R111): a small floating panel
// bottom left with the kind, index, body and name of the face or edge under the cursor, as the
// TopoInspector of the session reports it. Drawn only while the inspector is enabled (the switch
// in the TitleBar, development builds only). Only bindings: the logic lives in interaction.
import { useI18n } from 'vue-i18n';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';

const session = useSession();
const { t } = useI18n();

const enabled = useObservable(session.topoInspector.enabled);
const hovered = useObservable(session.topoInspector.hovered);
</script>

<template>
  <div v-if="enabled" class="topo-debug-panel" role="status">
    <div class="heading">{{ t('debug.topoNames') }}</div>
    <template v-if="hovered !== null">
      <div class="entity">
        {{ t(hovered.kind === 'face' ? 'debug.face' : 'debug.edge', { index: hovered.index }) }}
        · <code>{{ hovered.body }}</code>
      </div>
      <code v-if="hovered.name !== null" class="name">{{ hovered.name }}</code>
      <span v-else class="unnamed">{{ t('debug.unnamed') }}</span>
    </template>
  </div>
</template>

<style scoped>
.topo-debug-panel {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 20;
  max-width: 360px;
  padding: 8px 12px;
  border-radius: var(--radius-panel);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 0.5px solid var(--panel-border);
  box-shadow:
    var(--panel-shadow),
    inset 0 0.5px 0 var(--panel-highlight);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  pointer-events: none;
}
.heading {
  margin-bottom: 4px;
  font-weight: 600;
}
.entity {
  color: var(--text-secondary);
}
.name {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.unnamed {
  color: var(--text-secondary);
  font-style: italic;
}
</style>
