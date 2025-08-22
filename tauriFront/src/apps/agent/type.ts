// 解除对 Prisma 的依赖，定义最小化协议类型
export type MessageStatus = 'PENDING' | 'COMPLETED' | 'IDLE' | 'FAILED';

export type Task = {
  id: string;
  type: string;
  description: string;
  payload: string;
};

export type Message = {
  id: string;
  conversationId: string;
  content: string;
  role: 'ASSISTANT' | 'USER';
  status: MessageStatus;
  task: Task | null;
};
import type { ReplaySubject } from 'rxjs';
import type { Studio } from './studio';

export type MessageStream = Message & {
  task: Task | null;
};

export type AgentTaskRef = {
  conversationId: string;
  uiMessageId?: string;
  abortSignal: AbortSignal;
  studio: Studio;
  observer: ReplaySubject<MessageStream>;
  createTaskMessage: (
    task: Pick<Task, 'type' | 'description' | 'payload'>,
  ) => Promise<MessageStream>;
  completeTaskMessage: (task: Task) => Promise<void>;
  createMessage: (roleName: string, taskId?: string) => Promise<MessageStream>;
  completeMessage: (message: MessageStream, status?: MessageStatus) => Promise<void>;
};
