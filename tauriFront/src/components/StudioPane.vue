<template>
  <div v-if="dock || visible" :class="['studio-pane', { dock }]">
    <div class="studio-pane__header">
      <!-- <span class="studio-pane__title">{{ titleText }}</span> -->
      <button v-if="!dock" class="studio-pane__close" @click="close">×</button>
    </div>

    <div class="studio-pane__content">
      <template v-if="mode === 'html'">
        <iframe :src="htmlUrl" class="studio-pane__iframe"></iframe>
      </template>

      <template v-else-if="mode === 'editor'">
        <pre class="studio-pane__pre">{{ stringPayload }}</pre>
      </template>

      <template v-else-if="mode === 'list'">
        <ul class="studio-pane__list">
          <li v-for="(item, idx) in listPayload" :key="idx">
            <pre>{{ format(item) }}</pre>
          </li>
        </ul>
      </template>

      <template v-else-if="mode === 'folder'">
        <pre class="studio-pane__pre">{{ format(payload) }}</pre>
      </template>
    </div>
  </div>
></template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { studioBus, type StudioAction } from '../services/studioBus';

type Mode = 'html' | 'editor' | 'list' | 'folder';

const props = defineProps<{ dock?: boolean; title?: string }>();
const dock = computed(() => props.dock === true);

const visible = ref(false);
const mode = ref<Mode>('editor');
const payload = ref<any>('');

const htmlUrl = ref<string>('about:blank');
const listPayload = ref<any[]>([]);
const stringPayload = ref<string>('');

// const titleText = computed(() => props.title ?? (dock.value ? 'Dora 工作室' : `Studio Preview - ${mode.value}`));

function format(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return String(v); }
}

function close() {
  visible.value = false;
}

studioBus.subscribe({
  next(action: StudioAction) {
    // 先处理独立的可见性事件：不改变内容，仅控制显示（非 dock 模式）
    if (action.type === 'visibility' || action.type === 'browserVisible') {
      if (!dock.value) {
        visible.value = !!action.payload?.visible;
      }
      return;
    }

    // 非可见性事件：悬浮模式默认显示
    if (!dock.value) {
      visible.value = true;
    }

    // 仅 openUrl 才会切换为 html 并设置 iframe.src
    switch (action.type) {
      case 'openUrl': {
        mode.value = 'html';
        htmlUrl.value = action.payload?.url ?? 'about:blank';
        break;
      }
      case 'list':
      case 'searchResults': {
        mode.value = 'list';
        listPayload.value = Array.isArray(action.payload) ? action.payload : [action.payload];
        break;
      }
      case 'folder':
      case 'openFolder': {
        mode.value = 'folder';
        payload.value = action.payload;
        break;
      }
      case 'openFile':
      case 'editor':
      default: {
        mode.value = 'editor';
        stringPayload.value = typeof action.payload === 'string' ? action.payload : format(action.payload);
        break;
      }
    }
  },
});
</script>

<style scoped>
.studio-pane {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: min(960px, 90vw);
  height: min(600px, 70vh);
  background: #111827;
  color: #e5e7eb;
  border: 1px solid #374151;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  z-index: 9999;
}
.studio-pane.dock {
  position: static;
  right: auto;
  bottom: auto;
  width: 100%;
  height: 100%;
  box-shadow: none;
  border: none;
}
.studio-pane__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #374151;
}
.studio-pane__title { font-weight: 600; }
.studio-pane__close { background: transparent; color: #9ca3af; border: none; font-size: 18px; cursor: pointer; }
.studio-pane__content { flex: 1; overflow: auto; }
.studio-pane__iframe { width: 100%; height: 100%; border: none; background: #fff; }
.studio-pane__pre { padding: 12px; white-space: pre-wrap; word-break: break-word; }
.studio-pane__list { list-style: none; margin: 0; padding: 12px; }
.studio-pane__list pre { background: #0b1220; padding: 8px; border-radius: 6px; }
</style>

