import type { Message, MessageStatus, Task } from '../agent/type';
import { caller } from '../app-router';
import { removeFilterPatterns } from './filter-stream.js';

// 本地定义消息类型，避免引入 Prisma
type MessageType = 'TEXT' | 'TASK' | 'TOOL' | 'PLAN';

// 消息处理器类
export class MessageHandler {
  private sharedMessageId: string | null = null; // 共享的assistant消息ID
  private contentBlocks: Array<{type: string, content: any, timestamp: number}> = []; // 内容块列表

  constructor(private readonly conversationId: string, private readonly existingMessageId?: string) {
    console.log(`[MessageHandler] Constructor - conversationId: ${conversationId}, existingMessageId: ${existingMessageId}`);
    // 如果提供了现有消息ID，直接使用它
    if (existingMessageId) {
      this.sharedMessageId = existingMessageId;
      this.contentBlocks = [];
      console.log(`[MessageHandler] Using existing message ID: ${existingMessageId}`);
    } else {
      console.log(`[MessageHandler] No existing message ID provided, will create new message when needed`);
    }
  }

  // 获取或创建共享的assistant消息
  async getOrCreateSharedMessage(): Promise<{ id: string; conversationId: string; content: string; role: string; status: string; task: any }> {
    console.log(`[MessageHandler] getOrCreateSharedMessage - sharedMessageId: ${this.sharedMessageId}, existingMessageId: ${this.existingMessageId}`);
    
    if (!this.sharedMessageId) {
      // 如果构造时提供了现有消息ID，就不创建新消息
      if (this.existingMessageId) {
        console.log(`[MessageHandler] Using existing message ID from constructor: ${this.existingMessageId}`);
        this.sharedMessageId = this.existingMessageId;
        this.contentBlocks = [];
        return {
          id: this.sharedMessageId,
          conversationId: this.conversationId,
          content: JSON.stringify(this.contentBlocks),
          role: 'ASSISTANT',
          status: 'PENDING',
          task: null,
        } as any;
      } else {
        // 只有在没有提供现有消息ID时才创建新消息
        console.log(`[MessageHandler] Creating NEW database message via caller.message.addMessage`);
        const message = await caller.message.addMessage({
          conversationId: this.conversationId,
          content: '[]', // 初始化为空的内容块数组
          type: 'TEXT',
          role: 'ASSISTANT',
          status: 'PENDING',
          roleName: 'Multi-Agent System',
          // 不传递existingId，因为这个分支就是要创建新消息
        });
        this.sharedMessageId = message.id;
        this.contentBlocks = [];
        console.log(`[MessageHandler] Created new message with ID: ${message.id}`);
        return message;
      }
    } else {
      // 返回已存在的共享消息
      console.log(`[MessageHandler] Returning existing shared message: ${this.sharedMessageId}`);
      return {
        id: this.sharedMessageId,
        conversationId: this.conversationId,
        content: JSON.stringify(this.contentBlocks),
        role: 'ASSISTANT',
        status: 'PENDING',
        task: null,
      } as any;
    }
  }

  // 向共享消息添加内容块，而不是创建新消息
  async addContentBlock(type: string, content: any, roleName: string): Promise<Message> {
    const sharedMessage = await this.getOrCreateSharedMessage();
    
    // 添加新的内容块
    const newBlock = {
      type,
      content,
      timestamp: Date.now(),
      roleName, // 添加角色名称以便前端识别
    };
    
    this.contentBlocks.push(newBlock);
    
    // 返回一个虚拟消息对象，包含当前内容块
    return {
      id: sharedMessage.id,
      conversationId: this.conversationId,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      role: 'ASSISTANT' as const,
      status: 'PENDING' as const,
      task: null,
    } as any;
  }

  async createMessage(roleName: string, taskId?: string, type: MessageType = 'TEXT') {
    // 使用内容块聚合方式，而不是创建新消息
    const message = await this.addContentBlock(type.toLowerCase(), '', roleName);
    return message;
  }

  async createTask(task: Pick<Task, 'type' | 'description' | 'payload'>) {
    return await caller.task.createTask({
      type: task.type,
      description: task.description,
      payload: task.payload,
    });
  }

  async completeTask(task: Task) {
    await caller.task.updateTask({
      id: task.id,
      payload: task.payload,
    });
  }

  async completeMessage(message: Message, status: MessageStatus = 'COMPLETED') {
    // 如果是共享消息，更新整个内容块列表
    if (message.id === this.sharedMessageId) {
      await caller.message.updateMessage({
        id: message.id,
        content: JSON.stringify(this.contentBlocks),
        status,
      });
    } else {
      // 兼容旧的单独消息处理
      await caller.message.updateMessage({
        id: message.id,
        content: removeFilterPatterns(message.content),
        status,
      });
    }
  }

  // 更新共享消息中特定内容块的内容
  async updateContentBlock(messageId: string, content: any): Promise<void> {
    if (messageId === this.sharedMessageId && this.contentBlocks.length > 0) {
      // 更新最后一个内容块的内容
      const lastBlock = this.contentBlocks[this.contentBlocks.length - 1];
      lastBlock.content = content;
      
      // 不立即更新数据库，等待complete时统一更新
    }
  }

  // 获取当前的聚合内容（以JSON格式）
  getAggregatedContent(): string {
    return JSON.stringify(this.contentBlocks);
  }

  async getIdleMessage() {
    return await caller.message.getIdleMessage({
      conversationId: this.conversationId,
    });
  }

  async updateMessageStatus(id: string, status: MessageStatus, content: string) {
    await caller.message.updateMessage({
      id,
      status,
      content,
    });
  }
}
