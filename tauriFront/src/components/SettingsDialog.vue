<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settingsStore';
import { useModelStore } from '../stores/modelStore';
import ModelDialog from './ModelDialog.vue';
import databaseService from '../services/database';

const settingsStore = useSettingsStore();
const modelStore = useModelStore();

const activeTab = ref('api-settings');

const apiKeyInput = ref('');
const apiKeyMasked = ref(true);

// 加载模型配置
onMounted(async () => {
  if (!modelStore.isConfigsLoaded) {
    await modelStore.loadModelConfigs();
  }
  // 初始化API Key输入
  if (modelStore.currentModel?.api_key) {
    apiKeyInput.value = modelStore.currentModel.api_key;
  }
});

// 监听设置对话框的打开状态
watch(() => settingsStore.isOpen, (isOpen) => {
  if (isOpen && !modelStore.isConfigsLoaded) {
    modelStore.loadModelConfigs();
  }
  
  // 打开对话框时更新API Key输入
  if (isOpen && modelStore.currentModel) {
    apiKeyInput.value = modelStore.currentModel.api_key || '';
  }
});

// 监听当前模型变化
watch(() => modelStore.currentModelId, () => {
  if (modelStore.currentModel) {
    apiKeyInput.value = modelStore.currentModel.api_key || '';
  }
});

// 打开添加模型对话框
function openAddModelDialog() {
  modelStore.openModelDialog();
}

// 打开编辑模型对话框
function openEditModelDialog(id: string) {
  modelStore.openEditModelDialog(id);
}

// 删除模型
async function deleteModel(id: string) {
  if (confirm('确认删除此模型配置？')) {
    await modelStore.deleteModelConfig(id);
  }
}

// 设置当前模型
function setCurrentModel(id: string) {
  modelStore.setCurrentModel(id);
  // 更新API Key输入
  if (modelStore.currentModel) {
    apiKeyInput.value = modelStore.currentModel.api_key || '';
  }
  // 关闭设置对话框
  settingsStore.closeSettings();
}

// 切换API密钥显示
function toggleApiKeyVisibility() {
  apiKeyMasked.value = !apiKeyMasked.value;
}

// 保存API Key
async function saveApiKey() {
  if (!modelStore.currentModel) return;
  
  try {
    // 从当前模型获取必要的信息
    const modelToUpdate = { ...modelStore.currentModel };
    
    // 更新API Key
    modelToUpdate.api_key = apiKeyInput.value;
    
    // 保存到数据库
    await databaseService.setSetting(`api_key_${modelToUpdate.id}`, apiKeyInput.value);
    
    // 重新加载模型配置
    await modelStore.loadModelConfigs();
    
    alert('API Key已保存');
  } catch (error) {
    console.error('保存API Key失败:', error);
    alert('保存失败，请重试');
  }
}
</script>

<template>
  <div 
    v-if="settingsStore.isOpen" 
    class="settings-overlay"
  >
    <div 
      class="settings-dialog"
      @click.stop
    >
      <div class="dialog-header">
        <h2>设置</h2>
        <button class="close-btn" @click="settingsStore.closeSettings">×</button>
      </div>
      
      <div class="tabs">
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'models' }"
          @click="activeTab = 'models'"
        >
          模型管理
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'api-settings' }"
          @click="activeTab = 'api-settings'"
        >
          API设置
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: activeTab === 'advanced' }"
          @click="activeTab = 'advanced'"
        >
          高级设置
        </button>
      </div>
      
      <div class="dialog-body">
        <!-- 模型管理 -->
        <div v-if="activeTab === 'models'" class="tab-content">
          <div v-if="!modelStore.isConfigsLoaded" class="loading-state">
            正在加载模型配置...
          </div>
          
          <div v-else>
            <div class="add-model-container">
              <button class="add-model-btn" @click="openAddModelDialog">
                <span class="icon">+</span> 添加新模型
              </button>
            </div>
            
            <div v-if="modelStore.modelConfigs.length === 0" class="empty-list">
              没有可用的模型配置，请添加一个。
            </div>
            
            <div v-else class="model-list">
              <div 
                v-for="model in modelStore.modelConfigs" 
                :key="model.id"
                class="model-item"
                :class="{ active: modelStore.currentModelId === model.id }"
              >
                <div class="model-info" @click="setCurrentModel(model.id)">
                  <div class="model-name">
                    {{ model.name }}
                    <span v-if="model.is_default" class="default-badge">默认</span>
                  </div>
                  <div class="model-id">{{ model.model_name }}</div>
                  <div class="model-desc">{{ model.description }}</div>
                </div>
                <div class="model-actions">
                  <button class="edit-btn" @click="openEditModelDialog(model.id)">
                    <span class="icon">✎</span>
                  </button>
                  <button class="delete-btn" @click="deleteModel(model.id)" v-if="modelStore.modelConfigs.length > 1">
                    <span class="icon">×</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- API设置 -->
        <div v-if="activeTab === 'api-settings'" class="tab-content">
          <div class="form-group api-key-group">
            <label for="apiKey">API Key</label>
            <div class="api-key-container">
              <input 
                id="apiKey" 
                :type="apiKeyMasked ? 'password' : 'text'" 
                v-model="apiKeyInput" 
                placeholder="输入当前选中模型的 API Key"
              />
              <button class="toggle-visibility-btn" @click="toggleApiKeyVisibility">
                {{ apiKeyMasked ? '👁️' : '🙈' }}
              </button>
            </div>
            <div class="help-text">
              此API Key将用于当前选中的模型: {{ modelStore.currentModel?.name }}
            </div>
          </div>
          
          <div class="form-group">
            <button class="save-api-key-btn" @click="saveApiKey">
              保存API Key
            </button>
          </div>
        </div>
        
        <!-- 高级设置 -->
        <div v-if="activeTab === 'advanced'" class="tab-content">
          <div class="form-group">
            <div class="toggle-option">
              <span class="toggle-label">开发者模式</span>
              <label class="switch">
                <input type="checkbox" v-model="settingsStore.settings.developerMode">
                <span class="slider round"></span>
              </label>
            </div>
            <div class="help-text">
              启用开发者模式可查看调试日志和额外功能。启用后会在右下角显示日志按钮。
            </div>
          </div>
          
          <div class="form-group">
            <button class="save-settings-btn" @click="settingsStore.saveSettings">
              保存设置
            </button>
          </div>
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="close-btn-large" @click="settingsStore.closeSettings">关闭</button>
      </div>
    </div>
  </div>
  
  <!-- 模型对话框 -->
  <ModelDialog />
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20000; /* 提升层级，确保覆盖 Studio 等高层元素 */
}

.settings-dialog {
  width: 600px;
  max-width: 90%;
  background-color: white;
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

.tabs {
  display: flex;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-color);
}

.tab-btn {
  padding: 12px 20px;
  border: none;
  background: transparent;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-right: 8px;
}

.tab-btn.active {
  color: var(--primary-color);
  border-bottom: 2px solid var(--primary-color);
}

.tab-btn:hover:not(.active) {
  color: var(--text-primary);
  background-color: var(--hover-bg);
  border-radius: 4px 4px 0 0;
}

.dialog-body {
  padding: 0;
  overflow-y: auto;
  flex-grow: 1;
}

.tab-content {
  padding: 24px;
}

.add-model-container {
  margin-bottom: 16px;
}

.add-model-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background-color: var(--primary-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
}

.add-model-btn:hover {
  background-color: var(--primary-dark);
}

.loading-state, .empty-list {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-item {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  transition: all 0.2s;
}

.model-item:hover {
  background-color: var(--hover-bg);
}

.model-item.active {
  border-color: var(--primary-color);
  background-color: rgba(99, 102, 241, 0.05);
}

.model-info {
  flex: 1;
  cursor: pointer;
}

.model-name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.default-badge {
  background-color: var(--primary-light);
  color: var(--primary-color);
  padding: 2px 6px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: normal;
}

.model-id {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.model-desc {
  font-size: 14px;
  margin-top: 4px;
  color: var(--text-secondary);
}

.model-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.edit-btn, .delete-btn {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.edit-btn {
  background-color: rgba(99, 102, 241, 0.1);
  color: var(--primary-color);
}

.edit-btn:hover {
  background-color: rgba(99, 102, 241, 0.2);
}

.delete-btn {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.delete-btn:hover {
  background-color: rgba(239, 68, 68, 0.2);
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.api-key-group {
  margin-bottom: 24px;
}

.api-key-container {
  display: flex;
  gap: 8px;
}

.api-key-container input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background-color: #f9f9f9;
  color: var(--text-primary);
}

.toggle-visibility-btn {
  width: 40px;
  padding: 0;
  background-color: var(--hover-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.help-text {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.save-api-key-btn {
  padding: 8px 16px;
  background-color: var(--primary-color);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.save-api-key-btn:hover {
  background-color: var(--primary-dark);
}

.save-settings-btn {
  padding: 8px 16px;
  background-color: var(--primary-color);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.save-settings-btn:hover {
  background-color: var(--primary-dark);
}

.toggle-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.toggle-label {
  font-weight: 500;
}

/* 开关样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .4s;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .4s;
}

input:checked + .slider {
  background-color: var(--primary-color);
}

input:focus + .slider {
  box-shadow: 0 0 1px var(--primary-color);
}

input:checked + .slider:before {
  transform: translateX(24px);
}

.slider.round {
  border-radius: 34px;
}

.slider.round:before {
  border-radius: 50%;
}

.dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
}

.close-btn-large {
  padding: 8px 20px;
  background-color: var(--hover-bg);
  border: none;
  border-radius: 6px;
  color: var(--text-primary);
  font-weight: 500;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .model-item.active {
    background-color: rgba(99, 102, 241, 0.15);
  }
  
  .edit-btn {
    background-color: rgba(99, 102, 241, 0.15);
  }
  
  .delete-btn {
    background-color: rgba(239, 68, 68, 0.15);
  }
}
</style> 