import type { ModelType } from '../ai-sdk/index.js';
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/index.mjs';
import type { FunctionDefinition } from 'openai/resources/shared.mjs';
import { lastValueFrom, defaultIfEmpty } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { loadSdkAndModel } from '../ai-sdk/index.js';
import { ChatCompletion } from '../model/chat-completion.js';
import type { SpecializedToolAgent } from '../toolkits/types.js';
import type { AgentTaskRef } from './type.js';
import { tokenCounter } from '../utils/token-counter.js';
import { useModelStore } from '../../stores/modelStore';

type Message = ChatCompletionMessageParam & {
  tool_calls?: ChatCompletionMessageToolCall[];
  tool_call_id?: string;
};

// 判断 Ollama 模型是否支持工具调用
function shouldSupportTools(modelName: string): boolean {
  const model = modelName.toLowerCase();
  
  // 已知不支持工具的模型列表
  const unsupportedModels = [
    'deepseek-r1',
    'llama2',
    'codellama',
    'vicuna',
    'alpaca'
  ];
  
  // 已知支持工具的模型列表（部分较新的模型）
  const supportedModels = [
    'llama3',
    'qwen',
    'mistral',
    'mixtral'
  ];
  
  // 检查是否在不支持列表中
  if (unsupportedModels.some(unsupported => model.includes(unsupported))) {
    return false;
  }
  
  // 检查是否在支持列表中
  if (supportedModels.some(supported => model.includes(supported))) {
    return true;
  }
  
  // 默认情况下，假设不支持工具（保守策略）
  return false;
}

export class BaseAgent {
  protected messageHistory: Array<Message> = [];
  protected systemMessage = '';
  private tools: SpecializedToolAgent[] = [];
  private temperature = 0.5;
  private readonly MAX_HISTORY_LENGTH = 30;
  private readonly MAX_TOOLS = 180;

  private uuid = uuidv4();

  protected name = '';

  constructor(options?: {
    temperature?: number;
    tools?: SpecializedToolAgent[];
  }) {
    this.temperature = options?.temperature ?? 0.5;
    this.tools = options?.tools ?? [];

    if (this.tools.length > this.MAX_TOOLS) {
      throw new Error('Too many tools');
    }
  }

  get publicMessageHistory() {
    return [...this.messageHistory];
  }

  clearMessageHistory() {
    this.systemMessage = '';
    this.messageHistory = [];
  }

  initialSystemMessage(systemMessage: string) {
    if (this.systemMessage) {
      return;
    }
    this.systemMessage = systemMessage;
    this.addToHistory('system', this.systemMessage);
  }

  addToHistory(
    role: Message['role'],
    content: string,
    taskRef?: AgentTaskRef,
    toolCalls?: ChatCompletionMessageToolCall[],
    toolCallId?: string,
  ): void {
    if (!content && !toolCalls?.length && !toolCallId) {
      return; // 避免添加空消息
    }

    const message = { role, content } as Message;

    if (toolCalls?.length) {
      message.tool_calls = toolCalls;
    }

    if (role === 'tool' && toolCallId) {
      message.tool_call_id = toolCallId;
    }

    this.messageHistory.push(message);
    this.trimMessageHistory();
  }

  private trimMessageHistory(): void {
    if (this.messageHistory.length > this.MAX_HISTORY_LENGTH) {
      // 保留系统消息，删除较早的用户和助手消息
      const systemMessages = this.messageHistory.filter((msg) => msg.role === 'system');
      const otherMessages = this.messageHistory.filter((msg) => msg.role !== 'system');
      const trimmedOtherMessages = otherMessages.slice(
        -this.MAX_HISTORY_LENGTH + systemMessages.length,
      );
      this.messageHistory = [...systemMessages, ...trimmedOtherMessages];
    }
  }

  resetMessageHistory() {
    this.messageHistory = [];
  }

  get hasToolCalls() {
    return this.messageHistory.some((message) => message.role === 'tool');
  }

  async generateResponse(
    abortSignal: AbortSignal,
    messageHistory?: Message[],
    tools?: SpecializedToolAgent[],
    params?: Partial<ChatCompletionCreateParamsStreaming>,
    model: ModelType = 'TEXT',
  ): Promise<ChatCompletion> {
    try {
      if (abortSignal.aborted) {
        throw new Error('Operation cancelled by user');
      }

      const modelStore = useModelStore();
      const currentModelId = modelStore.currentModelId;
      
      const modelProvider = await loadSdkAndModel(currentModelId);
      const currentModel = modelStore.currentModel;
      
      // 检查是否支持工具调用
      let supportsTools = false;
      if (currentModel?.supports_tools !== undefined) {
        // 如果手动指定了支持状态，使用用户设置
        supportsTools = currentModel.supports_tools;
      } else {
        // 否则使用自动检测
        supportsTools = modelProvider[model].provider === 'openai' || 
          (modelProvider[model].provider === 'ollama' && shouldSupportTools(modelProvider[model].model));
      }
      
      // 如果模型不支持工具，则禁用工具调用并警告用户
      let effectiveTools = tools;
      if (!supportsTools && tools?.length) {
        console.warn(`Model ${modelProvider[model].model} (${modelProvider[model].provider}) does not support tools. Tools will be ignored.`);
        effectiveTools = []; // 使用空的工具列表
      }
      
      let generateParams = {} as Omit<ChatCompletionCreateParamsStreaming, 'messages' | 'model'>;
      if (effectiveTools?.length) {
        // 打印所有工具名称，用于检查格式
        console.log('Tools being sent to API:', effectiveTools.map((tool) => `"${tool.name}"`).join(', '));

        generateParams.tools = effectiveTools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          } as FunctionDefinition,
        }));
      }

      if (params) {
        generateParams = {
          ...generateParams,
          ...params,
        };
      }
      
      const chatCompletion = await modelProvider[model].sdk.chat.completions.create(
        {
          model: modelProvider[model].model,
          messages: messageHistory ?? this.messageHistory,
          temperature: this.temperature,
          ...generateParams,
          stream: true,
          // 让OpenAI在流的最后一个chunk返回usage，便于统计token
          stream_options: { include_usage: true },
        },
        {
          signal: abortSignal,
        },
      );

      const completion = new ChatCompletion(chatCompletion);
      
      // 为流式响应设置token统计监听器
      if (completion.completed) {
        completion.completed.subscribe({
          next: (isCompleted) => {
            if (isCompleted) {
              // 当流处理完成时，统计token使用量
              const usage = completion.usage;
              if (usage && usage.total_tokens > 0) {
                tokenCounter.addUsage(usage);
                console.log('Token usage updated:', usage);
                
                // 触发自定义事件，传递token使用信息给前端
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('agent-token-usage', {
                    detail: {
                      agentId: this.uuid,
                      agentName: this.name,
                      usage: usage,
                      timestamp: Date.now()
                    }
                  }));
                }
              }
            }
          },
          error: (err) => {
            console.error('Error in completion stream:', err);
          }
        });
      }

      return completion;
    } catch (error) {
      if (error instanceof Error) {
        if (abortSignal.aborted) {
          throw new Error('Request was cancelled');
        }
        throw new Error(`Failed to generate response: ${error.message}`);
      }
      throw new Error('Unknown error occurred while generating response');
    }
  }

  protected async runWithTools(
    taskRef: AgentTaskRef,
    toolCalls: ChatCompletionMessageToolCall[],
    tools: SpecializedToolAgent[],
  ): Promise<Array<{ toolCall: ChatCompletionMessageToolCall; result: unknown }> | null> {
    if (!toolCalls.length || !tools.length) {
      return null;
    }

    const results = [];
    this.addToHistory('assistant', '', taskRef, toolCalls);

    for (const toolCall of toolCalls) {
      if (taskRef.abortSignal.aborted) {
        this.addToHistory('tool', 'User cancelled the operation', taskRef, undefined, toolCall.id);
        continue;
      }

      try {
        // 类型保护：确保toolCall有function属性
        if (!('function' in toolCall) || !toolCall.function) {
          console.error('Invalid tool call format:', toolCall);
          this.addToHistory('tool', 'Invalid tool call format', taskRef, undefined, toolCall.id);
          continue;
        }
        
        const toolName = toolCall.function.name;
        const toolArgs = toolCall.function.arguments;

        const tool = tools.find((t) => t.name === toolName);
        if (!tool) {
          console.error(`Tool not found: ${toolName}`);
          this.addToHistory('tool', `Tool not found: ${toolName}`, taskRef, undefined, toolCall.id);
          continue;
        }

        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs =
            typeof toolArgs === 'string'
              ? JSON.parse(toolArgs)
              : (toolArgs as Record<string, unknown>);
        } catch (e) {
          console.error(
            `Failed to parse tool arguments: ${toolName}, Error: ${(e as Error).message}, ${toolArgs}`,
          );
          this.addToHistory(
            'tool',
            `Failed to parse tool arguments: ${(e as Error).message}, ${toolArgs}`,
            taskRef,
            undefined,
            toolCall.id,
          );
          continue;
        }

        // 发送工具调用开始的消息
        const toolMessage = await taskRef.createMessage('Tool Agent');
        toolMessage.content = JSON.stringify({
          type: 'tool_call',
          toolName: toolName,
          agentId: this.uuid,
          status: 'started',
          parameters: parsedArgs,
          timestamp: Date.now()
        });
        taskRef.observer.next(toolMessage);

        taskRef.studio.browserUse.webContentsView.setVisible(false);
        const result = await tool.execute(parsedArgs, taskRef);

        if (process.env.NODE_ENV !== 'production') {
          console.log(
            `Tool ${toolName} execution result type: ${typeof result}`,
            typeof result === 'object'
              ? `${JSON.stringify(result).substring(0, 100)}...`
              : typeof result === 'string'
                ? result.substring(0, 100)
                : result,
          );
        }

        if (result) {
          const content = typeof result === 'string' ? result : JSON.stringify(result);
          this.addToHistory('tool', content, taskRef, undefined, toolCall.id);
          results.push({ toolCall, result });
          
          // 发送工具调用完成的消息 - 使用内容块聚合
          const completedMessage = await taskRef.createMessage('Tool Agent');
          completedMessage.content = JSON.stringify({
            type: 'tool_message',
            toolName: tool.description || toolName,
            agentId: this.uuid,
            status: 'completed',
            parameters: parsedArgs,
            result: result,
            timestamp: Date.now()
          });
          taskRef.observer.next(completedMessage);
        } else {
          this.addToHistory(
            'tool',
            `Tool ${toolName} completed execution but returned no result`,
            taskRef,
            undefined,
            toolCall.id,
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const toolName = ('function' in toolCall && toolCall.function) ? toolCall.function.name : 'unknown';
        console.error(`Tool ${toolName} execution failed: ${errorMessage}`);
        this.addToHistory(
          'tool',
          `Tool ${toolName} execution failed: ${errorMessage}`,
          taskRef,
          undefined,
          toolCall.id,
        );
        
        // 发送工具调用失败的消息
        const failedMessage = await taskRef.createMessage('Tool Agent');
        failedMessage.content = JSON.stringify({
          type: 'tool_message',
          toolName: toolName,
          agentId: this.uuid,
          status: 'failed',
          parameters: {},
          error: errorMessage,
          timestamp: Date.now()
        });
        taskRef.observer.next(failedMessage);
      }
    }

    return results.length > 0 ? results : null;
  }

  async run(
    message: Message | string,
    taskRef: AgentTaskRef,
    tools?: SpecializedToolAgent[],
    params?: Partial<ChatCompletionCreateParamsStreaming>,
    model: ModelType = 'TEXT',
  ): Promise<ChatCompletion | null> {
    if (!this.systemMessage) {
      throw new Error('System message is not set');
    }

    try {
      // 支持直接传入字符串消息
      if (typeof message === 'string') {
        this.addToHistory('user', message);
      } else {
        this.addToHistory(message.role, message.content as string);
      }

      const availableTools = tools?.length ? tools : this.tools;

      if (taskRef.abortSignal.aborted) {
        return null;
      }

      let chatCompletion: ChatCompletion | null = null;
      let toolExecutionCount = 0;
      const MAX_TOOL_EXECUTIONS = 20;
      console.log('messageHistory', this.messageHistory);
      while (!taskRef.abortSignal.aborted && toolExecutionCount < MAX_TOOL_EXECUTIONS) {
        chatCompletion = await this.generateResponse(
          taskRef.abortSignal,
          this.messageHistory,
          availableTools,
          params,
          model,
        );

        const toolCalls = await lastValueFrom(
          chatCompletion.toolCallsStream.pipe(defaultIfEmpty([]))
        );
        if (!toolCalls.length) {
          break;
        }

        await this.runWithTools(taskRef, toolCalls, availableTools);
        toolExecutionCount++;
      }

      if (toolExecutionCount >= MAX_TOOL_EXECUTIONS) {
        this.addToHistory('system', 'Maximum tool execution limit reached, stopping execution');
      }

      if (chatCompletion) {
        let content = '';
        chatCompletion.contentStream.subscribe({
          next: (fullContent) => {
            // contentStream now returns the full accumulated content
            content = fullContent;
          },
          complete: () => {
            if (content) {
              this.addToHistory('assistant', content);
            }
          },
          error: (error) => {},
        });
      }

      return chatCompletion;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Execution failed: ${errorMessage}`);
      throw new Error(`Execution failed: ${errorMessage}`);
    }
  }
}
