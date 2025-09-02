import { TauriBrowserUse } from '../tauri-adapters/browser-use';
import type { MessageStatus } from './type';
import { ReplaySubject } from 'rxjs';
import type { Observable } from 'rxjs';
import { loadSdkAndModel } from '../ai-sdk/index.js';
import { MessageHandler } from '../utils/agent-message-handler.js';
import { TauriWindowManager } from '../tauri-adapters/window-manager';
import { CoordinateRolePlayAgent } from './coordinate-role-play.js';
import { Studio } from './studio/index.js';
import type { AgentTaskRef, MessageStream } from './type.js';

export class ConversionActorAgent {
  private readonly abortSignal: AbortSignal;

  private browserUse: TauriBrowserUse | null = null;
  private studio: Studio | null = null;
  private coordinateRolePlay: CoordinateRolePlayAgent = new CoordinateRolePlayAgent();
  private observer: ReplaySubject<MessageStream>;

  private messageHandler: MessageHandler;

  constructor(
    private conversationId: string,
    abortSignal: AbortSignal,
    private existingMessageId?: string, // 前端创建的assistant消息ID
    observer = new ReplaySubject<MessageStream>(),
  ) {
    this.abortSignal = abortSignal;
    this.observer = observer;

    // 初始化辅助类，传递现有消息ID
    this.messageHandler = new MessageHandler(conversationId, existingMessageId);
  }

  async init(): Promise<void> {
    await TauriWindowManager.getInstance().initialize();

    if (this.browserUse) return;

    try {
      await loadSdkAndModel();

      // Tauri 适配的 BrowserUse（简化占位实现，负责协议对齐与事件桥接）
      this.browserUse = new TauriBrowserUse();

      this.studio = new Studio(this.browserUse, this.conversationId, this.messageHandler);

      console.log('init success');
    } catch (error) {
      this.destroy();
      throw new Error(
        `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.complete();
      this.observer.unsubscribe();
      this.observer = new ReplaySubject<MessageStream>();
    }

    this.browserUse = null;
    this.studio = null;
  }

  getObserver(): Observable<MessageStream> {
    return this.observer.asObservable();
  }

  getStudio(): Studio | null {
    return this.studio;
  }

  async start(taskOrOptions?: string | { task: string; uiMessageId?: string }) {
    await this.validateInitialization();

    // 解析参数：既兼容旧的字符串，也支持对象携带 uiMessageId
    const taskOverride =
      typeof taskOrOptions === 'string' ? taskOrOptions : taskOrOptions?.task;
    const uiMessageId =
      typeof taskOrOptions === 'object' ? taskOrOptions?.uiMessageId : undefined;

    // 优先使用显式传入的任务（来自前端用户输入）
    if (taskOverride && taskOverride.trim()) {
      this.resetObserver();
      const agentTaskRef = this.createAgentTaskRef(uiMessageId);
      this.coordinateRolePlay
        .play(taskOverride, agentTaskRef)
        .then(() => this.observer.complete())
        .catch((error) => this.observer.error(error));
      return this.observer.asObservable();
    }

    // 否则回退到读取“空闲消息”
    const message = await this.messageHandler.getIdleMessage();
    if (!message || message.status !== 'IDLE') {
      return this.observer.asObservable();
    }

    await this.messageHandler.updateMessageStatus(message.id, 'PENDING', message.content);

    this.resetObserver();

    const agentTaskRef = this.createAgentTaskRef();
    const task = message.content;

    this.coordinateRolePlay
      .play(task, agentTaskRef)
      .then(() => this.observer.complete())
      .catch((error) => this.observer.error(error));

    return this.observer.asObservable();
  }

  private resetObserver() {
    if (this.observer) {
      this.observer.complete();
      this.observer.unsubscribe();
    }
    this.observer = new ReplaySubject<MessageStream>();
  }

  private createAgentTaskRef(uiMessageId?: string): AgentTaskRef {
    if (!this.studio) {
      throw new Error('Studio not initialized');
    }
    return {
      conversationId: this.conversationId,
      uiMessageId,
      abortSignal: this.abortSignal,
      observer: this.observer,
      createTaskMessage: async (task) => {
        const taskModel = await this.messageHandler.createTask(task);
        // 添加任务类型的内容块到共享消息
        return await this.messageHandler.addContentBlock('task', {
          taskId: taskModel.id,
          type: task.type,
          description: task.description,
          payload: task.payload
        }, 'Task Manager');
      },
      completeTaskMessage: async (task) => {
        await this.messageHandler.completeTask(task);
      },
      createMessage: (roleName: string, taskId?: string) =>
        this.messageHandler.addContentBlock('text', '', roleName),
      completeMessage: async (message, status = 'COMPLETED' as MessageStatus) => {
        // 更新当前内容块
        if (message.content) {
          await this.messageHandler.updateContentBlock(message.id, message.content);
        }
        // 当所有agent完成时才真正完成共享消息
        return this.messageHandler.completeMessage(message, status);
      },
      studio: this.studio,
    };
  }

  private async validateInitialization() {
    if (!this.browserUse) {
      await this.init();
      return;
    }
  }
}
