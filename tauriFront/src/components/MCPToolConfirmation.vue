<script setup lang="ts">
import { ref, defineProps, defineEmits } from 'vue';

const props = defineProps<{
  toolName: string;
  toolOutput: string;
  isLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const handleConfirm = () => {
  emit('confirm');
};

const handleCancel = () => {
  emit('cancel');
};
</script>

<template>
  <div class="mcp-tool-confirmation">
    <div class="tool-header">
      <div class="tool-icon">🛠️</div>
      <div class="tool-name">工具: {{ toolName }}</div>
    </div>
    
    <div class="tool-output">
      <div v-if="isLoading" class="loading">
        <div class="spinner"></div>
        <span>工具执行中...</span>
      </div>
      <div v-else class="output-content">
        <div class="output-text">{{ toolOutput }}</div>
      </div>
    </div>
    
    <div class="action-buttons" v-if="!isLoading">
      <button @click="handleConfirm" class="confirm-btn">确认继续</button>
      <button @click="handleCancel" class="cancel-btn">取消操作</button>
    </div>
  </div>
</template>

<style scoped>
.mcp-tool-confirmation {
  background-color: var(--hover-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  margin: 10px 0;
  padding: 12px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.tool-header {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.tool-icon {
  font-size: 20px;
  margin-right: 8px;
}

.tool-name {
  font-weight: 600;
  font-size: 16px;
  color: var(--primary-color);
}

.tool-output {
  background-color: var(--bg-color);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 12px;
  min-height: 100px;
  max-height: 300px;
  overflow-y: auto;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100px;
}

.spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--border-color);
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 8px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.output-text {
  white-space: pre-wrap;
  font-family: monospace;
}

.action-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.confirm-btn, .cancel-btn {
  padding: 6px 12px;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.confirm-btn {
  background-color: var(--primary-color);
  color: white;
}

.confirm-btn:hover {
  background-color: var(--primary-color-dark);
}

.cancel-btn {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.cancel-btn:hover {
  background-color: rgba(239, 68, 68, 0.2);
}

@media (prefers-color-scheme: dark) {
  .tool-output {
    background-color: var(--sidebar-bg);
  }
}
</style> 