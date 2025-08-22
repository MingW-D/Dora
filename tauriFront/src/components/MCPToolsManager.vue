<script setup lang="ts">
import { ref } from 'vue';
import { useMcpStore } from '../stores/mcpStore';

const mcpStore = useMcpStore();

const newToolJson = ref('');
const errorMessage = ref('');
const successMessage = ref('');

async function addTool() {
  if (!newToolJson.value.trim()) {
    errorMessage.value = 'JSON内容不能为空。';
    return;
  }
  try {
    await mcpStore.addMcpToolsFromJSON(newToolJson.value);
    successMessage.value = 'MCP工具添加成功！';
    newToolJson.value = '';
    errorMessage.value = '';
    setTimeout(() => successMessage.value = '', 3000);
  } catch (error) {
    errorMessage.value = `添加MCP工具失败: ${error instanceof Error ? error.message : String(error)}`;
    successMessage.value = '';
  }
}

async function deleteTool(name: string) {
  if (confirm(`确定要删除MCP工具"${name}"吗？`)) {
    await mcpStore.deleteMcpTool(name);
  }
}
</script>

<template>
  <div class="mcp-manager-container">
    <div class="mcp-manager-header">
      <h2>MCP工具管理</h2>
      <p>管理您的MCP（多功能程序）工具配置。</p>
    </div>

    <div class="mcp-add-tool">
      <h3>从JSON添加新工具</h3>
      <p>粘贴一个或多个工具的JSON配置。格式应为：<code>{"mcpServers": {"tool_name": ...}}</code></p>
      <textarea
        v-model="newToolJson"
        :placeholder='`例如：{\n  "mcpServers": {\n    "exa": {\n      "command": "cmd",\n      "args": ["/c", "npx", ...]\n    }\n  }\n}`'
        class="json-input"
      ></textarea>
      <button @click="addTool" class="add-btn">添加工具</button>
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <p v-if="successMessage" class="success-message">{{ successMessage }}</p>
    </div>

    <div class="mcp-tool-list">
      <h3>可用的MCP工具</h3>
      <div v-if="!mcpStore.mcpConfig.mcpServers || Object.keys(mcpStore.mcpConfig.mcpServers).length === 0" class="empty-list">
        暂无配置的MCP工具。
      </div>
      <div v-else>
        <ul class="tool-list-items">
          <li v-for="(tool, name) in mcpStore.mcpConfig.mcpServers" :key="name" class="tool-item">
            <div class="tool-info">
              <strong class="tool-name">{{ name }}</strong>
              <div class="tool-details">
                <code>{{ tool.command }} {{ tool.args.join(' ') }}</code>
              </div>
            </div>
            <button @click="deleteTool(name as string)" class="delete-btn-mcp">删除</button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-manager-container {
  padding: 24px;
  height: 100%;
  overflow-y: auto;
  background-color: #fff;
}

.mcp-manager-header {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 16px;
  margin-bottom: 24px;
}

.mcp-manager-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.mcp-manager-header p {
  color: var(--text-secondary);
}

.mcp-add-tool, .mcp-tool-list {
  margin-bottom: 32px;
}

h3 {
  font-size: 18px;
  font-weight: 500;
  margin-bottom: 12px;
}

.json-input {
  width: 100%;
  min-height: 150px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  resize: vertical;
  font-family: 'Courier New', Courier, monospace;
  background-color: var(--hover-bg);
  color: var(--text-primary);
  margin-bottom: 12px;
}

.add-btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  background-image: var(--gradient-blue);
  color: white;
  box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2);
}

.add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 8px rgba(99, 102, 241, 0.3);
}

.error-message {
  color: #ef4444;
  margin-top: 8px;
}

.success-message {
  color: #22c55e;
  margin-top: 8px;
}

.empty-list {
  color: var(--text-secondary);
  padding: 16px;
  text-align: center;
  background-color: var(--hover-bg);
  border-radius: 8px;
}

.tool-list-items {
  list-style: none;
  padding: 0;
}

.tool-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 8px;
  background-color: #f9fafb;
  border: 1px solid var(--border-color);
}

.tool-name {
  font-size: 16px;
  color: var(--primary-color);
  font-weight: 600;
}

.tool-details {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  background-color: var(--hover-bg);
  padding: 8px;
  border-radius: 4px;
  word-break: break-all;
}

.delete-btn-mcp {
  padding: 8px 16px;
  border-radius: 6px;
  border: none;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.delete-btn-mcp:hover {
  background-color: rgba(239, 68, 68, 0.2);
}

@media (prefers-color-scheme: dark) {
  .mcp-manager-container {
    background-color: var(--bg-color);
  }
  .tool-item {
    background-color: var(--sidebar-bg);
    border-color: var(--border-color);
  }
  .tool-details {
     background-color: var(--bg-color);
  }
}

</style> 