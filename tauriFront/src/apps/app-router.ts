// 兼容层：提供与原 electron 版本一致的 caller 接口
import databaseService from '../services/database';

export const caller = {
  task: {
    async createTask(params: { type: string; description: string; payload: string }) {
      // 在 Tauri 前端侧将 task 作为消息内容（或使用你已有的计划表结构）
      // 这里返回一个最小结构用于满足上层类型
      return { id: crypto.randomUUID(), ...params } as any;
    },
    async updateTask(params: { id: string; payload: string }) {
      return params as any;
    },
  },
  message: {
    async addMessage(params: {
      conversationId: string;
      content: string;
      type: string;
      role: string;
      status: string;
      roleName: string;
      taskId?: string;
      existingId?: string; // 新增：如果提供了现有ID，则不创建新记录
    }) {
      console.log(`[app-router] addMessage called with existingId: ${params.existingId}, roleName: ${params.roleName}`);
      let id: string;
      
      if (params.existingId) {
        // 如果提供了现有消息ID，直接使用，不创建新的数据库记录
        id = params.existingId;
        console.log(`[app-router] Using existing message ID: ${id}, NO database insertion`);
      } else {
        // 否则创建新的数据库记录
        id = crypto.randomUUID();
        console.log(`[app-router] Creating NEW database record with ID: ${id}`);
        await databaseService.addMessage({
          id,
          conversation_id: params.conversationId,
          role: params.role.toLowerCase() === 'user' ? 'user' : 'assistant',
          content: '',
          timestamp: Date.now(),
        } as any);
        console.log(`[app-router] Database record created successfully`);
      }

      // 返回给上层一个轻量对象，status 仅用于流程控制，DB 不存
      return {
        id,
        conversationId: params.conversationId,
        content: '',
        role: params.role.toUpperCase() === 'USER' ? 'USER' : 'ASSISTANT',
        status: 'PENDING',
        task: null,
      } as any;
    },
    async updateMessage(params: { id: string; content: string; status: string }) {
      // 更新数据库中的消息内容（databaseService.updateMessage 只使用 id/content/timestamp）
      await databaseService.updateMessage({
        id: params.id,
        conversation_id: '',
        role: 'assistant',
        content: params.content,
        timestamp: Date.now(),
      } as any);
      return params as any;
    },
    async getIdleMessage(_: { conversationId: string }) {
      // 约定：最新一条 role=assistant 且内容为空的消息为“空闲消息（IDLE）”
      const msgs = await databaseService.getMessages(_.conversationId);
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === 'assistant' && (!m.content || m.content.trim() === '')) {
          return {
            id: m.id,
            conversationId: m.conversation_id,
            content: m.content,
            role: 'ASSISTANT',
            status: 'IDLE',
            task: null,
          } as any;
        }
      }
      return null as any;
    },
  },
};

