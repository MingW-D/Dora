<template>
  <div class="task-mode-selector">
    <ModelSelector
      v-model:modelValue="innerValue"
      :options="modeOptions"
      labelKey="label"
      valueKey="value"
      direction="up"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ModelSelector from './ModelSelector.vue';

export type TaskMode = 'agent' | 'ask' | 'auto';

interface Props {
  mode: TaskMode;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:mode': [mode: TaskMode];
}>();

const modeOptions = [
  { value: 'agent', label: 'Agent' },
  { value: 'ask', label: 'Ask' },
  { value: 'auto', label: 'Auto' },
] as const;

const innerValue = computed<TaskMode>({
  get: () => props.mode,
  set: (val) => emit('update:mode', val),
});
</script>

<style scoped>
.task-mode-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Style the embedded ModelSelector button via deep selector */
:deep(.model-select-btn) {
  background: #ffffff !important; /* white */
  color: #7c6cf1 !important;      /* light purple */
  border: none !important;
  box-shadow: none !important;
}

:deep(.model-options) {
  background: #ffffff !important;
  color: #7c6cf1 !important;
  font-size: 12px !important; /* compact menu font */
  border: none !important;
  box-shadow: none !important;
}
</style>