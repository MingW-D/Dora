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
import { useModelStore } from '../../stores/modelStore';

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
      const modelStore = useModelStore();
      const currentModelId = modelStore.currentModelId;
      
      await loadSdkAndModel(currentModelId);

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

  async start(taskOrOptions?: string | { task: string; uiMessageId?: string; subtaskId?: number }) {
    await this.validateInitialization();

    // 解析参数：既兼容旧的字符串，也支持对象携带 uiMessageId 和 subtaskId
    const taskOverride =
      typeof taskOrOptions === 'string' ? taskOrOptions : taskOrOptions?.task;
    const uiMessageId =
      typeof taskOrOptions === 'object' ? taskOrOptions?.uiMessageId : undefined;
    const subtaskId =
      typeof taskOrOptions === 'object' ? taskOrOptions?.subtaskId : undefined;

      console.log('taskOverride', taskOverride);
    // 优先使用显式传入的任务（来自前端用户输入）
    if (taskOverride && taskOverride.trim()) {
      this.resetObserver();
      const agentTaskRef = this.createAgentTaskRef(uiMessageId, subtaskId);
      this.coordinateRolePlay
        .play(taskOverride, agentTaskRef)
        .then(() => this.observer.complete())
        .catch((error) => this.observer.error(error));
      return this.observer.asObservable();
    }

    // 否则回退到读取"空闲消息"
    const message = await this.messageHandler.getIdleMessage();
    if (!message || message.status !== 'IDLE') {
      return this.observer.asObservable();
    }

    await this.messageHandler.updateMessageStatus(message.id, 'PENDING', message.content);

    this.resetObserver();

    const agentTaskRef = this.createAgentTaskRef(undefined, subtaskId);
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

  private createAgentTaskRef(uiMessageId?: string, subtaskId?: number): AgentTaskRef {
    if (!this.studio) {
      throw new Error('Studio not initialized');
    }
    
    // 创建 taskRef 对象，稍后会填充方法
    const taskRef: AgentTaskRef = {
      conversationId: this.conversationId,
      uiMessageId,
      abortSignal: this.abortSignal,
      observer: this.observer,
      subtaskId,
      createTaskMessage: undefined as any,
      completeTaskMessage: undefined as any,
      createMessage: undefined as any,
      completeMessage: undefined as any,
      studio: this.studio,
    };

    // 现在定义方法，这样它们可以访问到 taskRef 对象
    taskRef.createTaskMessage = async (task) => {
      const taskModel = await this.messageHandler.createTask(task);
      // 添加任务类型的内容块到共享消息
      const message = await this.messageHandler.addContentBlock('task', {
        taskId: taskModel.id,
        type: task.type,
        description: task.description,
        payload: task.payload
      }, 'Task Manager');
      
      return message;
    };

    taskRef.completeTaskMessage = async (task) => {
      await this.messageHandler.completeTask(task);
    };

    taskRef.createMessage = async (roleName: string, taskId?: string) => {
      const message = await this.messageHandler.addContentBlock('text', '', roleName);
      
      return message;
    };

    taskRef.completeMessage = async (message, status = 'COMPLETED' as MessageStatus) => {
      // 更新当前内容块
      if (message.content) {
        await this.messageHandler.updateContentBlock(message.id, message.content);
      }
      // 当所有agent完成时才真正完成共享消息
      return this.messageHandler.completeMessage(message, status);
    };

    return taskRef;
  }

  private async validateInitialization() {
    if (!this.browserUse) {
      await this.init();
      return;
    }
  }
}
