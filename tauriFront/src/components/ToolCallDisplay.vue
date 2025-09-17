<template>
  <div class="tool-call-container" :class="{ collapsed: isCollapsed }">
    <div class="tool-call-header" @click="toggleCollapse">
      <div class="tool-info">
        <span class="tool-icon">🔧</span>
        <span class="tool-name">{{ toolMessage.toolName }}</span>
        <span class="tool-status" :class="toolMessage.status">
          {{ getStatusText(toolMessage.status) }}
        </span>
      </div>
      <div class="collapse-icon">
        {{ isCollapsed ? '▶' : '▼' }}
      </div>
    </div>
    
    <transition name="collapse">
      <div v-if="!isCollapsed" class="tool-call-body">
        <div v-if="toolMessage.parameters" class="tool-params">
          <div class="section-title">参数：</div>
          <pre class="params-content">{{ formatParams(toolMessage.parameters) }}</pre>
        </div>
        
        <div v-if="toolMessage.result" class="tool-result">
          <div class="section-title">结果：</div>
          <pre class="result-content">{{ formatResult(toolMessage.result) }}</pre>
        </div>
        
        <div v-if="toolMessage.error" class="tool-error">
          <div class="section-title">错误：</div>
          <pre class="error-content">{{ toolMessage.error }}</pre>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ToolMessage } from '../types';

const props = defineProps<{
  toolMessage: ToolMessage;
}>();

const isCollapsed = ref(false);

// 当工具调用完成时自动折叠
watch(() => props.toolMessage.status, (newStatus) => {
  if (newStatus === 'completed' || newStatus === 'failed') {
    setTimeout(() => {
      isCollapsed.value = true;
    }, 2000); // 2秒后自动折叠
  }
});

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
};

const getStatusText = (status: string): string => {
  switch (status) {
    case 'started':
      return '执行中...';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
};

const formatParams = (params: any): string => {
  return JSON.stringify(params, null, 2);
};

const formatResult = (result: any): string => {
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result, null, 2);
};
</script>

<style scoped>
.tool-call-container {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin: 8px 0;
  background-color: #f9fafb;
  overflow: hidden;
  transition: all 0.3s ease;
}

.tool-call-container.collapsed {
  background-color: #f3f4f6;
}

.tool-call-header {
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  background-color: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.tool-call-container.collapsed .tool-call-header {
  border-bottom: none;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-icon {
  font-size: 18px;
}

.tool-name {
  font-weight: 600;
  color: #1f2937;
}

.tool-status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.tool-status.started {
  background-color: #dbeafe;
  color: #1e40af;
}

.tool-status.completed {
  background-color: #d1fae5;
  color: #065f46;
}

.tool-status.failed {
  background-color: #fee2e2;
  color: #991b1b;
}

.collapse-icon {
  color: #6b7280;
  font-size: 12px;
  transition: transform 0.3s ease;
}

.tool-call-body {
  padding: 16px;
  background-color: #ffffff;
}

.section-title {
  font-weight: 600;
  color: #374151;
  margin-bottom: 8px;
  font-size: 14px;
}

.params-content,
.result-content,
.error-content {
  background-color: #f3f4f6;
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
}

.error-content {
  background-color: #fef2f2;
  color: #991b1b;
}

.tool-params,
.tool-result,
.tool-error {
  margin-bottom: 12px;
}

.tool-params:last-child,
.tool-result:last-child,
.tool-error:last-child {
  margin-bottom: 0;
}

/* 折叠动画 */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.3s ease;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>