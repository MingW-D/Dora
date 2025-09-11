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

      <template v-else-if="mode === 'image'">
        <div class="studio-pane__image-wrapper">
          <img :src="imageUrl" class="studio-pane__image" alt="preview" />
        </div>
      </template>

      <template v-else-if="mode === 'htmlReport'">
        <div class="html-report-container">
          <div class="html-report-header">
            <h3 class="report-title">{{ reportTitle }}</h3>
            <button class="download-btn" @click="downloadHtmlReport">
              <span class="download-icon">💾</span>
              下载报告
            </button>
          </div>
          <div class="html-report-preview">
            <iframe :srcdoc="htmlContent" class="studio-pane__iframe"></iframe>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { studioBus, type StudioAction } from '../services/studioBus';

type Mode = 'html' | 'editor' | 'list' | 'folder' | 'image' | 'htmlReport';

const props = defineProps<{ dock?: boolean; title?: string }>();
const dock = computed(() => props.dock === true);

const visible = ref(false);
const mode = ref<Mode>('editor');
const payload = ref<any>('');

const htmlUrl = ref<string>('about:blank');
const listPayload = ref<any[]>([]);
const stringPayload = ref<string>('');
const imageUrl = ref<string>(''); // 新增
const htmlContent = ref<string>(''); // HTML报告内容
const reportTitle = ref<string>(''); // 报告标题
const reportFileName = ref<string>(''); // 报告文件名

// const titleText = computed(() => props.title ?? (dock.value ? 'Dora 工作室' : `Studio Preview - ${mode.value}`));

function format(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return String(v); }
}

function close() {
  visible.value = false;
}

// 下载HTML报告
function downloadHtmlReport() {
  try {
    const blob = new Blob([htmlContent.value], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFileName.value || `dora_report_${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('下载报告失败:', error);
  }
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
      case 'image': {
        mode.value = 'image';
        imageUrl.value = action.payload?.url ?? (typeof action.payload === 'string' ? action.payload : '');
        break;
      }
      case 'htmlReport': {
        console.log('StudioPane - htmlReport action received:', action);
        console.log('StudioPane - payload:', action.payload);
        console.log('StudioPane - htmlContent length:', action.payload?.htmlContent?.length);
        mode.value = 'htmlReport';
        htmlContent.value = action.payload?.htmlContent ?? '';
        reportTitle.value = action.payload?.title ?? 'HTML报告';
        reportFileName.value = action.payload?.fileName ?? 'report.html';
        console.log('StudioPane - mode set to:', mode.value);
        console.log('StudioPane - htmlContent set to length:', htmlContent.value.length);
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
  background: #0b0b0f; /* 黑色主题 */
  color: #e5e7eb;
  border: 1px solid #1f2937;
  border-radius: 12px; /* 四角圆角 */
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  z-index: 100;
  overflow: hidden; /* 让内部 iframe 也遵循圆角 */
}
.studio-pane.dock {
  position: static;
  right: auto;
  bottom: auto;
  width: 100%;
  height: 100%;
  /* 保留圆角与边框，dock 模式不去掉阴影与边框 */
}
.studio-pane__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #1f2937;
}
.studio-pane__title { font-weight: 600; }
.studio-pane__close { background: transparent; color: #9ca3af; border: none; font-size: 18px; cursor: pointer; }
.studio-pane__content { flex: 1; overflow: auto; }
.studio-pane__iframe { width: 100%; height: 100%; border: none; background: #0b0b0f; }
.studio-pane__pre { padding: 12px; white-space: pre-wrap; word-break: break-word; background: #0b0b0f; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 8px; }
.studio-pane__list { list-style: none; margin: 0; padding: 12px; }
.studio-pane__list pre { background: #111827; color: #e5e7eb; padding: 8px; border-radius: 6px; border: 1px solid #374151; }
.studio-pane__image-wrapper { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #0b0b0f; }
.studio-pane__image { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; }

.html-report-container { width: 100%; height: 100%; display: flex; flex-direction: column; background: #0b0b0f; }
.html-report-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  padding: 12px 16px; 
  border-bottom: 1px solid #1f2937; 
  background: #111827;
}
.report-title { 
  color: #e5e7eb; 
  font-size: 1rem; 
  font-weight: 600; 
  margin: 0; 
}
.download-btn { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  background: #3b82f6; 
  color: white; 
  border: none; 
  border-radius: 6px; 
  padding: 8px 16px; 
  font-size: 0.9rem; 
  cursor: pointer; 
  transition: background-color 0.2s;
}
.download-btn:hover { background: #2563eb; }
.download-icon { font-size: 1rem; }
.html-report-preview { flex: 1; overflow: hidden; }
</style>

