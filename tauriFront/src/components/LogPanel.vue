<script setup lang="ts">
import { useSettingsStore } from '../stores/settingsStore';
import { ref, watch, onMounted } from 'vue';

const settingsStore = useSettingsStore();

// 日志面板参考
const logPanelRef = ref<HTMLDivElement | null>(null);
const isExpanded = ref(false);
const searchTerm = ref('');
const autoScroll = ref(true);

// 按日志类型过滤
const showInfo = ref(true);
const showWarning = ref(true);
const showError = ref(true);

// 自动滚动到最新日志
watch(() => settingsStore.logs, () => {
  if (autoScroll.value && logPanelRef.value) {
    setTimeout(() => {
      if (logPanelRef.value) {
        logPanelRef.value.scrollTop = logPanelRef.value.scrollHeight;
      }
    }, 0);
  }
}, { deep: true });

// 日志过滤方法
function filterLogs() {
  return settingsStore.logs.filter(log => {
    // 按类型过滤
    if (log.type === 'info' && !showInfo.value) return false;
    if (log.type === 'warning' && !showWarning.value) return false;
    if (log.type === 'error' && !showError.value) return false;
    
    // 按搜索词过滤
    if (searchTerm.value && !log.message.toLowerCase().includes(searchTerm.value.toLowerCase())) {
      return false;
    }
    
    return true;
  });
}

// 清除所有日志
function clearLogs() {
  settingsStore.clearLogs();
}

// 切换展开/收起状态
function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}

// 关闭日志面板
function closePanel() {
  settingsStore.toggleLogPanel();
}
</script>

<template>
  <div 
    v-if="settingsStore.showLogPanel" 
    class="log-panel"
    :class="{ 'expanded': isExpanded }"
  >
    <div class="log-panel-header">
      <div class="header-title">开发者日志</div>
      <div class="header-actions">
        <button class="header-btn" @click="toggleExpand">
          {{ isExpanded ? '收起' : '展开' }}
        </button>
        <button class="header-btn clear" @click="clearLogs">
          清空
        </button>
        <button class="header-btn close" @click="closePanel">
          ×
        </button>
      </div>
    </div>
    
    <div class="log-panel-toolbar">
      <div class="search-container">
        <input 
          type="text" 
          v-model="searchTerm" 
          placeholder="搜索日志..." 
          class="search-input"
        />
      </div>
      
      <div class="filter-container">
        <label class="filter-option">
          <input type="checkbox" v-model="showInfo" />
          <span class="filter-label info">信息</span>
        </label>
        <label class="filter-option">
          <input type="checkbox" v-model="showWarning" />
          <span class="filter-label warning">警告</span>
        </label>
        <label class="filter-option">
          <input type="checkbox" v-model="showError" />
          <span class="filter-label error">错误</span>
        </label>
        <label class="filter-option">
          <input type="checkbox" v-model="autoScroll" />
          <span class="filter-label">自动滚动</span>
        </label>
      </div>
    </div>
    
    <div class="log-panel-content" ref="logPanelRef">
      <div v-if="filterLogs().length === 0" class="empty-logs">
        暂无日志记录
      </div>
      
      <div 
        v-for="(log, index) in filterLogs()" 
        :key="index"
        class="log-item"
        :class="log.type"
      >
        <div class="log-time">{{ log.time }}</div>
        <div class="log-badge" :class="log.type">
          {{ log.type === 'info' ? 'INFO' : log.type === 'warning' ? 'WARN' : 'ERROR' }}
        </div>
        <div class="log-message">{{ log.message }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-panel {
  position: fixed;
  bottom: 10px;
  right: 10px;
  width: 600px;
  height: 300px;
  background-color: #1e1e1e;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  z-index: 990;
  color: #e0e0e0;
  transition: height 0.3s ease;
}

.log-panel.expanded {
  height: 600px;
}

.log-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: #333;
  border-radius: 8px 8px 0 0;
  border-bottom: 1px solid #444;
}

.header-title {
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.header-btn {
  background-color: transparent;
  border: none;
  color: #e0e0e0;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.header-btn:hover {
  background-color: #444;
}

.header-btn.clear {
  color: #ff9e3d;
}

.header-btn.close {
  color: #ff6464;
  font-size: 16px;
  font-weight: bold;
}

.log-panel-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: #252525;
  border-bottom: 1px solid #444;
}

.search-container {
  flex: 1;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  background-color: #333;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
}

.filter-container {
  display: flex;
  gap: 10px;
  margin-left: 10px;
}

.filter-option {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
}

.filter-label {
  font-size: 12px;
}

.filter-label.info {
  color: #64b5f6;
}

.filter-label.warning {
  color: #ffd54f;
}

.filter-label.error {
  color: #ff8a80;
}

.log-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
}

.empty-logs {
  padding: 20px;
  text-align: center;
  color: #888;
  font-style: italic;
}

.log-item {
  padding: 6px 12px;
  display: flex;
  align-items: flex-start;
  border-bottom: 1px solid #333;
  word-break: break-word;
}

.log-item.info {
  background-color: rgba(100, 181, 246, 0.05);
}

.log-item.warning {
  background-color: rgba(255, 213, 79, 0.1);
}

.log-item.error {
  background-color: rgba(255, 138, 128, 0.1);
}

.log-time {
  min-width: 80px;
  color: #888;
  margin-right: 10px;
}

.log-badge {
  min-width: 50px;
  text-align: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  margin-right: 10px;
}

.log-badge.info {
  background-color: rgba(100, 181, 246, 0.2);
  color: #64b5f6;
}

.log-badge.warning {
  background-color: rgba(255, 213, 79, 0.2);
  color: #ffd54f;
}

.log-badge.error {
  background-color: rgba(255, 138, 128, 0.2);
  color: #ff8a80;
}

.log-message {
  flex: 1;
  line-height: 1.5;
}
</style> 