import OpenAI from 'openai';
import databaseService from '../../services/database';

export type ModelType = 'TEXT' | 'LONG_TEXT' | 'IMAGE_TO_TEXT';

type OpenAIClient = InstanceType<typeof OpenAI>;

export const loadSdkAndModel = async (currentModelId?: string): Promise<Record<ModelType, { sdk: OpenAIClient; model: string; provider: string }>> => {
  // 读取数据库中的模型配置
  const configs = await databaseService.getModelConfigs();

  let apiKey = '';
  let baseURL = 'https://api.openai.com/v1';
  let modelName = 'gpt-4o-mini';
  let provider = 'openai';

  if (configs && configs.length > 0) {
    // 优先使用当前选中的模型，否则使用默认模型
    let cfg = configs.find(c => c.id === currentModelId);
    if (!cfg) {
      cfg = configs.find(c => c.is_default) ?? configs[0];
    }
    
    apiKey = cfg.api_key || (globalThis as any).TAURI_OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || '';
    baseURL = cfg.api_url || (globalThis as any).TAURI_OPENAI_BASE_URL || import.meta.env.VITE_OPENAI_BASE_URL || baseURL;
    modelName = cfg.model_name || (globalThis as any).TAURI_OPENAI_MODEL || import.meta.env.VITE_OPENAI_MODEL || modelName;
    provider = cfg.provider || 'openai';

    // 对于 ollama，设置默认的 base URL
    if (provider === 'ollama' && !cfg.api_url) {
      baseURL = 'http://localhost:11434/v1';
    }
  } else {
    apiKey = (globalThis as any).TAURI_OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || '';
    baseURL = (globalThis as any).TAURI_OPENAI_BASE_URL || import.meta.env.VITE_OPENAI_BASE_URL || baseURL;
    modelName = (globalThis as any).TAURI_OPENAI_MODEL || import.meta.env.VITE_OPENAI_MODEL || modelName;
  }

  // 对于 ollama，API key 不是必需的，可以设置为空字符串或任意值
  if (provider === 'ollama' && !apiKey) {
    apiKey = 'ollama';
  }

  const sdk = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });

  return {
    TEXT: { sdk, model: modelName, provider },
    LONG_TEXT: { sdk, model: modelName, provider },
    IMAGE_TO_TEXT: { sdk, model: modelName, provider },
  };
};
