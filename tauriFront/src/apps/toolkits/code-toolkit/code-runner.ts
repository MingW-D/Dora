// 注意：如需启用本地执行，请确保在 Tauri 配置中启用 shell 与 fs 权限
// import { Command } from '@tauri-apps/plugin-shell';
// import { unlink, writeTextFile } from '@tauri-apps/plugin-fs';
// import * as tauriPath from '@tauri-apps/api/path';
// 移除对 js-yaml 的依赖，返回 JSON 字符串
import { BaseAgent } from '../../agent/base-agent.js';
import type { AgentTaskRef } from '../../agent/type.js';
import type { SpecializedToolAgent } from '../types.js';
import { codeCommandMap } from './code-support.js';

// 关闭本地执行（占位）

export class CodeRunnerAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'CodeRunnerTool';

  description = 'A tool for generating and running JavaScript code';

  parameters = {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The code to execute' },
      language: {
        type: 'string',
        description: 'Code language, supports multiple programming languages',
        default: 'javascript',
        enum: Object.keys(codeCommandMap),
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout (milliseconds), default is 5000ms',
        default: 5000,
      },
      context: {
        type: 'object',
        description: 'Context variables for code execution',
        default: {},
      },
    },
    required: ['code'],
  };

  strict = true;

  async execute(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<string> {
    const code = String(query.code ?? '');
    const language = (query.language as string) || 'javascript';
    // const timeout = Number(query.timeout ?? 5000);

    // 捕获输出
    const logs: string[] = [];
    const errors: string[] = [];
    let result: unknown = undefined;

    try {
      if (Object.keys(codeCommandMap).includes(language)) {
        throw new Error('Local code execution is disabled in Tauri front-end for safety.');
      } else {
        throw new Error('JavaScript execution is disabled in Tauri front-end for safety.');
      }

      await taskRef.studio.start(
        {
          type: 'editor',
          description: 'Code Execution Result',
          payload: `${code}\n\n// execution is disabled in front-end`,
        },
        taskRef.observer,
        taskRef.abortSignal,
      );

      return JSON.stringify({
        success: true,
        result: result !== undefined ? String(result) : 'undefined',
        logs,
        errors,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: String(error),
        logs,
        errors,
      }, null, 2);
    }
  }
}
