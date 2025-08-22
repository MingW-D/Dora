import { v4 as uuidv4 } from 'uuid';
import databaseService from './database';
import type { Message, MessageStatus, Task } from '../agents/types';

export class MessageHandler {
  constructor(private readonly conversationId: string) {}

  async createMessage(roleName: string, taskId?: string, type: 'TEXT' = 'TEXT') {
    const message: Message = {
      id: uuidv4(),
      conversationId: this.conversationId,
      content: '',
      role: 'ASSISTANT',
      status: 'PENDING',
      roleName,
      task: undefined,
    } as any;

    await databaseService.addMessage({
      id: message.id,
      conversation_id: message.conversationId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    // 若有 taskId，将计划状态与消息建立关联
    if (taskId) {
      await databaseService.savePlanStatus({
        id: taskId,
        messageId: message.id,
        conversationId: this.conversationId,
        planSteps: '',
        status: 'pending',
      } as any);
    }

    return { ...message, task: null } as any;
  }

  async createTask(task: Pick<Task, 'type' | 'description' | 'payload'>) {
    const taskId = uuidv4();
    // 初始化计划状态（messageId 暂为空，待 createMessage 时回填）
    await databaseService.savePlanStatus({
      id: taskId,
      messageId: '',
      conversationId: this.conversationId,
      planSteps: task.payload ?? '',
      status: 'pending',
    } as any);
    return { id: taskId, ...task } as Task;
  }

  async completeTask(task: Task) {
    // 将最终的任务结果写入计划状态
    await databaseService.savePlanStatus({
      id: task.id,
      messageId: '', // 保持原值（INSERT OR REPLACE 会覆盖），由前次保存维持
      conversationId: this.conversationId,
      planSteps: task.payload ?? '',
      status: 'completed',
      completedAt: Date.now(),
    } as any);
  }

  async completeMessage(message: Message, status: MessageStatus = 'COMPLETED') {
    await databaseService.updateMessage({
      id: message.id,
      conversation_id: message.conversationId,
      role: 'assistant',
      content: message.content,
      timestamp: Date.now(),
    });
  }

  async getIdleMessage() {
    const msgs = await databaseService.getMessages(this.conversationId);
    return msgs.length > 0 ? msgs[msgs.length - 1] : null;
  }

  async updateMessageStatus(id: string, status: MessageStatus, content: string) {
    await databaseService.updateMessage({
      id,
      conversation_id: this.conversationId,
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
  }
}

