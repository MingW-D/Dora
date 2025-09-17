<template>
  <div class="model-selector-wrapper" ref="rootRef">
    <!-- Display button -->
    <button class="model-select-btn" type="button" @click="toggle()">
      <span class="label">{{ selectedLabel }}</span>
      <span class="chevron" :class="{ open: isOpen, up: effectiveDirection === 'up' }">▴</span>
    </button>

    <!-- Options list -->
    <ul 
      v-show="isOpen" 
      class="model-options" 
      :class="{ 'drop-up': effectiveDirection === 'up', 'drop-down': effectiveDirection === 'down' }"
      ref="listRef"
    >
      <li 
        v-for="opt in options" 
        :key="opt[valueKey]"
        :class="{ active: opt[valueKey] === modelValue }"
        @click="select(opt[valueKey])"
      >
        {{ opt[labelKey] }}
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';

type Direction = 'up' | 'down' | 'auto';

interface OptionLike {
  [key: string]: any;
}

const props = defineProps<{
  modelValue: string;
  options: OptionLike[];
  labelKey?: string;
  valueKey?: string;
  direction?: Direction;
}>();

const emit = defineEmits<{
  'update:modelValue': [val: string];
}>();

const labelKey = computed(() => props.labelKey ?? 'name');
const valueKey = computed(() => props.valueKey ?? 'id');

const isOpen = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const effectiveDirection = ref<'up' | 'down'>('down');

const selectedLabel = computed(() => {
  const found = props.options?.find(o => o[valueKey.value] === props.modelValue);
  return found ? String(found[labelKey.value]) : '未选择';
});

function computeDirection() {
  if (props.direction && props.direction !== 'auto') {
    effectiveDirection.value = props.direction;
    return;
  }
  // Auto: decide by viewport space
  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) {
    effectiveDirection.value = 'down';
    return;
  }
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const estimatedMenuHeight = Math.min(240, (props.options?.length ?? 6) * 36 + 8); // heuristic
  effectiveDirection.value = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? 'up' : 'down';
}

function toggle() {
  if (!props.options || props.options.length === 0) return;
  if (!isOpen.value) computeDirection();
  isOpen.value = !isOpen.value;
}

function select(val: string) {
  emit('update:modelValue', val);
  isOpen.value = false;
}

function handleClickOutside(e: MouseEvent) {
  if (!rootRef.value) return;
  if (!rootRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});

// Recompute direction if window resizes while open
watch(isOpen, (open) => {
  if (open) {
    computeDirection();
  }
});
</script>

<style scoped>
.model-selector-wrapper {
  position: relative;
  display: inline-block;
}

.model-select-btn {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  min-width: 140px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: #ffffff; /* white background */
  color: #7c6cf1; /* light purple text */
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.model-select-btn:hover,
.model-select-btn:focus {
  background: var(--hover-bg);
  border-color: var(--primary-color);
}

.chevron {
  font-size: 10px;
  transition: transform 0.15s ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.model-options {
  position: absolute;
  left: 0;
  z-index: 1000;
  max-height: 240px;
  overflow: auto;
  margin: 6px 0 0 0;
  padding: 4px;
  list-style: none;
  background: #ffffff; /* white background */
  color: #7c6cf1; /* light purple text */
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.12);
  width: 100%;
  font-size: 12px; /* ensure compact menu font */
}

.model-options.drop-down { /* default below */
  top: 100%;
}

.model-options.drop-up {
  bottom: 100%;
  margin: 0 0 6px 0;
}

.model-options li {
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.model-options li:hover,
.model-options li.active {
  background: var(--hover-bg);
}
</style>