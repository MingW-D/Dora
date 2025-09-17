<template>
  <div class="subtask-container" :class="{ collapsed: isCollapsed }">
    <div class="subtask-header" @click="toggleCollapse">
      <div class="subtask-info">
        <span class="subtask-icon">📋</span>
        <span class="subtask-title">子任务 #{{ subtaskNumber }}: {{ subtaskDescription }}</span>
        <span class="subtask-status" :class="status">
          {{ getStatusText(status) }}
        </span>
      </div>
      <div class="collapse-icon">
        {{ isCollapsed ? '▶' : '▼' }}
      </div>
    </div>
    
    <transition name="collapse">
      <div v-if="!isCollapsed" class="subtask-body">
        <div class="subtask-content">
          <slot></slot>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  subtaskNumber: number;
  subtaskDescription: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}>();

const isCollapsed = ref(false);

// 当子任务完成时自动折叠
watch(() => props.status, (newStatus) => {
  if (newStatus === 'completed' || newStatus === 'failed') {
    setTimeout(() => {
      isCollapsed.value = true;
    }, 3000); // 3秒后自动折叠
  }
});

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
};

const getStatusText = (status: string): string => {
  switch (status) {
    case 'pending':
      return '待执行';
    case 'running':
      return '执行中...';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
};
</script>

<style scoped>
.subtask-container {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin: 12px 0;
  background-color: #f9fafb;
  overflow: hidden;
  transition: all 0.3s ease;
}

.subtask-container.collapsed {
  background-color: #f3f4f6;
}

.subtask-header {
  padding: 14px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  background-color: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.subtask-container.collapsed .subtask-header {
  border-bottom: none;
}

.subtask-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.subtask-icon {
  font-size: 20px;
}

.subtask-title {
  font-weight: 600;
  color: #1f2937;
  flex: 1;
}

.subtask-status {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.subtask-status.pending {
  background-color: #f3f4f6;
  color: #6b7280;
}

.subtask-status.running {
  background-color: #dbeafe;
  color: #1e40af;
}

.subtask-status.completed {
  background-color: #d1fae5;
  color: #065f46;
}

.subtask-status.failed {
  background-color: #fee2e2;
  color: #991b1b;
}

.collapse-icon {
  color: #6b7280;
  font-size: 12px;
  transition: transform 0.3s ease;
  margin-left: 12px;
}

.subtask-body {
  padding: 18px;
  background-color: #ffffff;
}

.subtask-content {
  color: #374151;
  line-height: 1.6;
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