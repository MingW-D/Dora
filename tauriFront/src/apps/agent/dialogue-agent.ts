import { lastValueFrom, defaultIfEmpty } from 'rxjs';
import {
  addAuxiliaryInformationPrompt,
  assistantPrompt,
  startRunnerPrompt,
  toFinalAnswerPrompt,
  toNextInstructionPrompt,
  userPrompt,
} from '../prompt/index.js';
import type { SpecializedToolAgent } from '../toolkits/types.js';
import { BaseAgent } from './base-agent.js';
import { tools } from './tools.js';
import type { AgentTaskRef } from './type.js';

type Parameters = {
  question: string;
  expected_result: string;
  context?: string;
};

export class DialogueAgent extends BaseAgent implements SpecializedToolAgent {
  override readonly name = 'dialogue-assistant';
  readonly description = 'A dialogue assistant that can help you with your questions.';
  readonly parameters = {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the assistant.' },
      expected_result: {
        type: 'string',
        description: 'The expected result of the question.',
      },
      context: {
        type: 'string',
        description: 'The context of the question.',
      },
    },
    required: ['question', 'expected_result'],
  };

  readonly strict = true;

  private userAgent = new BaseAgent({
    temperature: 0.3,
  });

  private assistantAgent = new BaseAgent({
    temperature: 0,
    tools,
  });

  static readonly MAX_ITERATIONS = 30;

  constructor() {
    super({
      temperature: 0,
      tools: [],
    });
  }

  async execute(query: Parameters, taskRef: AgentTaskRef): Promise<string> {
    this.assistantAgent.initialSystemMessage(
      assistantPrompt(query.question, query.expected_result, query.context),
    );

    this.userAgent.initialSystemMessage(
      userPrompt(
        query.question,
        tools.map((tool) => `${tool.name}: ${tool.description}`),
        query.context,
      ),
    );

    if (taskRef.abortSignal.aborted) {
      return 'The task has been aborted.';
    }

    let initialMessage = startRunnerPrompt();
    for (let index = 0; index < DialogueAgent.MAX_ITERATIONS; index++) {
      if (taskRef.abortSignal.aborted) {
        return 'The task has been aborted.';
      }
      const discussionResult = await this.discussTask(initialMessage, taskRef, query);
      if (!discussionResult) {
        continue;
      }
      const [userAgentContent, assistantAgentContent] = discussionResult;
      if (userAgentContent.toUpperCase().includes('TASK_DONE')) {
        return assistantAgentContent;
      }
      initialMessage = assistantAgentContent;
    }

    return '';
  }

  async discussTask(
    message: string,
    taskRef: AgentTaskRef,
    query: Parameters,
  ): Promise<[string, string] | null> {
    const userAgentCompletion = await this.userAgent.run(message, taskRef);
    if (!userAgentCompletion) {
      return null;
    }

    let messageModel = await taskRef.createMessage('User Agent');
    
    // 创建user_agent类型的内容块，直接包含 subtaskId
    const userAgentBlock: any = {
      type: 'user_agent',
      content: '',
      timestamp: Date.now(),
      id: `user_agent_${Date.now()}`
    };
    
    // 直接添加 subtaskId 到内容块中
    if (taskRef.subtaskId !== undefined) {
      userAgentBlock.subtaskId = taskRef.subtaskId;
    }
    
    // 将user_agent块添加到消息内容中
    try {
      const existingContent = JSON.parse(messageModel.content || '[]');
      const updatedContent = Array.isArray(existingContent) ? existingContent : [];
      updatedContent.push(userAgentBlock);
      messageModel.content = JSON.stringify(updatedContent);
    } catch {
      // 如果解析失败，创建新的内容块数组
      messageModel.content = JSON.stringify([userAgentBlock]);
    }
    
    taskRef.observer.next(messageModel);
    
    userAgentCompletion.contentStream.subscribe({
      next: (chunk) => {
        // 更新user_agent块的内容
        try {
          const existingContent = JSON.parse(messageModel.content || '[]');
          const updatedContent = Array.isArray(existingContent) ? existingContent : [];
          const userAgentBlockIndex = updatedContent.findIndex((block: any) => block.type === 'user_agent' && block.id === userAgentBlock.id);
          
          if (userAgentBlockIndex !== -1) {
            updatedContent[userAgentBlockIndex].content = chunk;
            messageModel.content = JSON.stringify(updatedContent);
          }
        } catch {
          // 如果解析失败，保持原内容
        }
        
        taskRef.observer.next(messageModel);
      },
      async complete() {
        await taskRef.completeMessage(messageModel);
        
        // 流完成后，添加自动折叠标记
        try {
          const existingContent = JSON.parse(messageModel.content || '[]');
          const updatedContent = Array.isArray(existingContent) ? existingContent : [];
          const userAgentBlockIndex = updatedContent.findIndex((block: any) => block.type === 'user_agent' && block.id === userAgentBlock.id);
          
          if (userAgentBlockIndex !== -1) {
            updatedContent[userAgentBlockIndex].autoCollapse = true;
            messageModel.content = JSON.stringify(updatedContent);
          }
        } catch {
          // 如果解析失败，保持原内容
        }
        
        taskRef.observer.next(messageModel);
      },
      error(_err) {
        taskRef.completeMessage(messageModel, 'FAILED');
        taskRef.observer.next(messageModel);
      },
    });

    // 等待流完全处理完成后再获取完整内容
    let userAgentContent = await userAgentCompletion.getFullContent();
    console.log('userAgentContent', userAgentContent);

    if (userAgentContent.toUpperCase().includes('TASK_DONE')) {
      userAgentContent += toFinalAnswerPrompt(query.question);
    } else {
      userAgentContent += addAuxiliaryInformationPrompt(query.question);
    }

    const assistantAgentCompletion = await this.assistantAgent.run(userAgentContent, taskRef);
    if (!assistantAgentCompletion) {
      return null;
    }

    messageModel = await taskRef.createMessage('Assistant Agent');
    
    // 创建assistant_agent类型的内容块，直接包含 subtaskId
    const assistantAgentBlock: any = {
      type: 'assistant_agent',
      content: '',
      timestamp: Date.now(),
      id: `assistant_agent_${Date.now()}`
    };
    
    // 直接添加 subtaskId 到内容块中
    if (taskRef.subtaskId !== undefined) {
      assistantAgentBlock.subtaskId = taskRef.subtaskId;
    }
    
    // 将assistant_agent块添加到消息内容中
    try {
      const existingContent = JSON.parse(messageModel.content || '[]');
      const updatedContent = Array.isArray(existingContent) ? existingContent : [];
      updatedContent.push(assistantAgentBlock);
      messageModel.content = JSON.stringify(updatedContent);
    } catch {
      // 如果解析失败，创建新的内容块数组
      messageModel.content = JSON.stringify([assistantAgentBlock]);
    }
    
    taskRef.observer.next(messageModel);
    
    assistantAgentCompletion.contentStream.subscribe({
      next: (chunk) => {
        // 更新assistant_agent块的内容
        try {
          const existingContent = JSON.parse(messageModel.content || '[]');
          const updatedContent = Array.isArray(existingContent) ? existingContent : [];
          const assistantAgentBlockIndex = updatedContent.findIndex((block: any) => block.type === 'assistant_agent' && block.id === assistantAgentBlock.id);
          
          if (assistantAgentBlockIndex !== -1) {
            updatedContent[assistantAgentBlockIndex].content = chunk;
            messageModel.content = JSON.stringify(updatedContent);
          }
        } catch {
          // 如果解析失败，保持原内容
        }
        
        taskRef.observer.next(messageModel);
      },
      complete() {
        taskRef.completeMessage(messageModel);
        
        // 流完成后，添加自动折叠标记
        try {
          const existingContent = JSON.parse(messageModel.content || '[]');
          const updatedContent = Array.isArray(existingContent) ? existingContent : [];
          const assistantAgentBlockIndex = updatedContent.findIndex((block: any) => block.type === 'assistant_agent' && block.id === assistantAgentBlock.id);
          
          if (assistantAgentBlockIndex !== -1) {
            updatedContent[assistantAgentBlockIndex].autoCollapse = true;
            messageModel.content = JSON.stringify(updatedContent);
          }
        } catch {
          // 如果解析失败，保持原内容
        }
        
        taskRef.observer.next(messageModel);
      },
      error() {
        taskRef.completeMessage(messageModel, 'FAILED');
        taskRef.observer.next(messageModel);
      },
    });

    let assistantAgentContent = await lastValueFrom(
      assistantAgentCompletion.contentStream.pipe(defaultIfEmpty(''))
    );

    if (!userAgentContent.toUpperCase().includes('TASK_DONE')) {
      assistantAgentContent = toNextInstructionPrompt(assistantAgentContent);
    }

    return [userAgentContent, assistantAgentContent];
  }
}
