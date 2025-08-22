import databaseService from './database';

export type LoadedModel = { 
  apiKey: string; 
  baseURL: string; 
  model: string; 
};

export async function loadModelFromDb(): Promise<LoadedModel> {
  const configs = await databaseService.getModelConfigs();
  const current = configs.find((c) => c.is_default) ?? configs[0];
  if (!current) throw new Error('未找到任何模型配置');

  if (!current.api_key) {
    throw new Error('当前模型未配置 API Key');
  }

  return { 
    apiKey: current.api_key, 
    baseURL: current.api_url, 
    model: current.model_name 
  };
}

