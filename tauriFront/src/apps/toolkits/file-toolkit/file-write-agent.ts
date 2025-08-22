import { writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, resolve, dirname } from '@tauri-apps/api/path';
import yaml from 'js-yaml';
import { BaseAgent } from '../../agent/base-agent.js';
import type { AgentTaskRef } from '../../agent/type.js';
import type { SpecializedToolAgent } from '../types.js';

export class FileWriteAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'FileWriteTool';

  description = 'A tool for writing content to files';

  parameters = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'File path to write to' },
      content: { type: 'string', description: 'Content to write' },
      encoding: {
        type: 'string',
        description: 'File encoding, defaults to utf-8',
        default: 'utf-8',
      },
      append: {
        type: 'boolean',
        description: 'Whether to append content instead of overwriting, defaults to false',
        default: false,
      },
    },
    required: ['filePath', 'content'],
  };

  strict = true;

  async execute(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<string> {
    let filePath = query.filePath as string;
    const content = query.content as string;
    const encoding = (query.encoding as string) || 'utf-8';
    const append = Boolean(query.append);

    // 判断是否绝对路径（简单判断前缀）
    const isAbsolute = filePath.startsWith('/') || /^[a-zA-Z]:\\/.test(filePath);
    if (!isAbsolute) {
      const dataDir = await appDataDir();
      const convDir = await resolve(dataDir, taskRef.conversationId);
      filePath = await resolve(convDir, filePath);
    }

    const absolutePath = filePath;
    const dir = await dirname(absolutePath);
    // 确保目录存在
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }

    // 由于 plugin-fs 没有 appendFile，手动实现：若 append=true 则先读旧内容再写
    if (append) {
      try {
        const oldContent = await (await import('@tauri-apps/plugin-fs')).readTextFile(absolutePath, {
          encoding: encoding as any,
        });
        await writeTextFile(absolutePath, oldContent + content, { encoding: encoding as any });
      } catch {
        // 文件不存在则直接写
        await writeTextFile(absolutePath, content, { encoding: encoding as any });
      }
    } else {
      await writeTextFile(absolutePath, content, { encoding: encoding as any });
    }

    await taskRef.studio.start(
      {
        type: 'editor',
        payload: {
          text: content,
        },
        description: absolutePath,
      },
      taskRef.observer,
      taskRef.abortSignal,
    );

    return yaml.dump({
      success: true,
      path: absolutePath,
      message: `File has been ${append ? 'appended' : 'written'}`,
    });
  }
}
