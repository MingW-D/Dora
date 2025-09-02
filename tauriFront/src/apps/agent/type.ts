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

export type MessageType = 
  | 'text'              // 普通文本消息
  | 'subtask_start'     // 子任务开始
  | 'subtask_complete'  // 子任务完成
  | 'subtask_failed'    // 子任务失败
  | 'task_planning'     // 任务规划
  | 'plan_steps'        // 计划步骤
  | 'task_summary'      // 任务总结
  | 'tool_call'         // 工具调用
  | 'validation'        // 验证结果
  | 'final_result';     // 最终结果

export type MessageStream = Message & {
  task: Task | null;
  messageType?: MessageType;
  metadata?: {
    subtaskId?: number;
    subtaskDescription?: string;
    subtaskStatus?: 'pending' | 'running' | 'completed' | 'failed';
    completedSubtasks?: number;
    totalSubtasks?: number;
    validationResult?: boolean;
    isMainTaskComplete?: boolean;
  };
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
