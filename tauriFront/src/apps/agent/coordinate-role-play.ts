import { lastValueFrom, defaultIfEmpty } from 'rxjs';
import type { ChatCompletion } from '../model/chat-completion.js';
import {
  coordinatingUserPrompt,
  startCoordinatingRunnerPrompt,
  toCoordinatingNextInstructionPrompt,
  toFinalAnswerPrompt,
} from '../prompt/index.js';
import { BaseAgent } from './base-agent.js';
import { DialogueAgent } from './dialogue-agent.js';
import { TaskOrientedAgent } from './task-oriented-agent.js';
import type { AgentTaskRef } from './type.js';

export class CoordinateRolePlayAgent {
  private roleAgent: BaseAgent = new BaseAgent({
    temperature: 0,
    tools: [new DialogueAgent(), new TaskOrientedAgent()],
  });

  async play(task: string, taskRef: AgentTaskRef) {
    const { abortSignal } = taskRef;
    if (!abortSignal) {
      throw new Error('abortSignal is required');
    }

    this.roleAgent.initialSystemMessage(coordinatingUserPrompt(task));
    let message = startCoordinatingRunnerPrompt();
    let assistantCompletion: ChatCompletion | null = null;

    while (true) {
      assistantCompletion = await this.roleAgent.run(message, taskRef);
      if (!assistantCompletion) {
        break;
      }

      const messageModel = await taskRef.createMessage('Coordinate Agent');
      // 在该轮完成时派发包含 conversationId 和 messageId 的 token 使用事件
      if ((assistantCompletion as any)?.completed) {
        (assistantCompletion as any).completed.subscribe({
          next: (done: boolean) => {
            if (!done) return;
            try {
              const usage = (assistantCompletion as any).usage;
              if (usage && usage.total_tokens > 0 && typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('agent-token-usage', {
                    detail: {
                      conversationId: (taskRef as any).conversationId,
                      messageId: (taskRef as any).uiMessageId || messageModel.id,
                      usage,
                      timestamp: Date.now(),
                    },
                  }),
                );
              }
            } catch {}
          },
        });
      }
      // assistantCompletion.contentStream.subscribe({
      //   next: (value) => {
      //     messageModel.content = value;
      //     taskRef.observer.next(messageModel);
      //   },
      //   async complete() {
      //     await taskRef.completeMessage(messageModel);
      //     taskRef.observer.next(messageModel);
      //   },
      //   error: (error) => {
      //     taskRef.completeMessage(messageModel, 'FAILED');
      //     taskRef.observer.next(messageModel);
      //     console.log('error', error);
      //   },
      // });

      message = await lastValueFrom(
        assistantCompletion.contentStream.pipe(defaultIfEmpty(''))
      );
      if (message.toUpperCase().includes('TASK_DONE')) {
        message += toFinalAnswerPrompt(task);
        assistantCompletion = await this.roleAgent.run(message, taskRef);
        if (!assistantCompletion) {
          break;
        }
        const messageModel = await taskRef.createMessage('Coordinate Agent');
        if ((assistantCompletion as any)?.completed) {
          (assistantCompletion as any).completed.subscribe({
            next: (done: boolean) => {
              if (!done) return;
              try {
                const usage = (assistantCompletion as any).usage;
                if (usage && usage.total_tokens > 0 && typeof window !== 'undefined') {
                  window.dispatchEvent(
                    new CustomEvent('agent-token-usage', {
                      detail: {
                        conversationId: (taskRef as any).conversationId,
                        messageId: (taskRef as any).uiMessageId || messageModel.id,
                        usage,
                        timestamp: Date.now(),
                      },
                    }),
                  );
                }
              } catch {}
            },
          });
        }
        taskRef.observer.next(messageModel);
        // assistantCompletion.contentStream.subscribe({
        //   next: (value) => {
        //     messageModel.content = value;
        //     taskRef.observer.next(messageModel);
        //   },
        //   async complete() {
        //     await taskRef.completeMessage(messageModel);
        //     taskRef.observer.next(messageModel);
        //   },
        //   error: (error) => {
        //     taskRef.completeMessage(messageModel, 'FAILED');
        //     taskRef.observer.next(messageModel);
        //     console.log('error', error);
        //   },
        // });
        await lastValueFrom(
          assistantCompletion.contentStream.pipe(defaultIfEmpty(''))
        );
        break;
      }

      message += toCoordinatingNextInstructionPrompt();
    }

    return assistantCompletion;
  }
}
