import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import databaseService from '../services/database';

export interface ModelConfig {
  id: string;
  name: string;
  model_name: string;
  api_url: string;
  api_key?: string;
  description: string;
  prompt_template: string;
  temperature: number;
  max_tokens: number;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

// 默认的提示词模板
const DEFAULT_PROMPT_TEMPLATE = 
  "我是一个AI助手";

export const useModelStore = defineStore('models', () => {
  // 状态
  const modelConfigs = ref<ModelConfig[]>([]);
  const currentModelId = ref<string>('');
  const isConfigsLoaded = ref(false);
  const isModelDialogOpen = ref(false);
  const isEditingModel = ref(false);
  const editingModelId = ref<string | null>(null);

  // 当前编辑中的模型
  const editingModel = reactive<Omit<ModelConfig, 'id' | 'created_at' | 'updated_at'>>({
    name: '',
    model_name: '',
    api_url: '',
    api_key: '',
    description: '',
    prompt_template: DEFAULT_PROMPT_TEMPLATE,
    temperature: 0.7,
    max_tokens: 1500,
    is_default: false
  });

  // 获取当前选中的模型
  const currentModel = computed(() => {
    if (!currentModelId.value) {
      // 如果没有选择模型，返回默认模型
      const defaultModel = modelConfigs.value.find(model => model.is_default);
      if (defaultModel) {
        currentModelId.value = defaultModel.id;
        return defaultModel;
      }
      
      // 如果没有默认模型，返回第一个
      if (modelConfigs.value.length > 0) {
        currentModelId.value = modelConfigs.value[0].id;
        return modelConfigs.value[0];
      }
      
      // 没有任何模型，返回null
      return null;
    }
    
    return modelConfigs.value.find(model => model.id === currentModelId.value) || null;
  });

  // 加载所有模型配置
  async function loadModelConfigs() {
    try {
      const configs = await databaseService.getModelConfigs();
      
      // 如果没有模型配置，创建默认配置
      if (!configs || configs.length === 0) {
        await createDefaultModelConfig();
        modelConfigs.value = await databaseService.getModelConfigs();
      } else {
        modelConfigs.value = configs;
      }
      
      isConfigsLoaded.value = true;
      
      // 设置当前模型为默认模型
      const defaultModel = modelConfigs.value.find(model => model.is_default);
      if (defaultModel) {
        currentModelId.value = defaultModel.id;
      } else if (modelConfigs.value.length > 0) {
        currentModelId.value = modelConfigs.value[0].id;
      }
    } catch (error) {
      console.error('加载模型配置失败:', error);
    }
  }

  // 创建默认模型配置
  async function createDefaultModelConfig() {
    const id = uuidv4();
    const now = Date.now();
    
    const defaultConfig: ModelConfig = {
      id,
      name: 'OpenAI GPT-3.5',
      model_name: 'gpt-3.5-turbo',
      api_url: 'https://api.openai.com/v1/completions',
      description: 'OpenAI的GPT-3.5模型',
      prompt_template: DEFAULT_PROMPT_TEMPLATE,
      temperature: 0.7,
      max_tokens: 1500,
      is_default: true,
      created_at: now,
      updated_at: now
    };
    
    await databaseService.createModelConfig(defaultConfig);
    return id;
  }

  // 保存模型配置
  async function saveModelConfig() {
    try {
      const now = Date.now();
      
      // 编辑现有模型
      if (isEditingModel.value && editingModelId.value) {
        const updatedModel: ModelConfig = {
          id: editingModelId.value,
          ...editingModel,
          created_at: modelConfigs.value.find(m => m.id === editingModelId.value)?.created_at || now,
          updated_at: now
        };
        
        // 如果设置为默认，需要将其他模型设为非默认
        if (updatedModel.is_default) {
          for (const model of modelConfigs.value) {
            if (model.id !== updatedModel.id && model.is_default) {
              await databaseService.updateModelConfig({
                ...model, 
                is_default: false,
                updated_at: now
              });
            }
          }
        }
        
        await databaseService.updateModelConfig(updatedModel);
      } 
      // 创建新模型
      else {
        const id = uuidv4();
        const newModel: ModelConfig = {
          id,
          ...editingModel,
          created_at: now,
          updated_at: now
        };
        
        // 如果设置为默认，需要将其他模型设为非默认
        if (newModel.is_default) {
          for (const model of modelConfigs.value) {
            if (model.is_default) {
              await databaseService.updateModelConfig({
                ...model, 
                is_default: false,
                updated_at: now
              });
            }
          }
        }
        
        await databaseService.createModelConfig(newModel);
      }
      
      // 重新加载模型列表
      await loadModelConfigs();
      closeModelDialog();
      return true;
    } catch (error) {
      console.error('保存模型配置失败:', error);
      return false;
    }
  }

  // 删除模型配置
  async function deleteModelConfig(id: string) {
    try {
      const modelToDelete = modelConfigs.value.find(model => model.id === id);
      
      // 不允许删除最后一个模型
      if (modelConfigs.value.length <= 1) {
        return false;
      }
      
      await databaseService.deleteModelConfig(id);
      
      // 如果删除的是默认模型，需要设置新的默认模型
      if (modelToDelete?.is_default) {
        // 第一个非当前删除的模型设为默认
        const newDefaultModel = modelConfigs.value.find(model => model.id !== id);
        if (newDefaultModel) {
          await databaseService.updateModelConfig({
            ...newDefaultModel,
            is_default: true,
            updated_at: Date.now()
          });
        }
      }
      
      // 如果删除的是当前选中的模型，需要重新选择模型
      if (currentModelId.value === id) {
        const anotherModel = modelConfigs.value.find(model => model.id !== id);
        if (anotherModel) {
          currentModelId.value = anotherModel.id;
        }
      }
      
      // 重新加载模型列表
      await loadModelConfigs();
      return true;
    } catch (error) {
      console.error('删除模型配置失败:', error);
      return false;
    }
  }

  // 设置当前模型
  function setCurrentModel(id: string) {
    currentModelId.value = id;
  }

  // 打开模型对话框-新建模型
  function openModelDialog() {
    // 重置编辑中的模型
    Object.assign(editingModel, {
      name: '',
      model_name: '',
      api_url: '',
      api_key: '',
      description: '',
      prompt_template: DEFAULT_PROMPT_TEMPLATE,
      temperature: 0.7,
      max_tokens: 1500,
      is_default: false
    });
    
    isEditingModel.value = false;
    editingModelId.value = null;
    isModelDialogOpen.value = true;
  }

  // 打开模型对话框-编辑模型
  function openEditModelDialog(id: string) {
    const modelToEdit = modelConfigs.value.find(model => model.id === id);
    
    if (modelToEdit) {
      Object.assign(editingModel, {
        name: modelToEdit.name,
        model_name: modelToEdit.model_name,
        api_url: modelToEdit.api_url,
        api_key: modelToEdit.api_key || '',
        description: modelToEdit.description,
        prompt_template: modelToEdit.prompt_template,
        temperature: modelToEdit.temperature,
        max_tokens: modelToEdit.max_tokens,
        is_default: modelToEdit.is_default
      });
      
      isEditingModel.value = true;
      editingModelId.value = id;
      isModelDialogOpen.value = true;
    }
  }

  // 关闭模型对话框
  function closeModelDialog() {
    isModelDialogOpen.value = false;
  }

  // 应用提示词模板
  function applyPromptTemplate(query: string): string {
    if (!currentModel.value || !currentModel.value.prompt_template) {
      return query; // 如果没有模板，直接返回查询
    }
    
    // 替换模板中的{{query}}为实际查询
    return currentModel.value.prompt_template.replace('{{query}}', query);
  }

  return {
    modelConfigs,
    currentModelId,
    currentModel,
    isConfigsLoaded,
    isModelDialogOpen,
    isEditingModel,
    editingModel,
    loadModelConfigs,
    saveModelConfig,
    deleteModelConfig,
    setCurrentModel,
    openModelDialog,
    openEditModelDialog,
    closeModelDialog,
    applyPromptTemplate
  };
}); 