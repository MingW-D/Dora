import Database from '@tauri-apps/plugin-sql';
import { v4 as uuidv4 } from 'uuid';
import type { ModelConfig } from '../stores/modelStore';
import type { PlanStatus, StepStatus } from '../types';

// 数据库模型定义
export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;  // 将包含JSON格式的内容，包括文本、工具调用和结果
  timestamp: number;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
}

// 数据库服务类
class DatabaseService {
  private db: Database | null = null;
  private initialized = false;
  
  // 初始化数据库连接
  async init() {
    if (this.initialized) return;
    
    try {
      this.db = await Database.load('sqlite:chat_history.db');
      this.initialized = true;
      console.log('数据库连接成功');
    } catch (error) {
      console.error('数据库连接失败:', error);
      throw error;
    }
  }
  
  private async ensureConnection() {
    if (!this.initialized) {
      await this.init();
    }
    if (!this.db) throw new Error('数据库未连接');
    return this.db;
  }
  
  // 对话相关方法
  async getConversations(): Promise<Conversation[]> {
    const db = await this.ensureConnection();
    return await db.select<Conversation[]>(
      'SELECT * FROM conversations ORDER BY updated_at DESC'
    );
  }
  
  async getConversation(id: string): Promise<Conversation | null> {
    const db = await this.ensureConnection();
    const result = await db.select<Conversation[]>(
      'SELECT * FROM conversations WHERE id = $1',
      [id]
    );
    return result.length > 0 ? result[0] : null;
  }
  
  async createConversation(conversation: Omit<Conversation, 'created_at' | 'updated_at'>): Promise<string> {
    const db = await this.ensureConnection();
    const now = Date.now();
    await db.execute(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4)',
      [conversation.id, conversation.title, now, now]
    );
    return conversation.id;
  }
  
  async updateConversation(id: string, title: string): Promise<void> {
    const db = await this.ensureConnection();
    const now = Date.now();
    await db.execute(
      'UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3',
      [title, now, id]
    );
  }
  
  async deleteConversation(id: string): Promise<void> {
    const db = await this.ensureConnection();
    await db.execute(
      'DELETE FROM conversations WHERE id = $1',
      [id]
    );
    await db.execute(
      'DELETE FROM messages WHERE conversation_id = $1',
      [id]
    );
  }
  
  async conversationExists(id: string): Promise<boolean> {
    const db = await this.ensureConnection();
    const result = await db.select<{ exists: number }[]>(
      'SELECT COUNT(*) > 0 as exists FROM conversations WHERE id = $1',
      [id]
    );
    return result[0].exists === 1;
  }
  
  // 消息相关方法
  async getMessages(conversationId: string): Promise<Message[]> {
    const db = await this.ensureConnection();
    return await db.select<Message[]>(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp',
      [conversationId]
    );
  }
  
  async addMessage(message: Message): Promise<string> {
    const db = await this.ensureConnection();
    await db.execute(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ($1, $2, $3, $4, $5)',
      [message.id, message.conversation_id, message.role, message.content, message.timestamp]
    );
    return message.id;
  }
  
  async updateMessage(message: Message): Promise<void> {
    const db = await this.ensureConnection();
    await db.execute(
      'UPDATE messages SET content = $1, timestamp = $2 WHERE id = $3',
      [message.content, message.timestamp, message.id]
    );
  }
  
  // 设置相关方法
  async getSetting(key: string): Promise<string | null> {
    const db = await this.ensureConnection();
    const result = await db.select<Setting[]>(
      'SELECT * FROM settings WHERE key = $1',
      [key]
    );
    return result.length > 0 ? result[0].value : null;
  }
  
  async setSetting(key: string, value: string): Promise<void> {
    const db = await this.ensureConnection();
    const id = crypto.randomUUID();
    await db.execute(
      'INSERT INTO settings (id, key, value) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (key) DO UPDATE SET value = $3',
      [id, key, value]
    );
  }

  // 模型配置相关方法
  async getModelConfigs(): Promise<ModelConfig[]> {
    const db = await this.ensureConnection();
    const configs = await db.select<Omit<ModelConfig, 'api_key'>[]>(
      'SELECT * FROM model_configs ORDER BY is_default DESC, name ASC'
    );

    // 处理API密钥和布尔值转换
    const result: ModelConfig[] = [];
    for (const config of configs) {
      const apiKey = await this.getSetting(`api_key_${config.id}`);
      result.push({
        ...config,
        api_key: apiKey || undefined,
        supports_tools: config.supports_tools === 1
      });
    }

    return result;
  }

  async getModelConfig(id: string): Promise<ModelConfig | null> {
    const db = await this.ensureConnection();
    const result = await db.select<Omit<ModelConfig, 'api_key'>[]>(
      'SELECT * FROM model_configs WHERE id = $1',
      [id]
    );
    
    if (result.length === 0) return null;
    
    // API密钥单独从设置表中获取
    const apiKey = await this.getSetting(`api_key_${id}`);
    
    return {
      ...result[0],
      api_key: apiKey || undefined,
      supports_tools: result[0].supports_tools === 1
    };
  }

  async createModelConfig(config: ModelConfig): Promise<string> {
    const db = await this.ensureConnection();
    
    // 如果设置为默认，将其他模型设为非默认
    if (config.is_default) {
      await db.execute(
        'UPDATE model_configs SET is_default = 0'
      );
    }
    
    // 插入新配置，但不包括API密钥
    await db.execute(
      `INSERT INTO model_configs (
        id, name, model_name, api_url, provider, supports_tools, description, prompt_template, 
        temperature, max_tokens, is_default, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        config.id, config.name, config.model_name, config.api_url, config.provider || 'openai',
        config.supports_tools ? 1 : 0, config.description, config.prompt_template,
        config.temperature, config.max_tokens, config.is_default ? 1 : 0,
        config.created_at, config.updated_at
      ]
    );
    
    // API密钥单独存储在设置表中
    if (config.api_key) {
      await this.setSetting(`api_key_${config.id}`, config.api_key);
    }
    
    return config.id;
  }

  async updateModelConfig(config: ModelConfig): Promise<void> {
    const db = await this.ensureConnection();
    
    // 如果设置为默认，将其他模型设为非默认
    if (config.is_default) {
      await db.execute(
        'UPDATE model_configs SET is_default = 0'
      );
    }
    
    // 更新配置，但不包括API密钥
    await db.execute(
      `UPDATE model_configs SET 
        name = $1, model_name = $2, api_url = $3, provider = $4, supports_tools = $5, description = $6,
        prompt_template = $7, temperature = $8, max_tokens = $9,
        is_default = $10, updated_at = $11
      WHERE id = $12`,
      [
        config.name, config.model_name, config.api_url, config.provider || 'openai', 
        config.supports_tools ? 1 : 0, config.description,
        config.prompt_template, config.temperature, config.max_tokens,
        config.is_default ? 1 : 0, config.updated_at, config.id
      ]
    );
    
    // API密钥单独存储在设置表中
    if (config.api_key) {
      await this.setSetting(`api_key_${config.id}`, config.api_key);
    }
  }

  async deleteModelConfig(id: string): Promise<void> {
    const db = await this.ensureConnection();
    
    // 删除模型配置
    await db.execute(
      'DELETE FROM model_configs WHERE id = $1',
      [id]
    );
    
    // 删除相关的API密钥设置
    await db.execute(
      'DELETE FROM settings WHERE key = $1',
      [`api_key_${id}`]
    );
  }

  // 计划状态相关方法
  async savePlanStatus(planStatus: PlanStatus): Promise<void> {
    const db = await this.ensureConnection();
    await db.execute(
      `INSERT OR REPLACE INTO plan_status (
        id, message_id, conversation_id, plan_steps, status, 
        confirmed_at, completed_at, task_id, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        planStatus.id, planStatus.messageId, planStatus.conversationId,
        planStatus.planSteps, planStatus.status, planStatus.confirmedAt,
        planStatus.completedAt, planStatus.taskId, planStatus.error
      ]
    );
  }

  async getPlanStatus(messageId: string): Promise<PlanStatus | null> {
    const db = await this.ensureConnection();
    const result = await db.select<any[]>(
      'SELECT * FROM plan_status WHERE message_id = $1',
      [messageId]
    );
    if (result.length > 0) {
      // **关键修复：手动映射数据库字段名到TypeScript接口**
      const row = result[0];
      return {
        id: row.id,
        messageId: row.message_id, // 数据库字段是message_id，映射到messageId
        conversationId: row.conversation_id, // 数据库字段是conversation_id，映射到conversationId
        planSteps: row.plan_steps, // 数据库字段是plan_steps，映射到planSteps
        status: row.status,
        confirmedAt: row.confirmed_at, // 数据库字段是confirmed_at，映射到confirmedAt
        completedAt: row.completed_at, // 数据库字段是completed_at，映射到completedAt
        taskId: row.task_id, // 数据库字段是task_id，映射到taskId
        error: row.error
      };
    }
    return null;
  }

  async getPlanStatusByConversation(conversationId: string): Promise<PlanStatus[]> {
    const db = await this.ensureConnection();
    const rows = await db.select<any[]>(
      'SELECT * FROM plan_status WHERE conversation_id = $1 ORDER BY confirmed_at DESC',
      [conversationId]
    );
    
    // **关键修复：手动映射数据库字段名到TypeScript接口**
    return rows.map(row => ({
      id: row.id,
      messageId: row.message_id, // 数据库字段是message_id，映射到messageId
      conversationId: row.conversation_id, // 数据库字段是conversation_id，映射到conversationId
      planSteps: row.plan_steps, // 数据库字段是plan_steps，映射到planSteps
      status: row.status,
      confirmedAt: row.confirmed_at, // 数据库字段是confirmed_at，映射到confirmedAt
      completedAt: row.completed_at, // 数据库字段是completed_at，映射到completedAt
      taskId: row.task_id, // 数据库字段是task_id，映射到taskId
      error: row.error
    }));
  }

  // 步骤状态相关方法
  async saveStepStatus(stepStatus: StepStatus): Promise<void> {
    const db = await this.ensureConnection();
    await db.execute(
      `INSERT OR REPLACE INTO step_status (
        id, plan_id, step_id, step_number, description, status,
        result, error, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        stepStatus.id, stepStatus.planId, stepStatus.stepId, stepStatus.stepNumber,
        stepStatus.description, stepStatus.status, 
        stepStatus.result ? JSON.stringify(stepStatus.result) : null,
        stepStatus.error, stepStatus.startedAt, stepStatus.completedAt
      ]
    );
  }

  async getStepStatuses(planId: string): Promise<StepStatus[]> {
    const db = await this.ensureConnection();
    const rows = await db.select<any[]>(
      'SELECT * FROM step_status WHERE plan_id = $1 ORDER BY step_number',
      [planId]
    );
    
    // **关键修复：手动映射数据库字段名到TypeScript接口并解析JSON**
    return rows.map(row => ({
      id: row.id,
      planId: row.plan_id, // 数据库字段是plan_id，映射到planId
      stepId: row.step_id, // 数据库字段是step_id，映射到stepId
      stepNumber: row.step_number, // 数据库字段是step_number，映射到stepNumber
      description: row.description,
      status: row.status,
      result: row.result ? JSON.parse(row.result as string) : undefined,
      error: row.error,
      startedAt: row.started_at, // 数据库字段是started_at，映射到startedAt
      completedAt: row.completed_at // 数据库字段是completed_at，映射到completedAt
    }));
  }

  async updateStepStatus(stepId: string, status: string, result?: any, error?: string): Promise<void> {
    const db = await this.ensureConnection();
    const now = Date.now();
    
    // **关键修复：先检查记录是否存在，如果不存在则无法更新**
    const existingStep = await db.select<{ id: string }[]>(
      'SELECT id FROM step_status WHERE step_id = $1',
      [stepId]
    );
    
    if (existingStep.length === 0) {
      console.warn(`步骤记录不存在，无法更新状态: ${stepId}`);
      return;
    }
    
    if (status === 'completed' || status === 'failed') {
      await db.execute(
        `UPDATE step_status SET 
          status = $1, result = $2, error = $3, completed_at = $4 
        WHERE step_id = $5`,
        [
          status, 
          result ? JSON.stringify(result) : null, 
          error, 
          now, 
          stepId
        ]
      );
    } else if (status === 'running') {
      await db.execute(
        `UPDATE step_status SET 
          status = $1, started_at = $2 
        WHERE step_id = $3`,
        [status, now, stepId]
      );
    } else {
      await db.execute(
        `UPDATE step_status SET status = $1 WHERE step_id = $2`,
        [status, stepId]
      );
    }
    
    console.log(`步骤状态已更新: ${stepId} -> ${status}`);
  }

  // 清理相关方法
  async cleanupOldPlans(daysOld: number = 30): Promise<void> {
    const db = await this.ensureConnection();
    const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    
    // 删除旧的步骤状态
    await db.execute(
      'DELETE FROM step_status WHERE plan_id IN (SELECT id FROM plan_status WHERE confirmed_at < $1)',
      [cutoffTime]
    );
    
    // 删除旧的计划状态
    await db.execute(
      'DELETE FROM plan_status WHERE confirmed_at < $1',
      [cutoffTime]
    );
  }
}

// 默认导出单例
const databaseService = new DatabaseService();
export default databaseService; 