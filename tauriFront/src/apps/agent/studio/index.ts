import type { BrowserUseLike } from '../../tauri-adapters/browser-use';
// 本地定义 StudioAction，避免外部依赖
export type StudioAction = {
  type: 'openUrl' | 'searchResults' | 'editor' | 'openFolder' | 'openFile' | string;
  description: string;
  payload: any;
};
import { type ReplaySubject, lastValueFrom } from 'rxjs';
import { caller } from '../../app-router';
import type { ChatCompletion } from '../../model/chat-completion.js';
import { TauriWindowManager } from '../../tauri-adapters/window-manager';
import type { MessageStream } from '../type.js';
import { isExternalWebUrl } from '../../../utils/urlGuards';

export class Studio {
  constructor(
    public browserUse: BrowserUseLike,
    public conversationId: string,
  ) {}

  async start(
    action: StudioAction,
    observer: ReplaySubject<MessageStream>,
    _abortSignal: AbortSignal,
  ) {
    await TauriWindowManager.getInstance().initialize();

    const payload = JSON.stringify(action.payload);
    this.preview(action);

    const task = await caller.task.createTask({
      type: action.type,
      description: action.description,
      payload,
    });

    const message = await caller.message.addMessage({
      conversationId: this.conversationId,
      content: '',
      type: 'TASK',
      role: 'ASSISTANT',
      status: 'COMPLETED',
      roleName: 'Tool',
      taskId: task.id,
    });

    observer.next(message);
  }

  async startWithStream(
    action: StudioAction,
    chatCompletion: ChatCompletion,
    observer: ReplaySubject<MessageStream>,
  ) {
    await TauriWindowManager.getInstance().initialize();

    const task = await caller.task.createTask({
      type: action.type,
      description: action.description,
      payload: '',
    });

    const message = await caller.message.addMessage({
      conversationId: this.conversationId,
      content: '',
      type: 'TASK',
      role: 'ASSISTANT',
      status: 'PENDING',
      roleName: 'Tool',
      taskId: task.id,
    });

    // Use incrementalContentStream to avoid sending duplicate content
    let accumulatedContent = '';
    chatCompletion.incrementalContentStream.subscribe({
      next: (chunk) => {
        if (message.task) {
          accumulatedContent += chunk;
          message.task.payload = accumulatedContent;
          TauriWindowManager.getInstance().sendMessage('studio', {
            type: action.type,
            description: action.description,
            payload: message.task.payload,
          });
        }
        observer.next(message);
      },
      async complete() {
        if (message.task) {
          await caller.task.updateTask({
            id: message.task.id,
            payload: message.task.payload,
          });
        }
        await caller.message.updateMessage({
          id: message.id,
          content: '',
          status: 'COMPLETED',
        });
        observer.next(message);
      },
    });

    await lastValueFrom(chatCompletion.completed);
  }

  async preview(action: StudioAction) {
    // Tauri 下无需直接访问 webContents
    this.browserUse.webContentsView.setVisible(false);

    switch (action.type) {
      case 'openUrl': {
        const url = action?.payload?.url;
        if (isExternalWebUrl(url)) {
          this.browserUse.webContentsView.setVisible(true);
          await this.browserUse.loadWebPage(url);
        } else {
          this.browserUse.webContentsView.setVisible(false);
          await TauriWindowManager.getInstance().sendMessage('studio', {
            type: 'editor',
            description: 'Blocked internal app URL',
            payload: `Blocked opening app URL in Studio: ${url}`,
          });
        }
        break;
      }
      case 'searchResults':
      case 'editor':
      case 'openFolder':
      case 'openFile':
        await TauriWindowManager.getInstance().sendMessage('studio', action);
        break;
    }
  }
}
