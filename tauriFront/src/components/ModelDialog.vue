<script setup lang="ts">
import { ref, watch } from 'vue';
import { useModelStore } from '../stores/modelStore';

const modelStore = useModelStore();

// 监听模型对话框的打开状态
watch(() => modelStore.isModelDialogOpen, (isOpen) => {
  if (!isOpen) {
    // 关闭对话框时重置错误信息
    errorMessage.value = '';
  }
});

// 错误提示
const errorMessage = ref('');

// 根据provider获取占位符
function getModelNamePlaceholder() {
  if (modelStore.editingModel.provider === 'ollama') {
    return '如：llama2, qwen:7b, codellama';
  } else if (modelStore.editingModel.provider === 'modelscope') {
    return '如：Qwen/Qwen3-Next-80B-A3B-Instruct, Qwen/Qwen2.5-7B-Instruct';
  } else {
    return '如：gpt-4, gpt-3.5-turbo';
  }
}

function getApiUrlPlaceholder() {
  if (modelStore.editingModel.provider === 'ollama') {
    return '如：http://localhost:11434/v1';
  } else if (modelStore.editingModel.provider === 'modelscope') {
    return '如：https://api-inference.modelscope.cn/v1';
  } else {
    return '如：https://api.openai.com/v1/chat/completions';
  }
}

// Provider变化时更新默认值
function onProviderChange() {
  if (modelStore.editingModel.provider === 'ollama') {
    if (!modelStore.editingModel.api_url || modelStore.editingModel.api_url.includes('openai.com') || modelStore.editingModel.api_url.includes('modelscope.cn')) {
      modelStore.editingModel.api_url = 'http://localhost:11434/v1';
    }
  } else if (modelStore.editingModel.provider === 'openai') {
    if (!modelStore.editingModel.api_url || modelStore.editingModel.api_url.includes('localhost:11434') || modelStore.editingModel.api_url.includes('modelscope.cn')) {
      modelStore.editingModel.api_url = 'https://api.openai.com/v1/chat/completions';
    }
  } else if (modelStore.editingModel.provider === 'modelscope') {
    if (!modelStore.editingModel.api_url || modelStore.editingModel.api_url.includes('openai.com') || modelStore.editingModel.api_url.includes('localhost:11434')) {
      modelStore.editingModel.api_url = 'https://api-inference.modelscope.cn/v1';
    }
  }
}

// 保存模型配置
async function saveModel() {
  // 基本验证
  if (!modelStore.editingModel.name.trim()) {
    errorMessage.value = '请输入模型名称';
    return;
  }

  if (!modelStore.editingModel.model_name.trim()) {
    errorMessage.value = '请输入模型ID';
    return;
  }

  if (!modelStore.editingModel.api_url.trim()) {
    errorMessage.value = '请输入API URL';
    return;
  }

  if (!modelStore.editingModel.prompt_template.trim()) {
    errorMessage.value = '请输入提示词模板';
    return;
  }

  // 保存
  const success = await modelStore.saveModelConfig();
  if (!success) {
    errorMessage.value = '保存失败，请重试';
  }
}

// 取消编辑
function cancelEdit() {
  modelStore.closeModelDialog();
}
</script>

<template>
  <div 
    v-if="modelStore.isModelDialogOpen" 
    class="model-overlay"
  >
    <div 
      class="model-dialog"
      @click.stop
    >
      <div class="dialog-header">
        <h2>{{ modelStore.isEditingModel ? '编辑模型' : '添加新模型' }}</h2>
        <button class="close-btn" @click="cancelEdit">×</button>
      </div>
      
      <div class="dialog-body">
        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>
        
        <div class="form-group">
          <label for="provider">模型提供商</label>
          <select 
            id="provider" 
            v-model="modelStore.editingModel.provider"
            @change="onProviderChange"
          >
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
            <option value="modelscope">ModelScope</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="name">模型显示名称</label>
          <input 
            id="name" 
            v-model="modelStore.editingModel.name" 
            type="text" 
            placeholder="如：GPT-4，Claude 3"
          />
        </div>
        
        <div class="form-group">
          <label for="model_name">模型ID</label>
          <input 
            id="model_name" 
            v-model="modelStore.editingModel.model_name" 
            type="text" 
            :placeholder="getModelNamePlaceholder()"
          />
        </div>
        
        <div class="form-group">
          <label for="api_url">API URL</label>
          <input 
            id="api_url" 
            v-model="modelStore.editingModel.api_url" 
            type="text" 
            :placeholder="getApiUrlPlaceholder()"
          />
        </div>
        
        <div class="form-group">
          <label for="api_key">API Key</label>
          <input 
            id="api_key" 
            v-model="modelStore.editingModel.api_key" 
            type="password" 
            placeholder="输入 API Key"
          />
        </div>
        
        <div class="form-group">
          <label for="description">模型描述</label>
          <input 
            id="description" 
            v-model="modelStore.editingModel.description" 
            type="text" 
            placeholder="模型的简短描述"
          />
        </div>
        
        <div class="form-group">
          <label for="prompt_template">提示词模板</label>
          <textarea 
            id="prompt_template" 
            v-model="modelStore.editingModel.prompt_template" 
            placeholder="输入提示词模板，使用 {{query}} 表示用户输入"
            rows="4"
          ></textarea>
          <div class="help-text">
            我是一个AI助手
          </div>
        </div>
        
        <div class="form-group">
          <label for="temperature">温度 ({{ modelStore.editingModel.temperature }})</label>
          <input 
            id="temperature" 
            v-model.number="modelStore.editingModel.temperature" 
            type="range" 
            min="0" 
            max="2" 
            step="0.1" 
          />
          <div class="range-labels">
            <span>确定性更高</span>
            <span>创造性更高</span>
          </div>
        </div>
        
        <div class="form-group">
          <label for="max_tokens">最大 Token 数</label>
          <input 
            id="max_tokens" 
            v-model.number="modelStore.editingModel.max_tokens" 
            type="number" 
            min="100" 
            max="8000" 
          />
        </div>
        
        <div class="form-group checkbox-group">
          <input 
            id="supports_tools" 
            v-model="modelStore.editingModel.supports_tools"
            type="checkbox"
          />
          <label for="supports_tools">支持工具调用 (Functions)</label>
          <div class="help-text">
            如果不确定，保持未勾选。OpenAI模型通常支持，部分Ollama模型不支持。
          </div>
        </div>
        
        <div class="form-group checkbox-group">
          <input 
            id="is_default" 
            v-model="modelStore.editingModel.is_default" 
            type="checkbox"
          />
          <label for="is_default">设为默认模型</label>
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="cancel-btn" @click="cancelEdit">取消</button>
        <button class="save-btn" @click="saveModel">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.model-dialog {
  width: 560px;
  max-width: 90%;
  background-color: var(--bg-color);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
}

.dialog-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.close-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background-color: transparent;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-secondary);
}

.close-btn:hover {
  background-color: var(--hover-bg);
}

.dialog-body {
  padding: 24px;
  overflow-y: auto;
  flex-grow: 1;
}

.error-message {
  padding: 10px;
  margin-bottom: 16px;
  background-color: rgba(239, 68, 68, 0.1);
  border-left: 3px solid #ef4444;
  color: #ef4444;
  border-radius: 4px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.form-group input[type="text"],
.form-group input[type="password"],
.form-group input[type="number"],
.form-group select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background-color: var(--bg-color);
  color: var(--text-primary);
  font-size: 14px;
}

.form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background-color: var(--bg-color);
  color: var(--text-primary);
  font-size: 14px;
  resize: vertical;
}

.form-group input[type="range"] {
  width: 100%;
  margin: 4px 0;
}

.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.checkbox-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-group label {
  margin: 0;
}

.help-text {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.5;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
}

.dialog-footer button {
  padding: 8px 20px;
  border-radius: 6px;
  border: none;
  font-weight: 500;
  cursor: pointer;
}

.cancel-btn {
  background-color: var(--hover-bg);
  color: var(--text-primary);
}

.save-btn {
  background-color: var(--primary-color);
  color: white;
}

.save-btn:hover {
  background-color: var(--primary-dark);
}
</style> 