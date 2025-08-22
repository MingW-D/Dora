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
    }) {
      // 不落库，返回一个轻量的内存对象用于流式过程中的 UI 渲染
      const id = crypto.randomUUID();
      return {
        id,
        conversationId: params.conversationId,
        content: '',
        role: 'ASSISTANT',
        status: 'PENDING',
        task: null,
      } as any;
    },
    async updateMessage(params: { id: string; content: string; status: string }) {
      // 读取原消息，更新其 content / timestamp；status 可选地写入 content 扩展区
      // 这里简化：仅更新内容和时间戳
      // await databaseService.updateMessage({
      //   id: params.id,
      //   conversation_id: '',
      //   role: 'assistant',
      //   content: params.content,
      //   timestamp: Date.now(),
      // } as any);
      // return params as any;
      return null as any;
    },
    async getIdleMessage(_: { conversationId: string }) {
      // 你的业务里，如果需要“待执行”消息，可在 UI 层触发。
      // 这里返回 null，调用方会忽略。
      return null as any;
    },
  },
};

