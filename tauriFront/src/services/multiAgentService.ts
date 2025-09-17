
import conversationAgentManager from '../apps/agent/conversation-agent-manager';
import { observableToGenerator } from '../apps/utils/observable-to-generator';
import type { MessageStream } from '../apps/agent/type';
import { removeFilterPatterns } from '../apps/utils/filter-stream';

export interface MultiAgentResponse {
  content: string;
  isComplete: boolean;
  hasError: boolean;
  errorMessage?: string;
}

export class MultiAgentService {
  private activeConversations = new Map<string, AbortController>();

  /**
   * 检测用户输入是否需要多智能体处理
   */
  isComplexTask(userInput: string): boolean {
    const complexTaskKeywords = [
      '帮我', '请帮', '协助', '分析', '研究', '调查', 
      '搜索', '查找', '浏览', '打开', '操作', '执行',
      '任务', '项目', '计划', '方案', '策略', '解决',
      '创建', '生成', '制作', '编写', '开发',
      '自动化', '批量', '处理'
    ];
    
    // 检查是否包含复杂任务关键词
    const hasComplexKeywords = complexTaskKeywords.some(keyword => 
      userInput.toLowerCase().includes(keyword)
    );
    
    // 检查输入长度（较长的输入通常是复杂任务）
    const isLongTask = userInput.length > 50;
    
    // 检查是否包含多个步骤或要求
    const hasMultipleSteps = userInput.includes('然后') || 
      userInput.includes('接着') || 
      userInput.includes('同时') ||
      userInput.includes('并且') ||
      userInput.includes('之后');
    
    return hasComplexKeywords || isLongTask || hasMultipleSteps;
  }

  /**
   * 使用多智能体框架处理任务
   */
  async processWithMultiAgent(
    conversationId: string,
    userTask: string,
    uiMessageId?: string,
    onProgress?: (response: MultiAgentResponse) => void
  ): Promise<MultiAgentResponse> {
    // 如果已有相同会话的任务在运行，先终止它
    if (this.activeConversations.has(conversationId)) {
      this.activeConversations.get(conversationId)?.abort();
    }

    // 创建新的中止控制器
    const abortController = new AbortController();
    this.activeConversations.set(conversationId, abortController);

    try {
      // 获取或创建代理上下文
      const agentContext = await conversationAgentManager.getOrCreateAgentContext(conversationId);
      
      // 启动多智能体处理
      const observer = await agentContext.agent.start({ 
        task: userTask, 
        uiMessageId 
      });
      
      // 转换Observable为Generator以便处理流式输出
      const generator = observableToGenerator(observer, {
        bufferSize: 1,
        processBuffer: (messages: MessageStream[]) => {
          return messages.map((message) => {
            // 这里可以添加内容过滤逻辑
            message.content = removeFilterPatterns(message.content);
            return message;
          });
        },
      });

      let fullResponse = '';
      let hasError = false;
      let errorMessage = '';

      // 处理流式输出
      let isConversationDone = false;
      for await (const message of generator) {
        if (abortController.signal.aborted) {
          break;
        }

        if (message.status === 'FAILED') {
          hasError = true;
          errorMessage = message.content || '任务处理失败';
        }

        // 检查消息类型
        if ((message as any).messageType === 'final_result') {
          isConversationDone = true;
          // 对于最终结果，直接使用内容
          fullResponse = message.content || '';
        } else if ((message as any).messageType === 'subtask_start' || 
                   (message as any).messageType === 'subtask_complete' ||
                   (message as any).messageType === 'subtask_failed') {
          // 对于子任务状态消息，构建内容块
          fullResponse = JSON.stringify({
            type: 'subtask_status',
            content: {
              subtaskId: (message as any).metadata?.subtaskId,
              subtaskDescription: (message as any).metadata?.subtaskDescription,
              status: (message as any).metadata?.subtaskStatus,
              completedSubtasks: (message as any).metadata?.completedSubtasks,
              totalSubtasks: (message as any).metadata?.totalSubtasks,
              validationResult: (message as any).metadata?.validationResult
            },
            timestamp: Date.now()
          });
        } else {
          fullResponse = message.content || '';
        }
        
        // 调用进度回调
        if (onProgress) {
          onProgress({
            content: fullResponse,
            isComplete: isConversationDone,
            hasError,
            errorMessage
          });
        }
      }

      // 清理活跃会话记录
      this.activeConversations.delete(conversationId);

      return {
        content: fullResponse,
        isComplete: true,
        hasError,
        errorMessage
      };

    } catch (error: any) {
      this.activeConversations.delete(conversationId);
      
      if (error.name === 'AbortError') {
        return {
          content: '',
          isComplete: true,
          hasError: true,
          errorMessage: '任务已被取消'
        };
      }

      console.error('多智能体处理失败:', error);
      return {
        content: '',
        isComplete: true,
        hasError: true,
        errorMessage: error.message || '多智能体处理失败'
      };
    }
  }

  /**
   * 取消指定会话的多智能体任务
   */
  cancelTask(conversationId: string): void {
    // 1) 先中止当前流式订阅，停止前端继续消费
    const controller = this.activeConversations.get(conversationId);
    if (controller) {
      controller.abort();
      this.activeConversations.delete(conversationId);
    }

    // 2) 彻底停止后端多智能体任务：移除该会话的 Agent 上下文
    //    这会触发该上下文内部的 abortSignal，使所有正在执行的工具/步骤收到取消并尽快结束
    try {
      conversationAgentManager.removeAgentContext(conversationId);
    } catch (e) {
      console.error('移除会话上下文失败:', e);
    }
  }

  /**
   * 清理所有活跃任务
   */
  cleanup(): void {
    for (const controller of this.activeConversations.values()) {
      controller.abort();
    }
    this.activeConversations.clear();
  }
}

// 导出单例
export const multiAgentService = new MultiAgentService();