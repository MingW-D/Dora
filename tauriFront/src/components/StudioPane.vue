<template>
  <div v-if="dock || visible" :class="['studio-pane', { dock }]">
    <div class="studio-pane__header">
      <!-- <span class="studio-pane__title">{{ titleText }}</span> -->
      <button v-if="!dock" class="studio-pane__close" @click="close">×</button>
    </div>

    <!-- 标签栏 -->
    <div v-if="tabs.length > 1" class="studio-pane__tabs">
      <div 
        v-for="tab in tabs" 
        :key="tab.id"
        :class="['studio-pane__tab', { active: tab.id === activeTabId }]"
        @click="switchTab(tab.id)"
      >
        <span class="tab-title">{{ tab.title }}</span>
        <span v-if="tab.history.length > 1" class="tab-count">({{ tab.history.length }})</span>
        <button 
          v-if="tabs.length > 1" 
          class="tab-close" 
          @click.stop="closeTab(tab.id)"
        >
          ×
        </button>
      </div>
    </div>

    <!-- 历史记录导航栏 -->
    <div v-if="activeTab && activeTab.history.length > 1" class="history-navigation">
      <button 
        class="nav-btn prev-btn" 
        :disabled="activeTab.currentIndex <= 0"
        @click="navigateHistory(-1)"
        title="上一个"
      >
        ◀
      </button>
      <div class="history-info">
        <span class="current-item">{{ activeTab.history[activeTab.currentIndex]?.title }}</span>
        <span class="history-counter">{{ activeTab.currentIndex + 1 }} / {{ activeTab.history.length }}</span>
      </div>
      <button 
        class="nav-btn next-btn" 
        :disabled="activeTab.currentIndex >= activeTab.history.length - 1"
        @click="navigateHistory(1)"
        title="下一个"
      >
        ▶
      </button>
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

      <template v-else-if="mode === 'videoSearch'">
        <div class="video-search-container">
          <div class="video-search-header">
            <h3 class="search-title">🎬 视频搜索结果</h3>
            <div class="search-info">
              <span class="keyword">关键词: {{ videoSearchData.keyword }}</span>
              <span class="count">共找到 {{ videoSearchData.totalCount }} 个视频</span>
            </div>
          </div>
          
          <div v-if="videoSearchData.albumInfo && videoSearchData.albumInfo.title" class="album-info">
            <h4 class="album-title">{{ videoSearchData.albumInfo.title }}</h4>
            <p v-if="videoSearchData.albumInfo.description" class="album-desc">{{ videoSearchData.albumInfo.description }}</p>
          </div>

          <div class="video-list">
            <div 
              v-for="(video, index) in videoSearchData.videos" 
              :key="index"
              class="video-item"
              @click="openVideo(video)"
            >
              <div class="video-cover">
                <img 
                  :src="video.cover" 
                  :alt="video.title"
                  class="cover-image"
                  @error="handleImageError"
                />
                <div class="video-duration">{{ video.duration }}</div>
              </div>
              <div class="video-info">
                <h4 class="video-title">{{ video.title }}</h4>
                <p v-if="video.number" class="video-number">{{ video.number }}</p>
                <p v-if="video.year" class="video-year">{{ video.year }}</p>
                <div class="video-actions">
                  <button class="play-btn" @click.stop="playVideo(video)">
                    ▶️ 播放
                  </button>
                  <button class="info-btn" @click.stop="showVideoInfo(video)">
                    ℹ️ 详情
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="videoSearchData.videos.length === 0" class="no-results">
            <p>😔 没有找到相关视频</p>
            <p>请尝试其他关键词</p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { studioBus, type StudioAction } from '../services/studioBus';

type Mode = 'html' | 'editor' | 'list' | 'folder' | 'image' | 'htmlReport' | 'videoSearch';

interface TabHistoryItem {
  action: StudioAction;
  timestamp: number;
  title: string;
}

interface Tab {
  id: string;
  title: string;
  mode: Mode;
  payload: any;
  htmlUrl?: string;
  listPayload?: any[];
  stringPayload?: string;
  imageUrl?: string;
  htmlContent?: string;
  reportTitle?: string;
  reportFileName?: string;
  videoSearchData?: {
    keyword: string;
    videos: any[];
    albumInfo: any;
    totalCount: number;
    page: number;
    pageSize: number;
  };
  timestamp: number;
  history: TabHistoryItem[]; // 同一类别下的历史记录
  currentIndex: number; // 当前显示的历史记录索引
}

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

// 视频搜索数据
const videoSearchData = ref<{
  keyword: string;
  videos: any[];
  albumInfo: any;
  totalCount: number;
  page: number;
  pageSize: number;
}>({
  keyword: '',
  videos: [],
  albumInfo: {},
  totalCount: 0,
  page: 1,
  pageSize: 25
});

// 标签管理
const tabs = ref<Tab[]>([]);
const activeTabId = ref<string>('');
const MAX_TABS = 10; // 最大标签数量

// 计算当前活动标签
const activeTab = computed(() => {
  return tabs.value.find(tab => tab.id === activeTabId.value);
});

// const titleText = computed(() => props.title ?? (dock.value ? 'Dora 工作室' : `Studio Preview - ${mode.value}`));

function format(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return String(v); }
}

function close() {
  visible.value = false;
}

// 标签管理函数
function generateTabId(action: StudioAction): string {
  const type = action.type;
  // 按类别生成标签ID，同一类别共用一个标签
  let categoryId = '';
  
  switch (type) {
    case 'videoSearch':
      categoryId = 'videoSearch';
      break;
    case 'openUrl':
      categoryId = 'webBrowser';
      break;
    case 'htmlReport':
      categoryId = 'htmlReport';
      break;
    case 'image':
      categoryId = 'imageViewer';
      break;
    case 'folder':
    case 'openFolder':
      categoryId = 'fileManager';
      break;
    case 'list':
    case 'searchResults':
      categoryId = 'dataList';
      break;
    case 'openFile':
    case 'editor':
    default:
      categoryId = 'textEditor';
  }
  
  return categoryId;
}

function generateTabTitle(action: StudioAction): string {
  // 按类别生成通用标题
  switch (action.type) {
    case 'videoSearch':
      return '🎬 视频搜索';
    case 'openUrl':
      return '🌐 网页浏览器';
    case 'htmlReport':
      return '📊 HTML报告';
    case 'image':
      return '🖼️ 图片查看器';
    case 'folder':
    case 'openFolder':
      return '📁 文件管理器';
    case 'list':
    case 'searchResults':
      return '📋 数据列表';
    case 'openFile':
    case 'editor':
    default:
      return '📝 文本编辑器';
  }
}

function createOrUpdateTab(action: StudioAction): string {
  const tabId = generateTabId(action);
  const title = generateTabTitle(action);
  
  console.log(`[StudioPane] 处理标签: ${action.type}, ID: ${tabId}, 标题: ${title}`);
  
  // 检查是否已存在相同类别的标签
  const existingTabIndex = tabs.value.findIndex(tab => tab.id === tabId);
  
  if (existingTabIndex !== -1) {
    // 更新现有标签，添加新的历史记录
    console.log(`[StudioPane] 更新现有类别标签: ${existingTabIndex}`);
    const existingTab = tabs.value[existingTabIndex];
    
    // 创建历史记录项
    const historyItem: TabHistoryItem = {
      action: { ...action },
      timestamp: Date.now(),
      title: generateDetailedTitle(action)
    };
    
    // 添加到历史记录
    existingTab.history.push(historyItem);
    existingTab.currentIndex = existingTab.history.length - 1; // 切换到最新的记录
    existingTab.timestamp = Date.now();
    
    // 更新当前显示的数据
    updateTabData(existingTab, action);
    activeTabId.value = existingTab.id;
    return existingTab.id;
  } else {
    // 创建新标签
    const newTab: Tab = {
      id: tabId,
      title,
      mode: getModeFromAction(action),
      payload: action.payload,
      timestamp: Date.now(),
      history: [],
      currentIndex: 0
    };
    
    // 添加第一个历史记录
    const historyItem: TabHistoryItem = {
      action: { ...action },
      timestamp: Date.now(),
      title: generateDetailedTitle(action)
    };
    newTab.history.push(historyItem);
    
    updateTabData(newTab, action);
    
    // 如果标签数量超过限制，移除最旧的标签
    if (tabs.value.length >= MAX_TABS) {
      // 按时间戳排序，移除最旧的标签
      tabs.value.sort((a, b) => a.timestamp - b.timestamp);
      tabs.value.shift(); // 移除最旧的标签
    }
    
    tabs.value.push(newTab);
    activeTabId.value = tabId;
    console.log(`[StudioPane] 创建新类别标签: ${tabId}, 当前标签数量: ${tabs.value.length}`);
    return tabId;
  }
}

// 生成详细标题（用于历史记录）
function generateDetailedTitle(action: StudioAction): string {
  switch (action.type) {
    case 'videoSearch':
      return `视频搜索: ${action.payload?.keyword || '未知关键词'}`;
    case 'openUrl':
      return `网页: ${action.payload?.url || '未知'}`;
    case 'htmlReport':
      return action.payload?.title || 'HTML报告';
    case 'image':
      return `图片: ${action.payload?.url || '未知'}`;
    case 'folder':
    case 'openFolder':
      return `文件夹: ${action.payload?.name || '未知'}`;
    case 'list':
    case 'searchResults':
      return `列表 (${Array.isArray(action.payload) ? action.payload.length : 1}项)`;
    case 'openFile':
      return `文件: ${action.payload?.name || '未知'}`;
    case 'editor':
    default:
      return `编辑器: ${action.description || '内容'}`;
  }
}

function getModeFromAction(action: StudioAction): Mode {
  switch (action.type) {
    case 'openUrl': return 'html';
    case 'list':
    case 'searchResults': return 'list';
    case 'folder':
    case 'openFolder': return 'folder';
    case 'image': return 'image';
    case 'htmlReport': return 'htmlReport';
    case 'videoSearch': return 'videoSearch';
    case 'openFile':
    case 'editor':
    default: return 'editor';
  }
}

function updateTabData(tab: Tab, action: StudioAction) {
  switch (action.type) {
    case 'openUrl':
      tab.htmlUrl = action.payload?.url ?? 'about:blank';
      break;
    case 'list':
    case 'searchResults':
      tab.listPayload = Array.isArray(action.payload) ? action.payload : [action.payload];
      break;
    case 'folder':
    case 'openFolder':
      tab.payload = action.payload;
      break;
    case 'image':
      tab.imageUrl = action.payload?.url ?? (typeof action.payload === 'string' ? action.payload : '');
      break;
    case 'htmlReport':
      tab.htmlContent = action.payload?.htmlContent ?? '';
      tab.reportTitle = action.payload?.title ?? 'HTML报告';
      tab.reportFileName = action.payload?.fileName ?? 'report.html';
      break;
    case 'videoSearch':
      tab.videoSearchData = {
        keyword: action.payload?.keyword ?? '',
        videos: action.payload?.videos ?? [],
        albumInfo: action.payload?.albumInfo ?? {},
        totalCount: action.payload?.totalCount ?? 0,
        page: action.payload?.page ?? 1,
        pageSize: action.payload?.pageSize ?? 25
      };
      break;
    case 'openFile':
    case 'editor':
    default:
      tab.stringPayload = typeof action.payload === 'string' ? action.payload : format(action.payload);
      break;
  }
}

function switchTab(tabId: string) {
  const tab = tabs.value.find(t => t.id === tabId);
  if (!tab) return;
  
  activeTabId.value = tabId;
  mode.value = tab.mode;
  payload.value = tab.payload;
  
  // 恢复标签的数据
  if (tab.htmlUrl) htmlUrl.value = tab.htmlUrl;
  if (tab.listPayload) listPayload.value = tab.listPayload;
  if (tab.stringPayload) stringPayload.value = tab.stringPayload;
  if (tab.imageUrl) imageUrl.value = tab.imageUrl;
  if (tab.htmlContent) htmlContent.value = tab.htmlContent;
  if (tab.reportTitle) reportTitle.value = tab.reportTitle;
  if (tab.reportFileName) reportFileName.value = tab.reportFileName;
  if (tab.videoSearchData) videoSearchData.value = tab.videoSearchData;
}

function closeTab(tabId: string) {
  const tabIndex = tabs.value.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;
  
  tabs.value.splice(tabIndex, 1);
  
  // 如果关闭的是当前活动标签，切换到其他标签
  if (activeTabId.value === tabId) {
    if (tabs.value.length > 0) {
      // 切换到最后一个标签
      const lastTab = tabs.value[tabs.value.length - 1];
      switchTab(lastTab.id);
    } else {
      // 没有标签了，隐藏面板
      visible.value = false;
    }
  }
}

// 历史记录导航
function navigateHistory(direction: number) {
  const tab = activeTab.value;
  if (!tab || tab.history.length <= 1) return;
  
  const newIndex = tab.currentIndex + direction;
  if (newIndex >= 0 && newIndex < tab.history.length) {
    tab.currentIndex = newIndex;
    const historyItem = tab.history[newIndex];
    
    // 更新当前显示的数据
    updateTabData(tab, historyItem.action);
    console.log(`[StudioPane] 导航到历史记录: ${newIndex}, 标题: ${historyItem.title}`);
  }
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

// 视频搜索相关函数
function openVideo(video: any) {
  if (video.playUrl) {
    // 在新标签页中打开视频
    window.open(video.playUrl, '_blank');
  } else {
    console.warn('视频播放链接不可用');
  }
}

function playVideo(video: any) {
  if (video.playUrl) {
    // 在Studio中打开视频页面
    studioBus.preview({
      type: 'openUrl',
      description: `播放视频: ${video.title}`,
      payload: { url: video.playUrl }
    });
  } else {
    console.warn('视频播放链接不可用');
  }
}

function showVideoInfo(video: any) {
  // 显示视频详细信息
  const videoInfo = {
    title: video.title,
    number: video.number,
    duration: video.duration,
    year: video.year,
    qipuId: video.qipuId,
    playUrl: video.playUrl,
    cover: video.cover
  };
  
  studioBus.preview({
    type: 'editor',
    description: `视频信息: ${video.title}`,
    payload: JSON.stringify(videoInfo, null, 2)
  });
}

function handleImageError(event: Event) {
  const img = event.target as HTMLImageElement;
  img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjkwIiB2aWV3Qm94PSIwIDAgMTIwIDkwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTAiIGZpbGw9IiMzNzQxNTEiLz48dGV4dCB4PSI2MCIgeT0iNDUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzlDQTNBRiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+5Zu+54mH5Yqg6L295aSx6LSlPC90ZXh0Pjwvc3ZnPg==';
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

    // 创建或更新标签
    const tabId = createOrUpdateTab(action);
    
    // 切换到新创建的标签
    switchTab(tabId);
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
  max-width: 100%; /* 确保不超过父容器宽度 */
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

/* 标签栏样式 */
.studio-pane__tabs {
  display: flex;
  background: #111827;
  border-bottom: 1px solid #1f2937;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: #374151 #111827;
}

.studio-pane__tabs::-webkit-scrollbar {
  height: 4px;
}

.studio-pane__tabs::-webkit-scrollbar-track {
  background: #111827;
}

.studio-pane__tabs::-webkit-scrollbar-thumb {
  background: #374151;
  border-radius: 2px;
}

.studio-pane__tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #1f2937;
  color: #9ca3af;
  border-right: 1px solid #374151;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
  min-width: 120px;
  max-width: 200px;
}

.studio-pane__tab:hover {
  background: #374151;
  color: #e5e7eb;
}

.studio-pane__tab.active {
  background: #0b0b0f;
  color: #e5e7eb;
  border-bottom: 2px solid #3b82f6;
}

.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.9rem;
}

.tab-close {
  background: transparent;
  color: #6b7280;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 2px;
  border-radius: 2px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.tab-close:hover {
  background: #ef4444;
  color: white;
}

.tab-count {
  background: #3b82f6;
  color: white;
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 10px;
  margin-left: 4px;
}

/* 历史记录导航样式 */
.history-navigation {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #1f2937;
  border-bottom: 1px solid #374151;
  font-size: 0.9rem;
}

.nav-btn {
  background: #374151;
  color: #e5e7eb;
  border: none;
  border-radius: 4px;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.8rem;
  min-width: 32px;
}

.nav-btn:hover:not(:disabled) {
  background: #4b5563;
}

.nav-btn:disabled {
  background: #1f2937;
  color: #6b7280;
  cursor: not-allowed;
}

.history-info {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.current-item {
  color: #e5e7eb;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

.history-counter {
  color: #9ca3af;
  font-size: 0.8rem;
}

.studio-pane__content { 
  flex: 1; 
  overflow: auto; 
  min-width: 0; /* 防止flex子元素溢出 */
}
.studio-pane__iframe { 
  width: 100%; 
  height: 100%; 
  border: none; 
  background: #0b0b0f; 
  min-width: 0; /* 防止iframe内容导致容器变宽 */
  word-break: break-all; /* 强制长链接换行 */
}
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

/* 视频搜索样式 */
.video-search-container { 
  width: 100%; 
  height: 100%; 
  display: flex; 
  flex-direction: column; 
  background: #0b0b0f; 
  overflow: hidden;
}

.video-search-header { 
  padding: 16px; 
  border-bottom: 1px solid #1f2937; 
  background: #111827;
}

.search-title { 
  color: #e5e7eb; 
  font-size: 1.2rem; 
  font-weight: 600; 
  margin: 0 0 8px 0; 
}

.search-info { 
  display: flex; 
  gap: 16px; 
  font-size: 0.9rem; 
  color: #9ca3af;
}

.keyword { 
  color: #3b82f6; 
  font-weight: 500;
}

.count { 
  color: #10b981;
}

.album-info { 
  padding: 12px 16px; 
  background: #1f2937; 
  border-bottom: 1px solid #374151;
}

.album-title { 
  color: #e5e7eb; 
  font-size: 1rem; 
  font-weight: 600; 
  margin: 0 0 4px 0;
}

.album-desc { 
  color: #9ca3af; 
  font-size: 0.9rem; 
  margin: 0; 
  line-height: 1.4;
}

.video-list { 
  flex: 1; 
  overflow-y: auto; 
  padding: 16px;
}

.video-item { 
  display: flex; 
  gap: 12px; 
  padding: 12px; 
  background: #1f2937; 
  border-radius: 8px; 
  margin-bottom: 12px; 
  cursor: pointer; 
  transition: all 0.2s ease;
  border: 1px solid #374151;
}

.video-item:hover { 
  background: #374151; 
  border-color: #3b82f6;
}

.video-cover { 
  position: relative; 
  flex-shrink: 0;
}

.cover-image { 
  width: 120px; 
  height: 90px; 
  object-fit: cover; 
  border-radius: 6px; 
  background: #374151;
}

.video-duration { 
  position: absolute; 
  bottom: 4px; 
  right: 4px; 
  background: rgba(0, 0, 0, 0.8); 
  color: white; 
  font-size: 0.8rem; 
  padding: 2px 6px; 
  border-radius: 4px;
}

.video-info { 
  flex: 1; 
  display: flex; 
  flex-direction: column; 
  gap: 4px;
}

.video-title { 
  color: #e5e7eb; 
  font-size: 1rem; 
  font-weight: 600; 
  margin: 0; 
  line-height: 1.3;
}

.video-number { 
  color: #3b82f6; 
  font-size: 0.9rem; 
  margin: 0;
}

.video-year { 
  color: #9ca3af; 
  font-size: 0.9rem; 
  margin: 0;
}

.video-actions { 
  display: flex; 
  gap: 8px; 
  margin-top: 8px;
}

.play-btn, .info-btn { 
  background: #3b82f6; 
  color: white; 
  border: none; 
  border-radius: 4px; 
  padding: 6px 12px; 
  font-size: 0.8rem; 
  cursor: pointer; 
  transition: background-color 0.2s;
}

.play-btn:hover { 
  background: #2563eb;
}

.info-btn { 
  background: #6b7280;
}

.info-btn:hover { 
  background: #4b5563;
}

.no-results { 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  justify-content: center; 
  height: 200px; 
  color: #9ca3af; 
  text-align: center;
}

.no-results p { 
  margin: 4px 0; 
  font-size: 1rem;
}
</style>

