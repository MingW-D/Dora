import { defineStore } from 'pinia';
import { ref } from 'vue';
import { readTextFile, writeTextFile, create, exists } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { join } from '@tauri-apps/api/path';

export interface McpServer {
  command: string;
  args: string[];
}

export interface McpConfig {
  mcpServers: {
    [key: string]: McpServer;
  };
}

// Tool execution interfaces
export interface McpToolExecution {
  toolName: string;
  toolOutput: string;
  isLoading: boolean;
  needConfirmation: boolean;
}

const MCP_CONFIG_FILE = 'mcp_config.json';

export const useMcpStore = defineStore('mcp', () => {
  const mcpConfig = ref<McpConfig>({ mcpServers: {} });
  const isLoaded = ref(false);
  
  // Tool execution states
  const currentToolExecution = ref<McpToolExecution | null>(null);
  const isPendingConfirmation = ref(false);
  const toolConfirmationResolve = ref<((value: boolean) => void) | null>(null);
  const toolConfirmationReject = ref<((reason?: any) => void) | null>(null);

  async function getConfigPath() {
    const dataDir = await appDataDir();
    return await join(dataDir, MCP_CONFIG_FILE);
  }
  
  async function loadMcpConfigs() {
    try {
        const dataDir = await appDataDir();
        if (!(await exists(dataDir))) {
            await create(dataDir); // Create the directory if it doesn't exist
        }
        
        const configPath = await getConfigPath();
        if (await exists(configPath)) {
            const content = await readTextFile(configPath);
            if (content) {
              mcpConfig.value = JSON.parse(content);
            } else {
              mcpConfig.value = { mcpServers: {} };
              await saveMcpConfigs();
            }
        } else {
            // Create a default empty file
            mcpConfig.value = { mcpServers: {} };
            await saveMcpConfigs();
        }
        isLoaded.value = true;
    } catch (error) {
      console.error('Failed to load MCP configs:', error);
      mcpConfig.value = { mcpServers: {} }; // Reset to a safe default
    }
  }

  async function saveMcpConfigs() {
    try {
      const configPath = await getConfigPath();
      await writeTextFile(configPath, JSON.stringify(mcpConfig.value, null, 2));
    } catch (error) {
      console.error('Failed to save MCP configs:', error);
    }
  }

  async function addMcpTool(name: string, tool: McpServer) {
    if (!mcpConfig.value.mcpServers) {
      mcpConfig.value.mcpServers = {};
    }
    mcpConfig.value.mcpServers[name] = tool;
    await saveMcpConfigs();
  }

  async function addMcpToolsFromJSON(jsonString: string) {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        if (!mcpConfig.value.mcpServers) {
            mcpConfig.value.mcpServers = {};
        }
        for (const key in parsed.mcpServers) {
          if (Object.prototype.hasOwnProperty.call(parsed.mcpServers, key)) {
            const tool = parsed.mcpServers[key];
            // Basic validation
            if (tool.command && Array.isArray(tool.args)) {
                mcpConfig.value.mcpServers[key] = tool;
            }
          }
        }
        await saveMcpConfigs();
      } else {
        throw new Error("Invalid JSON format. Expected a root object with an 'mcpServers' property.");
      }
    } catch (error) {
      console.error('Error adding MCP tools from JSON:', error);
      throw error; // re-throw to be caught in the component
    }
  }

  async function deleteMcpTool(name: string) {
    if (mcpConfig.value.mcpServers && mcpConfig.value.mcpServers[name]) {
      delete mcpConfig.value.mcpServers[name];
      await saveMcpConfigs();
    }
  }

  // Tool execution functions
  function setToolExecution(toolName: string) {
    currentToolExecution.value = {
      toolName,
      toolOutput: '',
      isLoading: true,
      needConfirmation: true
    };
  }

  function updateToolOutput(output: string) {
    if (currentToolExecution.value) {
      currentToolExecution.value.toolOutput += output;
    }
  }

  function completeToolExecution() {
    if (currentToolExecution.value) {
      currentToolExecution.value.isLoading = false;
    }
  }

  function resetToolExecution() {
    currentToolExecution.value = null;
    isPendingConfirmation.value = false;
    toolConfirmationResolve.value = null;
    toolConfirmationReject.value = null;
  }

  // Returns a promise that resolves when the user confirms or rejects the tool execution
  function waitForConfirmation(): Promise<boolean> {
    if (!currentToolExecution.value) {
      return Promise.resolve(true); // No tool execution to confirm
    }

    isPendingConfirmation.value = true;

    return new Promise<boolean>((resolve, reject) => {
      toolConfirmationResolve.value = resolve;
      toolConfirmationReject.value = reject;
    });
  }

  // Called when user confirms tool execution
  function confirmToolExecution() {
    if (toolConfirmationResolve.value) {
      toolConfirmationResolve.value(true);
      resetToolExecution();
    }
  }

  // Called when user cancels tool execution
  function cancelToolExecution() {
    if (toolConfirmationReject.value) {
      toolConfirmationReject.value(new Error('Tool execution cancelled by user'));
      resetToolExecution();
    }
  }

  return {
    mcpConfig,
    isLoaded,
    loadMcpConfigs,
    addMcpTool,
    addMcpToolsFromJSON,
    deleteMcpTool,
    // Tool execution states
    currentToolExecution,
    isPendingConfirmation,
    // Tool execution functions
    setToolExecution,
    updateToolOutput,
    completeToolExecution,
    resetToolExecution,
    waitForConfirmation,
    confirmToolExecution,
    cancelToolExecution
  };
}); 