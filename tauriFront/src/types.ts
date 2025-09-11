// URL轮播组件中使用的URL类型
export interface UrlItem {
  url: string;
  title?: string;
  description?: string;
}

// 搜索进度信息
export interface SearchProgress {
  started: boolean;
  completed: boolean;
  total: number;
}

// 消息内容块类型
export interface MessageContentBlock {
  type: 'text' | 'tool_call' | 'url_links' | 'plan_steps' | 'step_result' | 'tool_message' | 'task' | 'subtask_status' | 'final_result' | 'html_report' | 'htmlReport' | 'user_agent' | 'assistant_agent';
  content: string | string[] | StepResult | ToolMessage | TaskBlockContent | SubtaskStatus | FinalResult;
  timestamp?: number;
  id?: string;
}

// 子任务状态类型
export interface SubtaskStatus {
  subtaskId: number;
  subtaskDescription: string;
  status: 'running' | 'completed' | 'failed';
  completedSubtasks: number;
  totalSubtasks: number;
  validationResult?: boolean;
}

// 最终结果类型
export interface FinalResult {
  content: string;
  completedSubtasks: number;
  totalSubtasks: number;
  isMainTaskComplete: boolean;
}

// 工具调用消息类型
export interface ToolMessage {
  toolName: string;
  agentId: string;
  status: 'started' | 'completed' | 'failed';
  parameters?: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: number;
}

// 计划步骤相关类型
export interface PlanStepData {
  messageId: string;
  conversationId: string;
  planSteps: string; // 显示用的文本格式
  status?: 'pending' | 'confirmed' | 'regenerating' | 'editing';
  // **新增：完整的计划结构数据**
  fullPlanData?: {
    task_id: string;
    steps: Array<{
      step_id: string;
      description: string;
      executor: string;
      dependencies: string[];
      is_parallel: boolean;
      parameters: Record<string, any>;
      status: string;
      result?: any;
      error?: any;
    }>;
    total_steps: number;
    created_at: number;
    updated_at?: number;
    plan_id: string;
    task_description: string;
  };
}

export interface PlanStepAction {
  messageId: string;
  conversationId: string;
  planSteps?: string;
  editedPlanSteps?: string;
}

// 步骤结果相关类型
export interface StepResult {
  stepId: string;
  stepNumber?: number;
  stepDescription: string;
  status: 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  timestamp: number;
  isCollapsed?: boolean;
}

// 步骤结果管理器接口
export interface StepResultManager {
  messageId: string;
  stepResults: Map<string, StepResult>;
  lastTransmittedHashes: Set<string>;
}

// 计划状态接口
export interface PlanStatus {
  id: string;
  messageId: string;
  conversationId: string;
  planSteps: string;
  status: 'pending' | 'confirmed' | 'executing' | 'completed' | 'failed';
  confirmedAt?: number;
  completedAt?: number;
  taskId?: string;
  error?: string;
}

// 步骤状态接口  
export interface StepStatus {
  id: string;
  planId: string;
  stepId: string;
  stepNumber: number;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

// 类型声明辅助函数，解决any类型问题
export function typedFind<T>(
  array: T[],
  predicate: (item: T) => boolean
): T | undefined {
  return array.find(predicate);
}

// 任务内容块类型（用于 UI 展示与预览触发）
export interface TaskBlockContent {
  id?: string;
  type?: string;           // StudioActionType
  description?: string;
  payload?: any;
}