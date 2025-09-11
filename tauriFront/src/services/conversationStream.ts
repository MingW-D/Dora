import conversationAgentManager from '../apps/agent/conversation-agent-manager';
import { observableToGenerator } from '../apps/utils/observable-to-generator';
import { removeFilterPatterns } from '../apps/utils/filter-stream';

export type AgentStartArgs = string | { task: string; uiMessageId?: string };

export async function* subscribeConversation(
  conversationId: string,
  startArgs: AgentStartArgs,
  abortSignal?: AbortSignal,
) {
  const ctx = await conversationAgentManager.getOrCreateAgentContext(conversationId);
  const stream$ = await ctx.agent.start(startArgs);

  const generator = observableToGenerator<any>(stream$, {
    bufferSize: 1,
    processBuffer: (messages) => {
      return messages.map((message) => {
        try {
          if (message && typeof message === 'object' && typeof (message as any).content === 'string') {
            const raw = (message as any).content as string;
            // 对可见文本进行过滤
            (message as any).content = removeFilterPatterns(raw);
          }
        } catch {}
        return message;
      });
    },
  });

  if (abortSignal?.aborted) {
    return;
  }

  let aborted = false;
  const onAbort = () => {
    aborted = true;
  };
  abortSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    for await (const message of generator) {
      if (aborted) break;
      yield message;
    }
  } finally {
    abortSignal?.removeEventListener('abort', onAbort);
  }
}

