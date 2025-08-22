import OpenAI from 'openai';
import databaseService from '../../services/database';

export type ModelType = 'TEXT' | 'LONG_TEXT' | 'IMAGE_TO_TEXT';

type OpenAIClient = InstanceType<typeof OpenAI>;

export const loadSdkAndModel = async (): Promise<Record<ModelType, { sdk: OpenAIClient; model: string }>> => {
  // 读取数据库中的默认模型配置，若无则回退到环境变量
  const configs = await databaseService.getModelConfigs();

  let apiKey = '';
  let baseURL = 'https://api.openai.com/v1';
  let modelName = 'gpt-4o-mini';

  if (configs && configs.length > 0) {
    const cfg = configs.find(c => c.is_default) ?? configs[0];
    apiKey = cfg.api_key || (globalThis as any).TAURI_OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || '';
    baseURL = cfg.api_url || (globalThis as any).TAURI_OPENAI_BASE_URL || import.meta.env.VITE_OPENAI_BASE_URL || baseURL;
    modelName = cfg.model_name || (globalThis as any).TAURI_OPENAI_MODEL || import.meta.env.VITE_OPENAI_MODEL || modelName;
  } else {
    apiKey = (globalThis as any).TAURI_OPENAI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || '';
    baseURL = (globalThis as any).TAURI_OPENAI_BASE_URL || import.meta.env.VITE_OPENAI_BASE_URL || baseURL;
    modelName = (globalThis as any).TAURI_OPENAI_MODEL || import.meta.env.VITE_OPENAI_MODEL || modelName;
  }

  const sdk = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });

  return {
    TEXT: { sdk, model: modelName },
    LONG_TEXT: { sdk, model: modelName },
    IMAGE_TO_TEXT: { sdk, model: modelName },
  };
};
