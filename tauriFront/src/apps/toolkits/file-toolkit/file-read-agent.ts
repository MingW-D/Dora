import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import yaml from 'js-yaml';
import { BaseAgent } from '../../agent/base-agent.js';
import type { AgentTaskRef } from '../../agent/type.js';
import type { SpecializedToolAgent } from '../types.js';

export class FileReadAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'FileReadTool';

  description = 'A tool for reading file contents';

  parameters = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'File path to read' },
      encoding: {
        type: 'string',
        description: 'File encoding, defaults to utf-8',
        default: 'utf-8',
      },
    },
    required: ['filePath'],
  };

  strict = true;

  async execute(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<string> {
    const filePath = query.filePath as string;
    const encoding = (query.encoding as string) || 'utf-8';

    try {
      // Check if file exists
      const fileExists = await exists(filePath);
      if (!fileExists) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Read file content using Tauri plugin-fs
      const content = await readTextFile(filePath);

      return yaml.dump({
        success: true,
        content,
        path: filePath,
      });
    } catch (error) {
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
