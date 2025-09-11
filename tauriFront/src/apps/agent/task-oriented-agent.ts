import { lastValueFrom, defaultIfEmpty } from 'rxjs';
import {
  executorAgentSystemPrompt,
  plannerAgentSystemPrompt,
  validatorAgentSystemPrompt,
} from '../prompt/index.js';
import type { SpecializedToolAgent } from '../toolkits/types.js';
import { BaseAgent } from './base-agent.js';
import { DialogueAgent } from './dialogue-agent.js';
import type { AgentTaskRef } from './type.js';
import { tools } from './tools.js';

type Parameters = {
  task: string;
  expected_result: string;
  context?: string;
};

// 子任务类型定义
type SubTask = {
  id: number;
  description: string;
  completed: boolean;
  result?: string;
  dependencies?: number[]; // 添加依赖项字段，标识该任务依赖哪些前置任务
};

export class TaskOrientedAgent extends BaseAgent implements SpecializedToolAgent {
  override readonly name = 'building To-dos';
  readonly description =
    'building To-dos.';
  readonly parameters = {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The main task to be executed.' },
      expected_result: {
        type: 'string',
        description: 'The expected result of the task.',
      },
    },
    required: ['task', 'expected_result'],
  };

  readonly strict = true;

  private plannerAgent = new BaseAgent({
    temperature: 0.2,
    tools
  });

  private executorAgent = new DialogueAgent();

  private validatorAgent = new BaseAgent({
    temperature: 0.1,
  });

  static readonly MAX_ITERATIONS = 10;
  static readonly MAX_SUBTASKS = 7;

  // 添加类成员变量以存储所有子任务
  private subTasks: SubTask[] = [];

  constructor() {
    super({
      temperature: 0,
      tools: [],
    });
  }

  async execute(query: Parameters, taskRef: AgentTaskRef): Promise<string> {
    // 初始化代理系统消息
    this.plannerAgent.initialSystemMessage(
      plannerAgentSystemPrompt(TaskOrientedAgent.MAX_SUBTASKS),
    );

    this.validatorAgent.initialSystemMessage(validatorAgentSystemPrompt());

    if (taskRef.abortSignal.aborted) {
      return 'Task has been aborted.';
    }

    console.log('query', query);
    // 步骤1: 分解任务
    const subTasks = await this.decomposeTasks(query.task, taskRef);
    if (!subTasks || subTasks.length === 0) {
      return 'Unable to decompose the task, please provide a clearer task description.';
    }

    // 存储全局变量以便executeSubTask可以访问所有子任务
    this.subTasks = subTasks;

    // 步骤2: 执行子任务
    for (let i = 0; i < subTasks.length; i++) {
      const subTask = subTasks[i];
      if (taskRef.abortSignal.aborted) {
        return 'Task has been aborted.';
      }

      // 发送子任务开始消息 - 使用内容块聚合
      const startMessage = await taskRef.createMessage('Task Manager');
      startMessage.content = JSON.stringify({
        type: 'subtask_start',
        subtaskId: subTask.id,
        description: subTask.description,
        status: 'running',
        completedSubtasks: subTasks.filter(t => t.completed).length,
        totalSubtasks: subTasks.length
      });
      taskRef.observer.next(startMessage);

      let retryCount = 0;
      let retryResult = '';
      this.executorAgent = new DialogueAgent();
      this.executorAgent.initialSystemMessage(executorAgentSystemPrompt());

      while (retryCount < 3) {
        const result = await this.executeSubTask(subTask, query.task, taskRef, retryResult);

        // 验证子任务结果
        const validateResult = await this.validateSubTask(subTask, result, taskRef);
        subTask.completed = validateResult.isValid;
        subTask.result = result;
        retryResult += `\n\n${validateResult.reason}`;

        // 如果验证失败，尝试重新执行一次
        if (validateResult.isValid) {
                  // 发送子任务完成消息 - 使用内容块聚合
        const completeMessage = await taskRef.createMessage('Task Manager');
        completeMessage.content = JSON.stringify({
          type: 'subtask_complete',
          subtaskId: subTask.id,
          description: subTask.description,
          result: result,
          status: 'completed',
          completedSubtasks: subTasks.filter(t => t.completed).length,
          totalSubtasks: subTasks.length,
          validationResult: true
        });
        taskRef.observer.next(completeMessage);
          break;
        }
        retryCount++;
      }

      // 如果重试3次仍然失败 - 使用内容块聚合
      if (!subTask.completed) {
        const failMessage = await taskRef.createMessage('Task Manager');
        failMessage.content = JSON.stringify({
          type: 'subtask_failed',
          subtaskId: subTask.id,
          description: subTask.description,
          status: 'failed',
          completedSubtasks: subTasks.filter(t => t.completed).length,
          totalSubtasks: subTasks.length,
          validationResult: false
        });
        taskRef.observer.next(failMessage);
      }
    }

    // 步骤3: 汇总结果
    return await this.summarizeResults(query.task, subTasks, query.expected_result, taskRef);
  }

  // 新增：安全提取顶层 JSON 片段（支持 '[' 或 '{'），处理字符串与转义，避免被内部 [] 或 {} 误截断
  private extractBalancedJSON(text: string, startChar: '[' | '{'): string | null {
    const endChar = startChar === '[' ? ']' : '}';
    const start = text.indexOf(startChar);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let stringChar: '"' | "'" | null = null;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      const prev = i > 0 ? text[i - 1] : '';

      if (inString) {
        // 处理字符串结束（忽略被转义的引号）
        if (ch === stringChar && prev !== '\\') {
          inString = false;
          stringChar = null;
        }
        continue;
      } else {
        // 进入字符串
        if (ch === '"' || ch === "'") {
          inString = true;
          stringChar = ch as '"' | "'";
          continue;
        }

        if (ch === startChar) {
          depth++;
        } else if (ch === endChar) {
          depth--;
          if (depth === 0) {
            return text.slice(start, i + 1);
          }
        }
      }
    }
    return null;
  }

  private async decomposeTasks(task: string, taskRef: AgentTaskRef): Promise<SubTask[]> {
    const prompt = `Break tasks into subtasks.
Generate subtasks as needed. It is not necessary to generate the maximum number of subtasks every time.
The task to be broken down is:
${task}
For each subtask, please provide: 
1. id: a unique number
2. description: clear description of what needs to be done
3. dependencies: an array of subtask IDs that this subtask depends on (or empty array if none)

Please ensure that the task is not overly decomposed. Only create subtasks that are necessary and meaningful.

Please identify dependencies between subtasks. For example, if a subtask needs the results from previous subtasks, list those subtask IDs in its dependencies.

Output a list of subtasks in JSON format.`;

    const completion = await this.plannerAgent.run(prompt, taskRef);
    if (!completion) {
      return [];
    }

    const messageModel = await taskRef.createTaskMessage({
      type: 'editor',
      description: 'Task Planning',
      payload: '',
    });
    messageModel.messageType = 'task_planning';

    completion.contentStream.subscribe({
      next: (chunk) => {
        if (messageModel.task) {
          messageModel.task.payload = chunk;
        }
        taskRef.observer.next(messageModel);
        taskRef.studio.preview({
          type: 'editor',
          payload: chunk,
          description: 'Task Planning',
        });
      },
      complete() {
        if (messageModel.task) {
          taskRef.completeTaskMessage(messageModel.task);
        }
        taskRef.completeMessage(messageModel);
        taskRef.observer.next(messageModel);
      },
    });

    const content = await lastValueFrom(
      completion.contentStream.pipe(defaultIfEmpty(''))
    );

    try {
      // 尝试从回复中提取JSON
      let jsonContent = '';

      // 优先：Markdown 代码块
      const markdownMatch = content.match(/```(?:json)?[\s\r\n]*([\s\S]*?)```/i);
      if (markdownMatch) {
        jsonContent = markdownMatch[1].trim();
      }
      // 次之：顶层数组（用括号计数保障完整性）
      else {
        const arraySegment = this.extractBalancedJSON(content, '[');
        if (arraySegment) {
          jsonContent = arraySegment.trim();
        } else {
          // 再次尝试：顶层对象
          const objectSegment = this.extractBalancedJSON(content, '{');
          if (objectSegment) {
            jsonContent = objectSegment.trim();
          } else {
            // 最后兜底：直接使用全文
            jsonContent = content.trim();
          }
        }
      }

      console.log('jsonContent', jsonContent);

      // 尝试解析 JSON
      try {
        // 确保内容是一个数组
        let parsedContent: { id: number; description: string; dependencies?: number[] }[];
        if (jsonContent.trim().startsWith('{')) {
          // 如果是单个对象，将其包装为数组
          parsedContent = [JSON.parse(jsonContent)];
        } else if (jsonContent.trim().startsWith('[')) {
          // 如果已经是数组，直接解析
          parsedContent = JSON.parse(jsonContent);
        } else {
          // 尝试先包装成数组再解析
          parsedContent = JSON.parse(`[${jsonContent}]`);
        }

        // 确保解析结果是数组
        const tasks = Array.isArray(parsedContent) ? parsedContent : [parsedContent];
        const subTasks = tasks.map(
          (task: { id: number; description: string; dependencies?: number[] }, index: number) => ({
            id: task.id || index + 1,
            description: task.description,
            completed: false,
            dependencies: task.dependencies || [],
          }),
        );

        // 发送 plan_steps 消息给前端
        const planStepsMessage = await taskRef.createMessage('Task-Oriented-Agent');
        planStepsMessage.messageType = 'plan_steps';
        
        // 创建内容块
        const planStepsBlock = {
          type: 'plan_steps' as const,
          content: subTasks.map(task => `${task.description}${task.dependencies && task.dependencies.length > 0 ? ` (依赖: ${task.dependencies.join(', ')})` : ''}`),
          metadata: {
            totalSteps: subTasks.length,
            planData: subTasks
          }
        };
        
        planStepsMessage.content = JSON.stringify([planStepsBlock]);
        taskRef.completeMessage(planStepsMessage);
        taskRef.observer.next(planStepsMessage);

        return subTasks;
      } catch (parseError) {
        console.error('JSON 解析失败，尝试手动解析', parseError);
        // 如果解析失败，尝试手动解析
        const lines = content.split('\n').filter((line) => line.trim().length > 0);
        const tasks: SubTask[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const match = line.match(/^(\d+)[\.:\)]\s+(.+)$/);
          if (match) {
            tasks.push({
              id: Number.parseInt(match[1]),
              description: match[2],
              completed: false,
            });
          }
        }

        // 即使是手动解析的结果也发送 plan_steps 消息
        if (tasks.length > 0) {
          const planStepsMessage = await taskRef.createMessage('Task-Oriented-Agent');
          planStepsMessage.messageType = 'plan_steps';
          
          // 创建内容块
          const planStepsBlock = {
            type: 'plan_steps' as const,
            content: tasks.map(task => task.description),
            metadata: {
              totalSteps: tasks.length,
              planData: tasks
            }
          };
          
          planStepsMessage.content = JSON.stringify([planStepsBlock]);
          taskRef.completeMessage(planStepsMessage);
          taskRef.observer.next(planStepsMessage);
        }

        return tasks;
      }
    } catch (error) {
      console.error('JSON 解析失败，尝试手动解析', error);
      // 如果解析失败，尝试手动解析
      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      const tasks: SubTask[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const match = line.match(/^(\d+)[\.:\)]\s+(.+)$/);
        if (match) {
          tasks.push({
            id: Number.parseInt(match[1]),
            description: match[2],
            completed: false,
          });
        }
      }

      // 即使是异常情况下手动解析的结果也发送 plan_steps 消息
      if (tasks.length > 0) {
        const planStepsMessage = await taskRef.createMessage('Task-Oriented-Agent');
        planStepsMessage.messageType = 'plan_steps';
        
        // 创建内容块
        const planStepsBlock = {
          type: 'plan_steps' as const,
          content: tasks.map(task => task.description),
          metadata: {
            totalSteps: tasks.length,
            planData: tasks
          }
        };
        
        planStepsMessage.content = JSON.stringify([planStepsBlock]);
        taskRef.completeMessage(planStepsMessage);
        taskRef.observer.next(planStepsMessage);
      }

      return tasks;
    }
  }

  private async executeSubTask(
    subTask: SubTask,
    mainTask: string,
    taskRef: AgentTaskRef,
    previousResult?: string,
  ): Promise<string> {
    let prompt = `Please execute the following subtask: \n\n${subTask.description}\n\n`;

    if (previousResult) {
      prompt += `The previous execution result did not pass the validation. The reason is:
${previousResult}
please retry it in a different way.`;
    }

    // 获取依赖任务的结果
    let dependencyResults = '';
    if (subTask.dependencies && subTask.dependencies.length > 0) {
      dependencyResults = 'Previous subtask results you can reference:\n\n';
      for (const depId of subTask.dependencies) {
        const depTask = this.subTasks.find((t) => t.id === depId);
        if (depTask?.completed && depTask.result) {
          dependencyResults += `Subtask #${depId} (${depTask.description}):\n${depTask.result}\n\n`;
        }
      }
    }

    // 构建上下文信息，包含当前任务的整体情况
    const context = `This is part of a larger task.
Main task: ${mainTask}

Current subtask #${subTask.id}: ${subTask.description}

${dependencyResults}

Note: Please only solve this specific subtask. Even if you see other information in the context, limit your response to the scope of the current subtask. Do not attempt to solve other subtasks or the overall task.`;

    const completion = await this.executorAgent.execute(
      {
        question: prompt,
        expected_result: '',
        context: context,
      },
      taskRef,
    );

    if (!completion) {
      return 'Execution failed, unable to obtain result.';
    }

    return completion;
  }

  private async validateSubTask(
    subTask: SubTask,
    result: string,
    taskRef: AgentTaskRef,
  ): Promise<{ isValid: boolean; reason: string }> {
    const prompt = `Please strictly verify whether the execution result of the following subtask fully meets the requirements:

Subtask: ${subTask.description}

Execution result:
${result}

Verification criteria:
1. Whether the result fully addresses all the requirements described in the subtask.
2. If the subtask requires code implementation, whether the complete code is provided.
3. If the subtask requires calculation or analysis, whether the specific executable result is provided.

Please briefly explain the reasons for verification and provide a clear verification result at the end, with the word count not exceeding 140 characters. 
Reply to me in the language of the Subtask and Execution result.  
If all requirements are fully met, output "VALIDATED: true", otherwise output "VALIDATED: false" and list the unmet requirements. `;

    const completion = await this.validatorAgent.run(prompt, taskRef);
    if (!completion) {
      return {
        isValid: false,
        reason: 'Validation failed, unable to obtain result.',
      };
    }

    // const messageModel = await taskRef.createMessage('Task');
    // messageModel.messageType = 'validation';
    // messageModel.metadata = {
    //   subtaskId: subTask.id,
    //   subtaskDescription: subTask.description
    // };
    // completion.contentStream.subscribe({
    //   next: (chunk) => {
    //     messageModel.content = chunk;
    //     taskRef.observer.next(messageModel);
    //   },
    //   complete() {
    //     taskRef.completeMessage(messageModel);
    //     taskRef.observer.next(messageModel);
    //   },
    // });

    const content = await lastValueFrom(
      completion.contentStream.pipe(defaultIfEmpty(''))
    );

    const isValid = content.toLowerCase().includes('validated: true');
    return {
      isValid,
      reason: content,
    };
  }

  private async summarizeResults(
    task: string,
    subTasks: SubTask[],
    expectedResult: string,
    taskRef: AgentTaskRef,
  ): Promise<string> {
    const completedTasks = subTasks.filter((task) => task.completed);
    const allCompleted = completedTasks.length === subTasks.length;

    // 发送任务总结开始消息
    const summaryStartMessage = await taskRef.createMessage('Task');
    summaryStartMessage.messageType = 'task_summary';
    summaryStartMessage.metadata = {
      completedSubtasks: completedTasks.length,
      totalSubtasks: subTasks.length,
      isMainTaskComplete: allCompleted
    };
    summaryStartMessage.content = `正在生成任务总结...`;
    taskRef.observer.next(summaryStartMessage);

    let prompt = `Based on the following completed subtask results, please generate a final task summary:\n\nMain task: ${task}\n\nExpected result: ${expectedResult}\n\n`;

    prompt += `Subtask completion status: ${completedTasks.length}/${subTasks.length}\n\n`;

    for (const task of subTasks) {
      prompt += `Subtask #${task.id}: ${task.description}\n`;
      prompt += `Completion status: ${task.completed ? '✅ Completed' : '❌ Incomplete'}\n`;
      if (task.result) {
        prompt += `Result: ${task.result.substring(0, 200)}${task.result.length > 200 ? '...' : ''}\n\n`;
      }
    }

    if (!allCompleted) {
      prompt +=
        '\nNote: Not all subtasks were successfully completed. Please mention this in your summary and explain the potential impact.';
    }

    const completion = await this.plannerAgent.run(prompt, taskRef);
    if (!completion) {
      console.error('Unable to generate final summary.');
      return 'Unable to generate final summary.';
    }

    // 创建最终结果消息
    const finalResultMessage = await taskRef.createMessage('Task');
    finalResultMessage.messageType = 'final_result';
    finalResultMessage.metadata = {
      completedSubtasks: completedTasks.length,
      totalSubtasks: subTasks.length,
      isMainTaskComplete: allCompleted
    };

    completion.contentStream.subscribe({
      next: (chunk) => {
        finalResultMessage.content = chunk;
        taskRef.observer.next(finalResultMessage);
      },
      complete() {
        taskRef.completeMessage(finalResultMessage);
        taskRef.observer.next(finalResultMessage);
      },
    });

    await taskRef.studio.startWithStream(
      {
        type: 'editor',
        description: 'Final Task Summary',
        payload: '',
      },
      completion,
      taskRef.observer,
    );

    return await lastValueFrom(
      completion.contentStream.pipe(defaultIfEmpty(''))
    );
  }
}
