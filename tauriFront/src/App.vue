<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from "vue";
import databaseService, { type Conversation, type Message } from './services/database';
import { v4 as uuidv4 } from 'uuid';
import { useSettingsStore } from './stores/settingsStore';
import { useModelStore } from './stores/modelStore';
import { useMcpStore } from './stores/mcpStore';
import SettingsDialog from './components/SettingsDialog.vue';
import ModelDialog from './components/ModelDialog.vue';
import CodeBlock from './components/CodeBlock.vue';
import MarkdownRenderer from './components/MarkdownRenderer.vue';
import MCPToolsManager from './components/MCPToolsManager.vue';
import { parseMessage, isCodeBlock, isMarkdownBlock } from './utils/messageParser';
import { initWindowControls } from './services/windowControl';
import cacheManager from './services/cacheManager';
import LogPanel from './components/LogPanel.vue';
// 设置 store
const settingsStore = useSettingsStore();
const modelStore = useModelStore();
const mcpStore = useMcpStore();

// 窗口控制代码将在 onMounted 中使用 Tauri API 实现

// 侧边栏状态
const isSidebarCollapsed = ref(false);
const sidebarWidth = ref(280); // 默认宽度
const minSidebarWidth = 200; // 最小宽度
const isDragging = ref(false);

// 视图控制
const currentView = ref('chat'); // 'chat' or 'mcp'

// 对话数据
const chatList = ref<Conversation[]>([]);
const isLoading = ref(true);

// 当前选中的对话
const currentChatId = ref('');
const currentMessages = ref<Message[]>([]);

// 用户输入
const userInput = ref('');

// 消息容器引用
const messagesContainer = ref<HTMLElement | null>(null);

// 记忆窗口大小（可根据需要调整，-1为全部记忆，正整数为最近N轮）
const memoryWindowSize = ref(10); // 例如10轮记忆

// 添加到对话数据部分
const isGenerating = ref(false);
// 将isGenerating改为Map，以对话ID为键
const generatingChats = ref(new Map<string, boolean>());
// 添加请求控制器集合，用于管理每个会话的请求
const requestControllers = ref(new Map<string, AbortController>());
// 添加对话内容缓存，防止切换丢失
const conversationCache = ref(new Map<string, Message[]>());

// 添加编辑消息相关的状态
const editingMessageId = ref<string | null>(null);
const editingContent = ref('');

// 自动滚动到消息底部
function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

// 处理侧边栏折叠/展开
function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
}

// 处理侧边栏拖动调整宽度
function handleDragStart(e: MouseEvent) {
  isDragging.value = true;
  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);
}

function handleDragMove(e: MouseEvent) {
  if (!isDragging.value) return;
  const newWidth = e.clientX;
  
  if (newWidth >= minSidebarWidth) {
    sidebarWidth.value = newWidth;
  }
}

function handleDragEnd() {
  isDragging.value = false;
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);
}

// 打开MCP工具管理器
function openMcpManager() {
  currentView.value = 'mcp';
}

// 创建新对话
async function createNewChat() {
  // 切换前，确保未保存的数据落库
  try {
    await cacheManager.forceSyncAll();
  } catch (e) {
    console.warn('切换前强制同步失败，将继续创建新对话:', e);
  }

  // 使用缓存管理器创建对话（内部会创建数据库记录）
  const conv = await cacheManager.createConversation('新对话');

  // 更新历史列表（用 cache 元数据）
  chatList.value.unshift({
    id: conv.id,
    title: conv.metadata.title,
    created_at: conv.metadata.createdAt,
    updated_at: conv.metadata.updatedAt
  });

  // 切换到新对话
  currentChatId.value = conv.id;
  currentMessages.value = [];
  // 同步 UI 层的本地缓存
  conversationCache.value.set(conv.id, []);
  currentView.value = 'chat';
}

// 选择对话
async function selectChat(id: string) {
  try {
    // 切换前缓存当前对话的 UI 数据
    if (currentChatId.value && currentMessages.value.length > 0) {
      conversationCache.value.set(currentChatId.value, [...currentMessages.value]);
    }

    currentChatId.value = id;
    currentView.value = 'chat';

    // 使用缓存管理器读取会话（命中缓存或回源数据库）
    const cachedConv = await cacheManager.getConversation(id);
    if (cachedConv) {
      currentMessages.value = [...cachedConv.messages];
      conversationCache.value.set(id, [...cachedConv.messages]);
      console.log('通过 cacheManager 加载对话:', id);
    } else {
      // 兜底：保持原逻辑（通常不会走到这里）
      const messages = await databaseService.getMessages(id);
      currentMessages.value = messages;
      conversationCache.value.set(id, [...messages]);
      console.log('从数据库兜底加载对话:', id);
    }

    scrollToBottom();
  } catch (error) {
    console.error('加载对话消息失败:', error);
  }
}

// 删除对话
async function deleteChat(id: string, event: Event) {
  event.stopPropagation();
  
  try {
    // 通过缓存管理器删除（内部会删除数据库记录）
    await cacheManager.deleteConversation(id);
    
    // 更新本地状态
    chatList.value = chatList.value.filter(chat => chat.id !== id);
    
    // 从本地 UI 缓存中移除
    conversationCache.value.delete(id);
    
    // 如果删除的是当前选中的对话，则重置或选择另一个对话
    if (currentChatId.value === id) {
      currentChatId.value = chatList.value.length > 0 ? chatList.value[0].id : '';
      currentMessages.value = [];
      
      if (currentChatId.value) {
        await selectChat(currentChatId.value);
      }
    }
  } catch (error) {
    console.error('删除对话失败:', error);
  }
}

// 打开设置对话框
function openSettings() {
  settingsStore.openSettings();
}

// 新增：打开/关闭日志面板
function openLogs() {
  settingsStore.toggleLogPanel();
}

// 获取用于记忆的历史消息（带窗口）
function getMemoryMessages(): Message[] {
  // 创建一个副本，以便我们可以在不影响原始数据的情况下操作它
  let messages = [...currentMessages.value];
  
  // 如果最后一条消息是空的助手消息，则移除它（这是刚刚添加但尚未填充内容的消息）
  if (messages.length > 0 && messages[messages.length - 1].role === 'assistant' && !messages[messages.length - 1].content) {
    messages.pop();
  }
  
  // 应用记忆窗口
  if (memoryWindowSize.value >= 0) {
    // 只取最近N轮（每轮包含user和assistant各一条）
    const n = memoryWindowSize.value * 2;
    messages = messages.slice(-n);
  }
  
  return messages;
}

// 发送消息
async function sendMessage() {
  if (!userInput.value.trim()) return;

  const userMessage = {
    id: uuidv4(),
    conversation_id: currentChatId.value,
    role: 'user' as const,
    content: userInput.value,
    timestamp: Date.now()
  };

  // 添加用户消息到界面
  currentMessages.value.push(userMessage);
  
  // 同步 UI 层的本地缓存
  if (conversationCache.value.has(currentChatId.value)) {
    conversationCache.value.get(currentChatId.value)!.push(userMessage);
  } else {
    conversationCache.value.set(currentChatId.value, [...currentMessages.value]);
  }
  
  // 滚动到底部
  scrollToBottom();
  
  // 如果发送了第一条消息，更新对话标题（改为走 cacheManager）
  const conversation = chatList.value.find(chat => chat.id === currentChatId.value);
  if (conversation && conversation.title === '新对话') {
    const newTitle = userMessage.content.length > 20 
      ? userMessage.content.substring(0, 20) + '...'
      : userMessage.content;

    // 使用缓存管理器更新元数据（由异步同步器落库）
    cacheManager.updateConversation(currentChatId.value, {
      metadata: { title: newTitle }
    });

    // 更新本地对话列表
    conversation.title = newTitle;
    conversation.updated_at = Date.now();
  }
  
  // 使用缓存管理器添加用户消息（由异步同步器落库）
  await cacheManager.addMessage(currentChatId.value, userMessage);
  
  const question = userInput.value;
  userInput.value = '';

  // 创建AI消息
  const aiMessageId = uuidv4();
  const aiMessage = {
    id: aiMessageId,
    conversation_id: currentChatId.value,
    role: 'assistant' as const,
    content: '',
    timestamp: Date.now()
  };
  
  // 添加空的AI消息到界面
  currentMessages.value.push(aiMessage);
  
  // 更新本地缓存
  if (conversationCache.value.has(currentChatId.value)) {
    conversationCache.value.get(currentChatId.value)!.push(aiMessage);
  }

  // 通过缓存管理器登记 AI 消息（先插入空内容，后续流式更新）
  await cacheManager.addMessage(currentChatId.value, aiMessage);
  
  // 当前会话的ID，保存起来以便在异步操作中使用
  const currentConversationId = currentChatId.value;
  
  // 开始生成，显示加载动画
  generatingChats.value.set(currentConversationId, true);
  // 同步到缓存管理器（用于 LRU 保活）
  cacheManager.setGeneratingStatus(currentConversationId, true);
  
  // 生成AI回复
  try {
    // 传递记忆消息
    const memoryMessages = getMemoryMessages();
    
    // 确保每个会话只有一个活跃请求
    if (requestControllers.value.has(currentConversationId)) {
      // 如果已存在，中止之前的请求
      requestControllers.value.get(currentConversationId)?.abort();
    }
    
    // 创建新的控制器
    const controller = new AbortController();
    requestControllers.value.set(currentConversationId, controller);
    
    // 传递会话ID和消息ID，这样即使用户切换会话，也能更新正确的消息
    generateAIResponse(
      question, 
      aiMessageId, 
      memoryMessages, 
      currentConversationId,
      controller.signal
    ).then(responseText => {
      // 寻找对应的消息并更新
      updateMessageInConversation(currentConversationId, aiMessageId, responseText);
    }).catch(error => {
      console.error('生成AI回复失败:', error);
      
      // 只在请求未被用户主动取消的情况下显示错误
      if (error.name !== 'AbortError') {
        updateMessageInConversation(
          currentConversationId, 
          aiMessageId, 
          '抱歉，调用AI服务失败，请稍后再试。'
        );
      }
    }).finally(() => {
      // 移除请求控制器
      if (requestControllers.value.get(currentConversationId) === controller) {
        requestControllers.value.delete(currentConversationId);
      }
      
      // 结束生成状态
      generatingChats.value.set(currentConversationId, false);
      cacheManager.setGeneratingStatus(currentConversationId, false);
    });
  } catch (error) {
    console.error('初始化AI请求失败:', error);
    generatingChats.value.set(currentConversationId, false);
    cacheManager.setGeneratingStatus(currentConversationId, false);
    
    // 更新消息为错误状态
    updateMessageInConversation(
      currentConversationId, 
      aiMessageId, 
      '抱歉，无法初始化AI服务，请稍后再试。'
    );
  }
}

// 生成AI回复（带记忆）- 重构为完全独立的函数
async function generateAIResponse(
  question: string,
  aiMessageId: string,
  memoryMessages: Message[],
  conversationId: string,
  abortSignal: AbortSignal
): Promise<string> {
  // ... existing code ...
  try {
    // 构造messages数组，格式为OpenAI风格
    const messagesForModel = memoryMessages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // 获取当前模型配置
    const currentModel = modelStore.currentModel;
    if (!currentModel) {
      throw new Error('未选择模型或模型配置不存在');
    }

    // 使用POST请求发送数据并接收流式响应
    const response = await fetch('http://localhost:8000/generate/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        model_name: currentModel.model_name,
        url: currentModel.api_url,
        key: currentModel.api_key || '',
        messages: messagesForModel,
        maxTokens: currentModel.max_tokens,
        temperature: currentModel.temperature,
        prompt_template: currentModel.prompt_template,
        stream: true,
        mcp_config: mcpStore.mcpConfig.mcpServers
      }),
      signal: abortSignal
    });

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let hasReceivedContent = false;

      async function readStream() {
        try {
          const { done, value } = await reader.read();

          if (done) {
            if (hasReceivedContent && fullResponse) {
              try {
                await updateMessageInConversation(conversationId, aiMessageId, fullResponse, true);
                console.log('流结束，完整回复已保存到数据库', fullResponse.length, 'chars');
              } catch (e) {
                console.error('保存完整回复到数据库失败:', e);
              }
              resolve(fullResponse);
            } else {
              reject(new Error('未收到有效响应'));
            }
            return;
          }

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const eventData = line.slice(5).trim();
                if (eventData === '[DONE]') {
                  if (hasReceivedContent && fullResponse) {
                    await updateMessageInConversation(conversationId, aiMessageId, fullResponse, true);
                    console.log('收到[DONE]，完整回复已保存到数据库', fullResponse.length, 'chars');
                    resolve(fullResponse);
                  } else {
                    reject(new Error('未收到有效响应'));
                  }
                  return;
                }

                const data = JSON.parse(eventData);

                if (data.error) {
                  console.error('流式输出错误:', data.error);
                  reject(new Error(data.error));
                  return;
                }

                if (data.content) {
                  hasReceivedContent = true;
                  fullResponse += data.content;

                  await updateMessageInConversation(conversationId, aiMessageId, fullResponse, false);

                  if (generatingChats.value.get(conversationId)) {
                    generatingChats.value.set(conversationId, false);
                    cacheManager.setGeneratingStatus(conversationId, false);
                  }
                }
              } catch (e) {
                console.error('解析消息失败:', e);
              }
            }
          }

          readStream();
        } catch (error: any) {
          if (error.name === 'AbortError') {
            console.log('用户取消了请求');
            if (hasReceivedContent && fullResponse) {
              await updateMessageInConversation(conversationId, aiMessageId, fullResponse, true);
              console.log('请求被取消，但已保存部分回复', fullResponse.length, 'chars');
            }
            reject(error);
            return;
          }

          console.error('读取流失败:', error);
          if (hasReceivedContent && fullResponse) {
            await updateMessageInConversation(conversationId, aiMessageId, fullResponse, true);
            console.log('读取流失败，但已保存部分回复', fullResponse.length, 'chars');
            resolve(fullResponse);
          } else {
            reject(new Error('读取流失败'));
          }
        }
      }

      readStream();
    });
  } catch (error) {
    console.error('调用AI API失败:', error);
    throw error;
  }
  // ... existing code ...
}

// 更新指定会话中的消息
async function updateMessageInConversation(
  conversationId: string, 
  messageId: string, 
  content: string,
  forceDbUpdate: boolean = false
) {
  try {
    // 如果当前展示的正是这个会话，则更新UI
    if (currentChatId.value === conversationId) {
      const messageIndex = currentMessages.value.findIndex(msg => msg.id === messageId);
      if (messageIndex !== -1) {
        currentMessages.value[messageIndex].content = content;
        currentMessages.value[messageIndex].timestamp = Date.now();
        scrollToBottom();
      }
    }

    // 更新本地 UI 缓存
    if (conversationCache.value.has(conversationId)) {
      const cachedMessages = conversationCache.value.get(conversationId)!;
      const messageIndex = cachedMessages.findIndex(msg => msg.id === messageId);
      if (messageIndex !== -1) {
        cachedMessages[messageIndex].content = content;
        cachedMessages[messageIndex].timestamp = Date.now();
      } else {
        cachedMessages.push({
          id: messageId,
          conversation_id: conversationId,
          role: 'assistant',
          content: content,
          timestamp: Date.now()
        });
      }
    }

    // 使用缓存管理器更新消息（标记为脏数据，稍后批量同步）
    cacheManager.updateMessage(conversationId, messageId, content);

    // 仅在需要时强制立即同步（例如流结束时）
    if (forceDbUpdate) {
      await cacheManager.forceSyncAll();
      console.log('已将消息通过 cacheManager 同步到数据库:', messageId.substring(0, 6), 'length:', content.length);
    }
  } catch (error) {
    console.error('更新消息失败:', error);
  }
}

// 格式化时间
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', { 
    month: 'numeric', 
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  });
}



// 初始化数据库并加载对话列表
async function initDatabase() {
  try {
    isLoading.value = true;
    // 使用 cacheManager 初始化（内部会确保数据库初始化）
    await cacheManager.init();

    // 列表仍使用数据库读取，保持原有排序与展示逻辑
    chatList.value = await databaseService.getConversations();

    // 如果有对话，选择第一个
    if (chatList.value.length > 0) {
      await selectChat(chatList.value[0].id);
    }
  } catch (error) {
    console.error('初始化数据库失败:', error);
  } finally {
    isLoading.value = false;
  }
}

// 在组件挂载时初始化
onMounted(() => {
  initDatabase();
  modelStore.loadModelConfigs();
  mcpStore.loadMcpConfigs();
  // 新增：加载设置（包含开发者模式），并在开启时初始化日志拦截
  settingsStore.loadSettings();
  
  // 初始化窗口控制
  initWindowControls();
});

// 监听消息列表变化，滚动到底部
watch(() => currentMessages.value.length, () => {
  scrollToBottom();
});

// 复制消息内容
async function copyMessageContent(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    // 可以添加一个提示，表示复制成功
  } catch (error) {
    console.error('复制失败:', error);
  }
}

// 开始编辑消息
function startEditMessage(message: Message) {
  editingMessageId.value = message.id;
  editingContent.value = message.content;
}

// 取消编辑消息
function cancelEditMessage() {
  editingMessageId.value = null;
  editingContent.value = '';
}

// 保存编辑的消息并发送
async function saveAndResendMessage() {
  if (!editingContent.value.trim()) return;
  
  const messageId = editingMessageId.value;
  if (!messageId) return;

  // 找到原始消息的索引
  const messageIndex = currentMessages.value.findIndex(msg => msg.id === messageId);
  if (messageIndex === -1) return;

  // 直接发送编辑后的新消息，不删除原有内容
  userInput.value = editingContent.value;
  await sendMessage();

  // 重置编辑状态
  cancelEditMessage();
}
</script>

<template>
  <!-- 简化的标题栏 -->
  <div class="titlebar">
    <div class="app-logo">DoraAI</div>
    <div class="titlebar-controls">
      <!-- 新增：开发者日志按钮（开发者模式开启时显示） -->
      <button 
        v-if="settingsStore.settings.developerMode" 
        class="window-control logs" 
        @click="openLogs"
        title="开发者日志"
      >
        <svg width="14" height="14" viewBox="0 0 24 24">
          <path d="M3 5h18v14H3V5zm2 2v10h14V7H5zm2 2h6v2H7V9zm0 4h10v2H7v-2z" fill="currentColor"/>
        </svg>
      </button>
      <button class="window-control settings" @click="openSettings">
        <svg width="14" height="14" viewBox="0 0 24 24">
          <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" fill="black" />
        </svg>
      </button>
      <button id="titlebar-minimize" class="window-control minimize">
        <svg width="10" height="1" viewBox="0 0 10 1">
          <path d="M0 0h10v1H0z" fill="currentColor" />
        </svg>
      </button>
      <button id="titlebar-maximize" class="window-control maximize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" />
        </svg>
      </button>
      <button id="titlebar-close" class="window-control close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M6.4 5l3.3-3.3c.4-.4.4-1 0-1.4-.4-.4-1-.4-1.4 0L5 3.6 1.7.3C1.3-.1.7-.1.3.3c-.4.4-.4 1 0 1.4L3.6 5 .3 8.3c-.4.4-.4 1 0 1.4.2.2.5.3.7.3.2 0 .5-.1.7-.3L5 6.4l3.3 3.3c.2.2.5.3.7.3.2 0 .5-.1.7-.3.4-.4.4-1 0-1.4L6.4 5z" fill="currentColor" />
        </svg>
      </button>
    </div>
  </div>
  
  <div class="app-container">
    <!-- 侧边栏 -->
    <div 
      class="sidebar" 
      :class="{ collapsed: isSidebarCollapsed }"
      :style="{ width: isSidebarCollapsed ? '60px' : sidebarWidth + 'px' }"
    >
      <div class="sidebar-header" :class="{ 'collapsed-header': isSidebarCollapsed }">
        <button class="new-chat-btn" @click="createNewChat" v-if="!isSidebarCollapsed">
          <span class="icon">+</span>
          <span class="text">新建对话</span>
        </button>
        <button class="sidebar-toggle" @click="toggleSidebar">
          <svg v-if="isSidebarCollapsed" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8.59 16.59L13.17 12L8.59 7.41L10 6L16 12L10 18L8.59 16.59Z" fill="currentColor"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M15.41 16.59L10.83 12L15.41 7.41L14 6L8 12L14 18L15.41 16.59Z" fill="currentColor"/>
          </svg>
        </button>
      </div>
      
      <!-- 添加收缩状态下的新建对话按钮 -->
      <div v-if="isSidebarCollapsed" class="collapsed-new-chat-container">
        <button class="new-chat-btn collapsed-btn" @click="createNewChat">
          <span class="icon">+</span>
        </button>
      </div>
      
      <div class="chat-list" v-if="!isSidebarCollapsed">
        <div class="sidebar-actions">
          <button class="mcp-tool-btn" @click="openMcpManager">
            <span class="icon">🔧</span>
            <span class="text">MCP工具</span>
          </button>
        </div>
        <div v-if="isLoading" class="loading-state">
          正在加载对话历史...
        </div>
        
        <div v-else-if="chatList.length === 0" class="empty-list">
          没有历史对话
        </div>
        
        <div 
          v-else
          v-for="chat in chatList" 
          :key="chat.id"
          class="chat-item"
          :class="{ active: currentChatId === chat.id }"
          @click="selectChat(chat.id)"
        >
          <div class="chat-info">
            <div class="chat-title">{{ chat.title }}</div>
            <div class="chat-time">{{ formatTime(chat.updated_at) }}</div>
          </div>
          <button class="delete-btn" @click="(e) => deleteChat(chat.id, e)">
            <span class="icon">×</span>
          </button>
        </div>
      </div>
      
      <!-- 拖拽调整宽度的把手 -->
      <div 
        class="resize-handle"
        v-if="!isSidebarCollapsed"
        @mousedown="handleDragStart"
      ></div>
    </div>
    
    <!-- 主内容区 -->
    <div class="main-content">
      <MCPToolsManager v-if="currentView === 'mcp'" />
      <div v-else-if="currentChatId || currentMessages.length > 0" class="chat-container">
        <div class="chat-header">
          <div class="chat-title">
            {{ chatList.find(chat => chat.id === currentChatId)?.title || '新对话' }}
          </div>
          <div class="chat-actions">
            <div class="model-selector" v-if="modelStore.isConfigsLoaded && modelStore.modelConfigs.length > 0">
              <select v-model="modelStore.currentModelId" class="model-select">
                <option 
                  v-for="model in modelStore.modelConfigs" 
                  :key="model.id" 
                  :value="model.id"
                >
                  {{ model.name }}
                </option>
              </select>
            </div>
          </div>
        </div>
        <div class="messages-container" ref="messagesContainer">
          <div v-if="currentMessages.length === 0" class="empty-placeholder">
            这是新对话的开始，请输入您的问题
          </div>
          <div v-else class="message-list">
            <div 
              v-for="message in currentMessages" 
              :key="message.id"
              class="message"
              :class="message.role"
            >
              <div class="message-content">
                <div v-if="editingMessageId === message.id" class="edit-message-container">
                  <textarea 
                    v-model="editingContent"
                    class="edit-message-input"
                    @keydown.enter.prevent="saveAndResendMessage"
                  ></textarea>
                  <div class="edit-message-actions">
                    <button class="edit-action-btn save" @click="saveAndResendMessage">发送</button>
                    <button class="edit-action-btn cancel" @click="cancelEditMessage">取消</button>
                  </div>
                </div>
                    <div v-else class="message-content-wrapper">
      <div class="message-text">
        <template v-for="(block, index) in parseMessage(message.content)" :key="index">
          <CodeBlock v-if="isCodeBlock(block)" :code="block.code" :language="block.language" />
          <MarkdownRenderer v-else-if="isMarkdownBlock(block)" :content="block.content" />
        </template>
      </div>
      <!-- 加载动画，仅当是最后一条消息且是AI角色且内容为空且正在生成时显示 -->
      <div v-if="message.role === 'assistant' && !message.content && generatingChats.get(currentChatId) && message.id === currentMessages[currentMessages.length - 1].id" 
           class="loading-dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
      <div class="message-info">
        <div class="message-time">{{ formatTime(message.timestamp) }}</div>
        <div class="message-actions">
          <button 
            class="action-btn copy" 
            @click="copyMessageContent(message.content)"
            title="复制"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z" fill="currentColor"/>
            </svg>
          </button>
          <button 
            v-if="message.role === 'user'"
            class="action-btn edit" 
            @click="startEditMessage(message)"
            title="编辑"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25ZM20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
              </div>
            </div>
          </div>
        </div>
        <div class="input-container">
          <textarea 
            v-model="userInput" 
            placeholder="输入消息..." 
            class="message-input"
            @keydown.enter.prevent="sendMessage"
          ></textarea>
          <button class="send-btn" @click="sendMessage" :disabled="generatingChats.get(currentChatId)">发送</button>
        </div>
      </div>
      <div v-else class="empty-state">
        <h2>欢迎使用Poly.AI</h2>
        <p>选择一个对话或创建新对话开始</p>
        <div class="buttons-container">
          <button class="new-chat-btn-large" @click="createNewChat">
            <span class="icon">+</span>
            <span class="text">新建对话</span>
          </button>
          <button class="settings-btn-large" @click="openSettings">
            <span class="icon">⚙️</span>
            <span class="text">设置</span>
          </button>
        </div>
      </div>
    </div>
    
    <!-- 设置对话框 -->
    <SettingsDialog />
    
    <!-- 模型配置对话框 -->
    <ModelDialog />

    <!-- 新增：开发者日志面板 -->
    <LogPanel />
  </div>
</template>

<style>
/* 这些样式已移至 style.css */
.app-container {
  display: flex;
  height: calc(100vh - 40px); /* 减去标题栏高度 */
  width: 100%;
  overflow: hidden;
  border-radius: 12px 12px 12px 12px; /* 只保留底部圆角 */
  background-color: var(--bg-color);
}
</style>

<style scoped>
/* 侧边栏样式 */
.sidebar {
  height: 100%;
  background-color: #f5f5f5;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  position: relative;
  transition: width 0.3s ease;
  overflow: hidden;
  border-radius: 12px;
}

.sidebar.collapsed {
  width: 60px !important;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 0px solid var(--border-color);
}

.sidebar-header.collapsed-header {
  justify-content: center;
  padding: 16px 0;
}

.app-logo {
  font-weight: 700;
  font-size: 22px;
  background: var(--gradient-blue);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  flex: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.sidebar-toggle {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  border: 0px solid rgba(255, 255, 255, 0.2);
  background-color: rgba(99, 102, 241, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 16px;
  font-weight: bold;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.sidebar-toggle:hover {
  background-color: var(--primary-color);
  transform: translateY(-1px);
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15);
}

.new-chat-container {
  padding: 16px;
}

.new-chat-btn {
  flex: 1;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  background-image: var(--gradient-blue);
  color: white;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.3s;
  box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2);
  margin-right: 8px;
}

.new-chat-btn:hover {
  background-image: linear-gradient(135deg, #6366f1, #4f46e5);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px rgba(99, 102, 241, 0.3);
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

.loading-state, .empty-list {
  padding: 16px;
  text-align: center;
  color: var(--text-secondary);
}

.chat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.chat-item:hover {
  background-color: var(--hover-bg);
}

.chat-item.active {
  background-image: linear-gradient(to right, #e5e7eb, #f3f4f6);
  border-left: 3px solid var(--primary-color);
  box-shadow: 0 2px 4px rgba(99, 102, 241, 0.1);
}

.chat-info {
  flex: 1;
  overflow: hidden;
}

.chat-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-time {
  font-size: 12px;
  color: var(--text-secondary);
}

.delete-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background-color: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  opacity: 0.6;
}

.delete-btn:hover {
  background-color: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  opacity: 1;
}

.resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  width: 4px;
  height: 100%;
  background-color: transparent;
  cursor: col-resize;
  transition: background-color 0.2s;
}

.resize-handle:hover, .resize-handle:active {
  background-color: var(--primary-light);
}

/* 主内容区域样式 */
.main-content {
  flex: 1;
  height:100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #ffffff;
}

.chat-header {
  padding: 16px;
  border-bottom: 0px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #ffffff;
}

.chat-title {
  font-weight: 600;
  color: var(--text-primary);
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-selector {
  position: relative;
}

.model-select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background: none;
  border: 1px solid var(--border-color);
  padding: 6px 28px 6px 12px;
  font-size: 14px;
  color: var(--text-primary);
  background-color: var(--hover-bg);
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='gray'><polygon points='0,0 12,0 6,8'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
}

.model-select:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.settings-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background-color: rgba(99, 102, 241, 0.1);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-primary);
  transition: all 0.3s;
  box-shadow: 0 2px 4px rgba(99, 102, 241, 0.1);
}

.settings-btn:hover {
  background-color: var(--hover-bg);
}

.settings-icon {
  font-size: 16px;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
}

.empty-placeholder {
  margin: auto;
  text-align: center;
  color: var(--text-secondary);
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 12px;
  position: relative;
}

.message.user {
  align-self: flex-end;
  background-image: var(--gradient-blue);
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 3px 8px rgba(99, 102, 241, 0.2);
}

.message.assistant {
  align-self: flex-start;
  background-color: #f3f4f6;
  background-image: linear-gradient(to right, #e5e7eb, #f3f4f6);
  border-bottom-left-radius: 4px;
  box-shadow: 0 2px 5px rgba(99, 102, 241, 0.1);
}

.message-content {
  position: relative;
  margin-bottom: 4px;
  white-space: pre-wrap;
}

.message-text {
  margin-bottom: 8px;
  width: 100%;
}

.message-text {
  width: 100%;
}

.message-content-wrapper {
  position: relative;
  width: 100%;
}

.message-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding: 4px 0;
  width: 100%;
}

.message-time {
  font-size: 11px;
  opacity: 0.8;
}

.message-actions {
  display: flex;
  gap: 6px;
}

.action-btn {
  padding: 4px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: background 0.2s, color 0.2s;
}

.action-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  color: var(--primary-color);
}

.message.user .action-btn {
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-color: rgba(255, 255, 255, 0.3);
}

.message.user .action-btn:hover {
  background: rgba(255, 255, 255, 0.4);
  color: white;
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
  .action-btn {
    background: rgba(60, 60, 60, 0.8);
    color: rgba(255, 255, 255, 0.8);
    border-color: rgba(255, 255, 255, 0.1);
  }
  
  .action-btn:hover {
    background: rgba(80, 80, 80, 0.9);
    color: white;
  }
}

/* 移除不再使用的样式 */
.message-buttons, .message-footer {
  display: none;
}

.action-text {
  display: none;
}

.input-container {
  padding: 16px;
  border-top: 0px solid var(--border-color);
  display: flex;
  gap: 12px;
  background-color: #ffffff;
}

.message-input {
  flex: 1;
  padding: 12px;
  border-radius: 8px;
  border: 0px solid var(--border-color);
  resize: none;
  height: 80px;
  font-family: inherit;
  background-color: var(--bg-color);
  color: var(--text-primary);
}

.message-input::placeholder {
  color: var(--text-secondary);
}

.send-btn {
  align-self: flex-end;
  padding: 0 20px;
  height: 40px;
  background-image: var(--gradient-blue);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2);
}

.send-btn:hover {
  background-image: linear-gradient(135deg, #6366f1, #4f46e5);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px rgba(99, 102, 241, 0.3);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  gap: 16px;
}

.buttons-container {
  display: flex;
  gap: 12px;
}

.new-chat-btn-large, .settings-btn-large {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.new-chat-btn-large {
  background-image: var(--gradient-blue);
  color: white;
  box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2);
  transition: all 0.3s;
}

.new-chat-btn-large:hover {
  background-image: linear-gradient(135deg, #6366f1, #4f46e5);
  transform: translateY(-1px);
  box-shadow: 0 6px 8px rgba(99, 102, 241, 0.3);
}

.settings-btn-large {
  background-color: var(--hover-bg);
  color: var(--text-primary);
}

.settings-btn-large:hover {
  background-color: var(--border-color);
}

/* 加载动画样式 */
.loading-dots {
  display: inline-flex;
  align-items: center;
  padding-left: 4px;
}

.dot {
  width: 6px;
  height: 6px;
  margin: 0 2px;
  background-color: #999;
  border-radius: 50%;
  display: inline-block;
  animation: dotBounce 1.4s infinite ease-in-out;
}

.dot:nth-child(1) {
  animation-delay: 0s;
}

.dot:nth-child(2) {
  animation-delay: 0.2s;
}

.dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dotBounce {
  0%, 60%, 100% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-4px);
  }
}

/* 禁用状态的发送按钮 */
.send-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}

/* 暗色模式 */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #111827;
    --sidebar-bg: #1f2937;
    --text-primary: #f9fafb;
    --text-secondary: #9ca3af;
    --border-color: #374151;
    --hover-bg: #374151;
    --active-bg: #3730a3;
  }
  
  .message.assistant {
    background-color: #374151;
  }
  
  .message-input {
    background-color: var(--sidebar-bg);
  }
  
  .dot {
    background-color: #ccc;
  }
  
  .send-btn:disabled {
    background-color: #555;
  }
}

/* 标题栏设置按钮 */
.window-control.settings {
  color: white;
  background-color: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s;
  margin-right: 15px;
}

.window-control.settings:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.window-control.settings svg {
  width: 20px;
  height: 20px;
}

/* 添加媒体查询以确保在小屏幕上折叠侧边栏时正确显示按钮 */
@media (max-width: 768px) {
  .sidebar.collapsed {
    width: 60px !important;
  }
  
  .sidebar-toggle {
    display: flex !important;
  }
}

.new-chat-btn.collapsed-btn {
  width: 40px;
  height: 40px;
  margin: 10px auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2);
}

.new-chat-btn.collapsed-btn .icon {
  font-size: 20px;
  margin: 0;
}

.new-chat-btn .icon {
  font-size: 16px;
  margin-right: 4px;
}

.collapsed-new-chat-container {
  display: flex;
  justify-content: center;
  padding: 16px 10px;
  margin-top: 10px;
}

.new-chat-btn.collapsed-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  background-image: var(--gradient-blue);
  box-shadow: 0 4px 6px rgba(99, 102, 241, 0.2);
}

.new-chat-btn.collapsed-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 8px rgba(99, 102, 241, 0.3);
}

.message-actions {
  position: relative;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 4px;
  opacity: 1;
  transition: opacity 0.2s;
}

.message:hover .message-actions {
  opacity: 1;
}

.edit-message-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-message-input {
  width: 100%;
  min-height: 60px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-family: inherit;
  font-size: inherit;
  resize: vertical;
  background: white;
}

.edit-message-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.edit-action-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.edit-action-btn.save {
  background: var(--primary-color);
  color: white;
}

.edit-action-btn.cancel {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.edit-action-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
  .action-btn {
    background: rgba(0, 0, 0, 0.2);
    color: rgba(255, 255, 255, 0.8);
  }
  
  .action-btn:hover {
    background: rgba(0, 0, 0, 0.3);
    color: white;
  }
  
  .edit-message-input {
    background: var(--sidebar-bg);
    color: var(--text-primary);
    border-color: var(--border-color);
  }
}

.sidebar-actions {
  padding: 0 8px 8px 8px;
}

.mcp-tool-btn {
  width: 100%;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background-color: transparent;
  color: var(--text-primary);
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.3s;
}

.mcp-tool-btn:hover {
  background-color: var(--hover-bg);
  border-color: var(--primary-color);
}

.mcp-tool-btn .icon {
  font-size: 16px;
}

/* 可选：日志按钮高亮 */
.window-control.logs {
  background-color: rgba(99, 102, 241, 0.12);
}
.window-control.logs:hover {
  background-color: rgba(99, 102, 241, 0.2);
}
</style>