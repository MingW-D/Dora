import { readDir, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import * as tauriPath from '@tauri-apps/api/path';
import yaml from 'js-yaml';
import { BaseAgent } from '../../agent/base-agent.js';
import type { AgentTaskRef } from '../../agent/type.js';
import type { SpecializedToolAgent } from '../types.js';

interface FileEntry {
  name: string;
  type: 'file';
  path: string;
}

interface DirectoryEntry {
  name: string;
  type: 'directory';
  path: string;
  children: Array<FileEntry | DirectoryEntry>;
}

type FileSystemEntry = FileEntry | DirectoryEntry;
type RecursiveResult = Array<FileSystemEntry>;

// Helper interface for Tauri readDir result
interface TauriDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
  children?: TauriDirEntry[];
}

export class DirectoryListAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'DirectoryListTool';

  description = 'A tool for listing directory contents';

  parameters = {
    type: 'object',
    properties: {
      dirPath: { type: 'string', description: 'Directory path to list contents from' },
      recursive: {
        type: 'boolean',
        description: 'Whether to recursively list subdirectory contents, defaults to false',
        default: false,
      },
    },
    required: ['dirPath'],
  };

  strict = true;

  async execute(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<string> {
    const dirPath = query.dirPath as string;
    const recursive = Boolean(query.recursive);

    try {
      // Check if directory exists
      const dirExists = await exists(dirPath);
      if (!dirExists) {
        throw new Error(`Directory does not exist: ${dirPath}`);
      }

      if (recursive) {
        const result = await this.listRecursive(dirPath);
        return yaml.dump(result);
      }

      // For non-recursive listing, use readDir with recursive: false
      const entries = await readDir(dirPath, { recursive: false });
      
      const result = entries.map((entry: TauriDirEntry) => ({
        name: entry.name,
        type: entry.isDirectory ? 'directory' : 'file',
        path: entry.path,
      }));

      return yaml.dump(result);
    } catch (error) {
      throw new Error(`Failed to list directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async listRecursive(dirPath: string): Promise<RecursiveResult> {
    try {
      // Read directory with recursive option
      const entries = await readDir(dirPath, { recursive: true });
      
      // Convert flat list with children to nested structure
      return this.buildNestedStructure(entries);
    } catch (error) {
      throw new Error(`Failed to recursively list directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildNestedStructure(entries: TauriDirEntry[]): RecursiveResult {
    const result: RecursiveResult = [];
    
    for (const entry of entries) {
      if (entry.isDirectory) {
        const dirEntry: DirectoryEntry = {
          name: entry.name,
          type: 'directory',
          path: entry.path,
          children: entry.children ? this.buildNestedStructure(entry.children) : [],
        };
        result.push(dirEntry);
      } else {
        const fileEntry: FileEntry = {
          name: entry.name,
          type: 'file',
          path: entry.path,
        };
        result.push(fileEntry);
      }
    }
    
    return result;
  }
}
