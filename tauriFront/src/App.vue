<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue";
import databaseService, { type Conversation, type Message } from './services/database';
import { v4 as uuidv4 } from 'uuid';
import { useSettingsStore } from './stores/settingsStore';
import { useModelStore } from './stores/modelStore';
import { useMcpStore } from './stores/mcpStore';
import SettingsDialog from './components/SettingsDialog.vue';
import ModelDialog from './components/ModelDialog.vue';
import ModelSelector from './components/ModelSelector.vue';
import CodeBlock from './components/CodeBlock.vue';
import MarkdownRenderer from './components/MarkdownRenderer.vue';
import MCPToolsManager from './components/MCPToolsManager.vue';
import StudioPane from './components/StudioPane.vue';

import SubTaskDisplay from './components/SubTaskDisplay.vue';
import { studioBus, type StudioAction } from './services/studioBus';
import { parseMessage, isCodeBlock, isMarkdownBlock } from './utils/messageParser';
import { initWindowControls } from './services/windowControl';
import cacheManager, { type MessageContentBlock } from './services/cacheManager';

import LogPanel from './components/LogPanel.vue';
import TaskModeSelector, { type TaskMode } from './components/TaskModeSelector.vue';


import { tokenCounter, type TokenStats, type TokenUsage } from './apps/utils/token-counter';
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


// 将isGenerating改为Map，以对话ID为键
const generatingChats = ref(new Map<string, boolean>());
const isCurrentGenerating = computed(() => !!generatingChats.value.get(currentChatId.value));
// 添加请求控制器集合，用于管理每个会话的请求
const requestControllers = ref(new Map<string, AbortController>());
// 添加对话内容缓存，防止切换丢失
const conversationCache = ref(new Map<string, Message[]>());

// Token usage tracking
const perMessageUsage = ref<Record<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated?: boolean }>>({});
const tokenStats = ref<TokenStats>(tokenCounter.getStats());
const currentConversationTokenTotal = computed(() => {
  let sum = 0;
  for (const msg of currentMessages.value) {
    const u = perMessageUsage.value[msg.id];
    if (u) {
      sum += u.total_tokens || 0;
    }
  }
  return sum;
});

// 按消息计算“截至该条”的累计总 tokens
function getCumulativeTotalForMessage(messageId: string): number {
  let sum = 0;
  for (const m of currentMessages.value) {
    const u = perMessageUsage.value[m.id];
    if (u) sum += u.total_tokens || 0;
    if (m.id === messageId) break;
  }
  return sum;
}

// 添加编辑消息相关的状态
const editingMessageId = ref<string | null>(null);
const editingContent = ref('');

// 计划步骤折叠状态管理
const collapsedPlanSteps = ref(new Map<string, boolean>()); // messageId -> collapsed state
const planStepStatuses = ref(new Map<string, Map<number, 'pending' | 'running' | 'completed' | 'failed'>>()); // messageId -> stepId -> status


// User Agent消息折叠状态管理
const collapsedUserAgents = ref(new Map<string, boolean>()); // blockId -> collapsed state

// Assistant Agent消息折叠状态管理
const collapsedAssistantAgents = ref(new Map<string, boolean>()); // blockId -> collapsed state

// 任务处理模式
const taskMode = ref<TaskMode>('auto'); // 'agent' | 'ask' | 'auto'

// Studio dock collapsed state
const isStudioCollapsed = ref(true);
let studioSubscription: { unsubscribe: () => void } | null = null;
function toggleStudio() {
  isStudioCollapsed.value = !isStudioCollapsed.value;
}

// Scroll-to-bottom behavior for messages
const isAtBottom = ref(true);       // 当前是否在底部附近
const isFollowing = ref(true);      // 是否自动跟随底部
const scrollDetectionThreshold = 60; // px，判定“接近底部”的阈值

function handleMessagesScroll() {
  const el = messagesContainer.value;
  if (!el) return;
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - scrollDetectionThreshold;
  isAtBottom.value = nearBottom;
  // 用户向上滚动，关闭自动跟随；滚回底部则重新开启
  isFollowing.value = nearBottom;
}

function jumpToBottom() {
  isFollowing.value = true;
  scrollToBottom(true);
}

// 自动滚动到消息底部
function scrollToBottom(force: boolean = false) {
  nextTick(() => {
    const el = messagesContainer.value;
    if (!el) return;
    if (force || isFollowing.value) {
      el.scrollTop = el.scrollHeight;
      isAtBottom.value = true;
    }
  });
}

// 处理侧边栏折叠/展开
function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
}

// 处理侧边栏拖动调整宽度
function handleDragStart(_e: MouseEvent) {
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

// 手动停止当前会话的生成
function stopGeneration() {
  const id = currentChatId.value;
  if (!id) return;
  const controller = requestControllers.value.get(id);
  if (controller) {
    try { controller.abort(); } catch {}
    requestControllers.value.delete(id);
  }
  generatingChats.value.set(id, false);
  cacheManager.setGeneratingStatus(id, false);
}

// 创建新对话
async function createNewChat() {
  // 切换前，确保未保存的数据落库
  try {
    await cacheManager.forceSyncAll();
  } catch (error) {
    console.warn('切换前强制同步失败，将继续创建新对话:', error);
  }

  // 使用缓存管理器创建对话（内部会创建数据库记录）
  const conv = await cacheManager.createConversation('新对话');
  // 重置会话 token 统计（使用全局 tokenCounter）
  try { tokenCounter.resetCurrentSession(); } catch {}

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
  if (isCurrentGenerating.value) {
    // 阻止在生成中再次发送
    return;
  }
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
    const cachedConv = await cacheManager.getConversation(currentChatId.value);
    if (cachedConv) {
      cacheManager.updateConversation(currentChatId.value, {
        metadata: { 
          ...cachedConv.metadata,
          title: newTitle,
          updatedAt: Date.now()
        }
      });
    }

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

  // 初始化本轮的 prompt token 估算（在流开始前立即显示）
  try {
    const mem = getMemoryMessages();
    const promptEstimate = estimatePromptTokens(mem);
    perMessageUsage.value[aiMessageId] = {
      prompt_tokens: promptEstimate,
      completion_tokens: 0,
      total_tokens: promptEstimate,
      estimated: true,
    };
  } catch {}
  
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

// 生成AI回复（带记忆）- 直接调用多智能体框架
async function generateAIResponse(
  question: string,
  aiMessageId: string,
  _memoryMessages: Message[],
  conversationId: string,
  abortSignal: AbortSignal
): Promise<string> {
  try {
    let fullResponse = '';

    // 准备内容块存储
    let blocks: MessageContentBlock[] = [];

    // 监听取消
    const onAbort = () => {
      try { 
        // ConversionActorAgent内部会处理取消逻辑
      } catch {}
    };
    abortSignal.addEventListener('abort', onAbort, { once: true });

    try {
      // 创建ConversionActorAgent实例，传入现有的消息ID
      console.log(`[App.vue] Creating ConversionActorAgent with aiMessageId: ${aiMessageId}`);
      const { ConversionActorAgent } = await import('./apps/agent/conversion-actor-agent');
      const agent = new ConversionActorAgent(conversationId, abortSignal, aiMessageId);
      console.log(`[App.vue] ConversionActorAgent created successfully`);
      
      // 启动多智能体处理，直接传入任务
      const observer = await agent.start(question);
      
      // 监听流式输出
      const subscription = observer.subscribe({
        next: (messageStream) => {
          if (abortSignal.aborted) return;
          
          const content = messageStream.content || '';
          if (!content) return;

          // 检查是否是JSON格式的内容块数组
          try {
            const parsedContent = JSON.parse(content);
            if (Array.isArray(parsedContent)) {
              // 这是聚合的内容块数组，合并到现有blocks中而不是替换
              // 使用Map来去重和合并相同类型的块
              const blockMap = new Map<string, any>();
              
              // 先添加现有blocks
              blocks.forEach((block, index) => {
                const key = block.type + '_' + (block.id || index);
                blockMap.set(key, block);
              });
              
              // 然后添加新的blocks
              parsedContent.forEach((block: any, index: number) => {
                // 过滤掉editor类型的消息块，不保存到blocks中
                if (block.type === 'editor') {
                  return;
                }
                
                let key: string;
                if (block.type === 'text') {
                  const trimmedContent = String(block.content || '').trim();
                  if (!trimmedContent) return; // 跳过空内容
                  
                  // 检查是否有重复的文本内容
                  const existingTextBlocks = Array.from(blockMap.values()).filter(b => b.type === 'text');
                  const isDuplicate = existingTextBlocks.some(existingBlock => {
                    const existingContent = String(existingBlock.content || '').trim();
                    
                    // 完全相同
                    if (existingContent === trimmedContent) return true;
                    
                    // 新内容是已有内容的子串（已有内容更完整）
                    if (existingContent.includes(trimmedContent) && trimmedContent.length < existingContent.length) {
                      return true;
                    }
                    
                    // 已有内容是新内容的子串，更新为更完整的版本
                    if (trimmedContent.includes(existingContent) && trimmedContent.length > existingContent.length) {
                      existingBlock.content = trimmedContent;
                      return true;
                    }
                    
                    return false;
                  });
                  
                  if (isDuplicate) return; // 跳过重复内容
                  
                  // 文本类型使用唯一的key
                  key = `text_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
                  block.content = trimmedContent; // 使用处理过的内容
                } else {
                  // 非文本类型使用原有逻辑，相同key的会被覆盖（更新）
                  key = block.type + '_' + (block.id || `new_${Date.now()}_${index}`);
                }
                
                blockMap.set(key, { ...block, timestamp: block.timestamp || Date.now() });
              });
              
              // 更新blocks数组，保持时间顺序
              blocks = Array.from(blockMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
              
              // 提取文本内容用于UI显示
              const textBlocks = blocks.filter(block => block.type === 'text');
              fullResponse = textBlocks.map(block => block.content).join('\n');
            } else if (parsedContent && typeof parsedContent === 'object' && parsedContent.type) {
              // 过滤掉editor类型的消息块，不保存到blocks中
              if (parsedContent.type === 'editor') {
                return;
              }
              
              const newBlock = { 
                ...parsedContent, 
                timestamp: parsedContent.timestamp || Date.now(),
                id: parsedContent.id || `block_${blocks.length}_${Date.now()}`
              };
              
              if (parsedContent.type === 'text') {
                // 文本类型检查重复后创建新块
                const trimmedContent = String(newBlock.content || '').trim();
                if (!trimmedContent) return; // 跳过空内容
                
                // 检查是否有重复或包含关系的文本块
                const existingTextBlocks = blocks.filter(block => block.type === 'text');
                const isDuplicate = existingTextBlocks.some(block => {
                  const existingContent = String(block.content || '').trim();
                  
                  // 完全相同
                  if (existingContent === trimmedContent) return true;
                  
                  // 新内容是已有内容的子串（已有内容更完整）
                  if (existingContent.includes(trimmedContent) && trimmedContent.length < existingContent.length) {
                    return true;
                  }
                  
                  // 已有内容是新内容的子串，且时间相近（10秒内），可能是增量更新
                  const timeDiff = Date.now() - (block.timestamp || 0);
                  if (trimmedContent.includes(existingContent) && timeDiff < 10000) {
                    // 更新这个块的内容为更完整的版本
                    block.content = trimmedContent;
                    block.timestamp = Date.now(); // 更新时间戳
                    return true;
                  }
                  
                  return false;
                });
                
                if (!isDuplicate) {
                  newBlock.id = `text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                  newBlock.content = trimmedContent;
                  blocks.push(newBlock);
                }
                
                // 重新计算完整响应文本
                const textBlocks = blocks.filter(block => block.type === 'text');
                fullResponse = textBlocks.map(block => block.content).join('\n');
              } else {
                // 非文本类型的块，检查是否已存在相同类型的块
                const existingIndex = blocks.findIndex(b => 
                  b.type === parsedContent.type && 
                  (b.id === parsedContent.id || (b.type === parsedContent.type && !b.id && !parsedContent.id))
                );
                
                if (existingIndex >= 0) {
                  // 更新现有块
                  blocks[existingIndex] = newBlock;
                } else {
                  // 添加新块
                  blocks.push(newBlock);
                }
              }
            } else {
              // 普通文本内容，检查是否与已有文本块重复
              const trimmedContent = content.trim();
              if (!trimmedContent) return; // 跳过空内容
              
              // 检查是否有重复或包含关系的文本块
              const existingTextBlocks = blocks.filter(block => block.type === 'text');
              const isDuplicate = existingTextBlocks.some(block => {
                const existingContent = String(block.content || '').trim();
                
                // 完全相同
                if (existingContent === trimmedContent) return true;
                
                // 新内容是已有内容的子串（已有内容更完整）
                if (existingContent.includes(trimmedContent) && trimmedContent.length < existingContent.length) {
                  return true;
                }
                
                // 已有内容是新内容的子串，且时间相近（10秒内），可能是增量更新
                const timeDiff = Date.now() - (block.timestamp || 0);
                if (trimmedContent.includes(existingContent) && timeDiff < 10000) {
                  // 更新这个块的内容为更完整的版本
                  block.content = trimmedContent;
                  block.timestamp = Date.now(); // 更新时间戳
                  return true;
                }
                
                return false;
              });
              
              if (!isDuplicate) {
                const textBlock: MessageContentBlock = {
                  type: 'text' as const,
                  content: trimmedContent,
                  timestamp: Date.now(),
                  id: `text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                };
                
                blocks.push(textBlock);
              }
              
              // 重新计算完整响应文本（合并所有文本块）
              const textBlocks = blocks.filter(block => block.type === 'text');
              fullResponse = textBlocks.map(block => block.content).join('\n');
            }
          } catch {
            // 解析失败，当作普通文本处理，检查重复后创建新文本块
            const trimmedContent = content.trim();
            if (!trimmedContent) return; // 跳过空内容
            
            // 检查是否有重复或包含关系的文本块
            const existingTextBlocks = blocks.filter(block => block.type === 'text');
            const isDuplicate = existingTextBlocks.some(block => {
              const existingContent = String(block.content || '').trim();
              
              // 完全相同
              if (existingContent === trimmedContent) return true;
              
              // 新内容是已有内容的子串（已有内容更完整）
              if (existingContent.includes(trimmedContent) && trimmedContent.length < existingContent.length) {
                return true;
              }
              
              // 已有内容是新内容的子串，且时间相近（10秒内），可能是增量更新
              const timeDiff = Date.now() - (block.timestamp || 0);
              if (trimmedContent.includes(existingContent) && timeDiff < 10000) {
                // 更新这个块的内容为更完整的版本
                block.content = trimmedContent;
                block.timestamp = Date.now(); // 更新时间戳
                return true;
              }
              
              return false;
            });
            
            if (!isDuplicate) {
              const textBlock: MessageContentBlock = {
                type: 'text' as const,
                content: trimmedContent,
                timestamp: Date.now(),
                id: `text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
              };
              
              blocks.push(textBlock);
            }
            
            // 重新计算完整响应文本（合并所有文本块）
            const textBlocks = blocks.filter(block => block.type === 'text');
            fullResponse = textBlocks.map(block => block.content).join('\n');
          }

          // 更新UI和缓存
          cacheManager.updateContentBlocks(conversationId, aiMessageId, blocks);
          // 将完整的内容块数组存储到消息content中，而不仅仅是文本
          const aggregatedContent = JSON.stringify(blocks);
          console.log(`[App.vue] Updating message with aggregated content, blocks count: ${blocks.length}, types: ${blocks.map(b => b.type).join(', ')}`);
          updateMessageInConversation(conversationId, aiMessageId, aggregatedContent, false);

          if (generatingChats.value.get(conversationId)) {
            generatingChats.value.set(conversationId, true);
            cacheManager.setGeneratingStatus(conversationId, true);
          }
        },
        error: (error) => {
          console.error('Multi-agent execution error:', error);
          throw error;
        },
        complete: () => {
          console.log('Multi-agent execution completed');
        }
      });

      // 等待完成
      await new Promise<void>((resolve) => {
        subscription.add(() => {
          resolve();
        });
        
        // 处理错误情况
        if (abortSignal.aborted) {
          subscription.unsubscribe();
          resolve();
        }
        
        // 监听用户取消
        abortSignal.addEventListener('abort', () => {
          subscription.unsubscribe();
          resolve();
        });
      });

      if (abortSignal.aborted) return '';

      // 最终更新：存储完整的聚合内容块数组
      const finalAggregatedContent = JSON.stringify(blocks);
      console.log(`[App.vue] Final update - blocks count: ${blocks.length}, content length: ${finalAggregatedContent.length}`);
      if (finalAggregatedContent && finalAggregatedContent !== '[]') {
        await updateMessageInConversation(conversationId, aiMessageId, finalAggregatedContent, true);
      }
      await cacheManager.forceSyncAll();
      return fullResponse; // 返回文本内容用于错误显示
    } finally {
      abortSignal.removeEventListener('abort', onAbort);
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      // 订阅在取消时通常会自行结束，这里返回空字符串以保持调用方逻辑
      return '';
    }
    console.error('多智能体执行失败:', error);
    throw error;
  }
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
        // 实时估算当前助手消息的token（最终以事件上报为准）
        if (currentMessages.value[messageIndex].role === 'assistant') {
          updateEstimatedUsage(conversationId, messageId, content);
        }
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

  // 加载模型配置后，根据状态决定是否弹出配置对话框
  modelStore.loadModelConfigs().then(() => {
    const noConfig = modelStore.modelConfigs.length === 0;
    const noApiKey = !modelStore.currentModel?.api_key;
    if (noConfig || noApiKey) {
      modelStore.openModelDialog();
    }
  });

  mcpStore.loadMcpConfigs();
  // 新增：加载设置（包含开发者模式），并在开启时初始化日志拦截
  settingsStore.loadSettings();
  
  // 初始化窗口控制
  initWindowControls();

  // 监听来自 Agent 的 token 使用事件
  try {
    window.addEventListener('agent-token-usage', tokenUsageListener as EventListener);
    tokenCounter.addListener(handleTokenStatsUpdate);
  } catch {}

  // Subscribe to Studio events to auto-expand dock on new content
  try {
    studioSubscription = studioBus.subscribe({
      next(action: StudioAction) {
        if (!action) return;
        if (action.type === 'visibility') {
          // ignore generic visibility in dock mode
          return;
        }
        if (action.type === 'browserVisible') {
          if (action.payload?.visible) {
            isStudioCollapsed.value = false;
          }
          return;
        }
        // Any content event opens the dock
        isStudioCollapsed.value = false;
      },
    });
  } catch {}
});

// 监听消息列表变化，滚动到底部
watch(() => currentMessages.value.length, () => {
  scrollToBottom();
});

// 监听消息变化，处理计划步骤状态更新和自动折叠
watch(
  () => currentMessages.value,
  (newMessages) => {
    for (const message of newMessages) {
      if (message.role === 'assistant') {
        const blocks = getBlocksForMessage(message);
        
        // 处理计划步骤块
        const planStepsBlock = blocks.find(block => block.type === 'plan_steps');
        if (planStepsBlock && (planStepsBlock as any).metadata?.planData) {
          const planData = (planStepsBlock as any).metadata.planData;
          initializePlanStepStatuses(message.id, planData);
        }
        
        // 处理子任务状态更新
        blocks.forEach(block => {
          if (block.type === 'subtask_status') {
            const content = (block as any).content;
            if (content && typeof content === 'object') {
              const stepId = content.subtaskId;
              const status = content.status;
              
              // 查找对应的计划步骤消息
              const planMessage = newMessages.find(msg => 
                getBlocksForMessage(msg).some(b => b.type === 'plan_steps')
              );
              
              if (planMessage && stepId) {
                let mappedStatus: 'pending' | 'running' | 'completed' | 'failed' = 'pending';
                switch (status) {
                  case 'running': mappedStatus = 'running'; break;
                  case 'completed': mappedStatus = 'completed'; break;
                  case 'failed': mappedStatus = 'failed'; break;
                  default: mappedStatus = 'pending';
                }
                updatePlanStepStatus(planMessage.id, stepId, mappedStatus);
              }
            }
          }
          
          
          // User Agent消息完成时自动折叠
          if (block.type === 'user_agent') {
            const blockId = (block as any).id || `user_agent_${Date.now()}`;
            const content = String(block.content || '');
            
            // 检查是否有自动折叠标记
            if ((block as any).autoCollapse) {
              // 有自动折叠标记，立即折叠
              autoCollapseUserAgent(blockId, 1000); // 1秒后自动折叠
            } else if (content.length > 10 && !generatingChats.value.get(currentChatId.value)) {
              // 检查内容是否完整（简单判断：内容长度大于10且不是正在生成中）
              autoCollapseUserAgent(blockId, 3000); // 3秒后自动折叠
            }
          }
          
          // Assistant Agent消息完成时自动折叠
          if (block.type === 'assistant_agent') {
            const blockId = (block as any).id || `assistant_agent_${Date.now()}`;
            const content = String(block.content || '');
            
            // 检查是否有自动折叠标记
            if ((block as any).autoCollapse) {
              // 有自动折叠标记，立即折叠
              autoCollapseAssistantAgent(blockId, 1000); // 1秒后自动折叠
            } else if (content.length > 10 && !generatingChats.value.get(currentChatId.value)) {
              // 检查内容是否完整（简单判断：内容长度大于10且不是正在生成中）
              autoCollapseAssistantAgent(blockId, 3000); // 3秒后自动折叠
            }
          }
          
          // 任务完成时自动折叠计划
          if (block.type === 'final_result') {
            // 查找对应的计划步骤消息并折叠
            const planMessage = newMessages.find(msg => 
              getBlocksForMessage(msg).some(b => b.type === 'plan_steps')
            );
            
            if (planMessage) {
              // 延迟折叠，让用户看到最终结果
              setTimeout(() => {
                collapsedPlanSteps.value.set(planMessage.id, true);
              }, 2000);
            }
          }
        });
      }
    }
  },
  { deep: true }
);

onUnmounted(() => {
  try { 
    window.removeEventListener('agent-token-usage', tokenUsageListener as EventListener); 
    tokenCounter.removeListener(handleTokenStatsUpdate);
  } catch {}
  try {
    if (studioSubscription) {
      studioSubscription.unsubscribe();
      studioSubscription = null;
    }
  } catch {}
});



// 使用内容块渲染与复制的辅助
const cachedContentBlocks = computed(() => {
  const conv = cacheManager.getCachedConversations().find(c => c.id === currentChatId.value);
  return conv?.contentBlocks;
});

function getBlocksForMessage(message: Message): MessageContentBlock[] {
  const map = cachedContentBlocks.value;
  if (map && map.has(message.id)) {
    return deduplicateTextBlocks(map.get(message.id)!);
  }
  try {
    const data = JSON.parse(message.content);
    if (Array.isArray(data)) {
      return deduplicateTextBlocks(data as MessageContentBlock[]);
    }
    // 处理单个工具消息或其他类型的消息
    if (data && typeof data === 'object' && data.type) {
      return [data as MessageContentBlock];
    }
  } catch {
    // ignore
  }
  return [{
    type: 'text',
    content: message.content,
    timestamp: message.timestamp
  }];
}

// 新增：专门的文本块去重函数
function deduplicateTextBlocks(blocks: MessageContentBlock[]): MessageContentBlock[] {
  const textBlocks: MessageContentBlock[] = [];
  const nonTextBlocks: MessageContentBlock[] = [];
  
  // 分离文本块和非文本块
  blocks.forEach(block => {
    if (block.type === 'text') {
      textBlocks.push(block);
    } else {
      nonTextBlocks.push(block);
    }
  });
  
  // 对文本块进行智能去重
  const deduplicatedTextBlocks: MessageContentBlock[] = [];
  
  for (const currentBlock of textBlocks) {
    const currentContent = String(currentBlock.content || '').trim();
    if (!currentContent) continue; // 跳过空内容
    
    // 检查是否与已有块重复或包含
    let shouldAdd = true;
    let shouldUpdateExisting = false;
    let targetIndex = -1;
    
    for (let i = 0; i < deduplicatedTextBlocks.length; i++) {
      const existingBlock = deduplicatedTextBlocks[i];
      const existingContent = String(existingBlock.content || '').trim();
      
      // 完全相同，跳过
      if (existingContent === currentContent) {
        shouldAdd = false;
        break;
      }
      
      // 当前内容是已有内容的子串（已有内容更完整），跳过当前块
      if (existingContent.includes(currentContent)) {
        shouldAdd = false;
        break;
      }
      
      // 已有内容是当前内容的子串（当前内容更完整），更新已有块
      if (currentContent.includes(existingContent)) {
        shouldUpdateExisting = true;
        targetIndex = i;
        shouldAdd = false;
        break;
      }
    }
    
    if (shouldAdd) {
      deduplicatedTextBlocks.push(currentBlock);
    } else if (shouldUpdateExisting && targetIndex >= 0) {
      // 用更完整的内容替换已有块，保持较新的时间戳
      deduplicatedTextBlocks[targetIndex] = {
        ...deduplicatedTextBlocks[targetIndex],
        content: currentContent,
        timestamp: Math.max(deduplicatedTextBlocks[targetIndex].timestamp || 0, currentBlock.timestamp || 0)
      };
    }
  }
  
  // 如果没有有效的文本块，但有非文本块，则返回非文本块
  if (deduplicatedTextBlocks.length === 0 && textBlocks.length > 0) {
    // 选择最完整的文本块（内容最长的）
    const longestTextBlock = textBlocks.reduce((prev, current) => {
      const prevLength = String(prev.content || '').trim().length;
      const currentLength = String(current.content || '').trim().length;
      return currentLength > prevLength ? current : prev;
    });
    deduplicatedTextBlocks.push(longestTextBlock);
  }
  
  // 合并非文本块和去重后的文本块，按时间戳排序
  const allBlocks = [...deduplicatedTextBlocks, ...nonTextBlocks];
  return allBlocks.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}



async function copyMessage(msg: Message) {
  try {
    const blocks = getBlocksForMessage(msg);
    const plain = blocks.map((b) => {
      switch (b.type) {
        case 'text':
          return String((b as any).content || '');
        case 'tool_call':
          return `[工具调用] ${String((b as any).content || '')}`;
        case 'tool_message':
          return `[工具消息]\n` + (typeof (b as any).content === 'string' ? (b as any).content : JSON.stringify((b as any).content, null, 2));
        case 'url_links':
          return (Array.isArray((b as any).content) ? (b as any).content : []).join('\n');
        case 'plan_steps':
          return Array.isArray((b as any).content)
            ? (b as any).content.map((s: any, i: number) => `${i + 1}. ${s}`).join('\n')
            : String((b as any).content || '');
        case 'step_result':
          return typeof (b as any).content === 'string'
            ? (b as any).content
            : JSON.stringify((b as any).content, null, 2);
        case 'task':
          return `[任务] ` + (typeof (b as any).content === 'object'
            ? ((b as any).content?.description ?? '')
            : String((b as any).content ?? ''));
        default:
          return String((b as any).content || '');
      }
    }).join('\n');

    await navigator.clipboard.writeText(plain);
  } catch (error) {
    console.error('复制失败:', error);
  }
}

function previewTask(_msg: Message, cblock: MessageContentBlock) {
  try {
    const content: any = (cblock as any)?.content ?? {};
    studioBus.preview({
      type: content.type,
      description: content.description || '',
      payload: content.payload,
    });
    isStudioCollapsed.value = false;
  } catch (e) {
    console.error('预览任务失败:', e);
  }
}

function viewHtmlReport(cblock: MessageContentBlock) {
  try {
    console.log('=== viewHtmlReport 开始 ===');
    console.log('点击的块:', cblock);
    
    const content: any = (cblock as any)?.content ?? {};
    const payload: any = (cblock as any)?.payload ?? {};
    
    console.log('当前块 content:', content);
    console.log('当前块 payload:', payload);
    
    // 尝试多种可能的数据路径
    let htmlContent = payload.htmlContent || content.htmlContent;
    let title = payload.title || content.title || 'HTML报告';
    let fileName = payload.fileName || content.fileName || `${title}.html`;
    
    console.log('第一次尝试获取的数据:');
    console.log('- htmlContent 长度:', htmlContent?.length);
    console.log('- title:', title);
    console.log('- fileName:', fileName);
    
    // 如果当前块没有HTML内容，尝试从同一条消息的其他块中查找
    if (!htmlContent) {
      console.log('当前块没有HTML内容，开始查找同消息的其他块...');
      
      // 查找当前消息中包含HTML内容的块
      const currentMessage = currentMessages.value.find(msg => {
        const blocks = getBlocksForMessage(msg);
        return blocks.some(block => block === cblock);
      });
      
      console.log('找到当前消息:', currentMessage?.id);
      
      if (currentMessage) {
        const allBlocks = getBlocksForMessage(currentMessage);
        console.log('消息的所有块数量:', allBlocks.length);
        console.log('所有块的类型:', allBlocks.map(b => b.type));
        
        // 查找包含HTML内容的块 - 可能是htmlReport或html_report类型
        const htmlBlock = allBlocks.find(block => {
          console.log(`检查块类型: ${block.type}`);
          if (block.type === 'htmlReport') {
            const hasContent = !!(block as any).payload?.htmlContent;
            console.log(`- htmlReport 块有HTML内容: ${hasContent}`);
            return hasContent;
          }
          if (block.type === 'html_report') {
            const hasContent = !!(block as any).content?.htmlContent;
            console.log(`- html_report 块有HTML内容: ${hasContent}`);
            return hasContent;
          }
          return false;
        });
        
        if (htmlBlock) {
          console.log('找到HTML块:', htmlBlock.type);
          
          // 根据块类型从不同位置提取数据
          if (htmlBlock.type === 'htmlReport') {
            htmlContent = (htmlBlock as any).payload.htmlContent;
            title = (htmlBlock as any).payload.title || title;
            fileName = (htmlBlock as any).payload.fileName || fileName;
            console.log('从 htmlReport 块提取数据');
          } else if (htmlBlock.type === 'html_report') {
            htmlContent = (htmlBlock as any).content.htmlContent;
            title = (htmlBlock as any).content.title || title;
            fileName = (htmlBlock as any).content.fileName || fileName;
            console.log('从 html_report 块提取数据');
          }
        } else {
          console.log('没有找到包含HTML内容的块');
        }
      } else {
        console.log('没有找到当前消息');
      }
    }
    
    console.log('最终获取的数据:');
    console.log('- htmlContent 长度:', htmlContent?.length);
    console.log('- title:', title);
    console.log('- fileName:', fileName);
    
    if (!htmlContent) {
      console.error('HTML内容为空，无法显示报告');
      console.log('=== viewHtmlReport 结束（失败）===');
      return;
    }
    
    const action = {
      type: 'htmlReport',
      description: title,
      payload: {
        htmlContent: htmlContent,
        title: title,
        fileName: fileName
      }
    };
    
    console.log('发送到Studio:', action);
    studioBus.preview(action);
    isStudioCollapsed.value = false;
    console.log('=== viewHtmlReport 结束（成功）===');
  } catch (e) {
    console.error('查看HTML报告失败:', e);
    console.log('=== viewHtmlReport 结束（异常）===');
  }
}

// 计划步骤管理函数
function togglePlanStepsCollapse(messageId: string) {
  const currentState = collapsedPlanSteps.value.get(messageId) || false;
  collapsedPlanSteps.value.set(messageId, !currentState);
}

function isPlanStepsCollapsed(messageId: string): boolean {
  return collapsedPlanSteps.value.get(messageId) || false;
}


// User Agent消息折叠管理函数
function toggleUserAgentCollapse(blockId: string) {
  const currentState = collapsedUserAgents.value.get(blockId) || false;
  collapsedUserAgents.value.set(blockId, !currentState);
}

function isUserAgentCollapsed(blockId: string): boolean {
  return collapsedUserAgents.value.get(blockId) || false;
}

function autoCollapseUserAgent(blockId: string, delay: number = 3000) {
  setTimeout(() => {
    collapsedUserAgents.value.set(blockId, true);
  }, delay);
}

// Assistant Agent消息折叠管理函数
function toggleAssistantAgentCollapse(blockId: string) {
  const currentState = collapsedAssistantAgents.value.get(blockId) || false;
  collapsedAssistantAgents.value.set(blockId, !currentState);
}

function isAssistantAgentCollapsed(blockId: string): boolean {
  return collapsedAssistantAgents.value.get(blockId) || false;
}

function autoCollapseAssistantAgent(blockId: string, delay: number = 3000) {
  setTimeout(() => {
    collapsedAssistantAgents.value.set(blockId, true);
  }, delay);
}


// 在studio中打开URL
function openUrlInStudio(url: string) {
  try {
    studioBus.preview({
      type: 'openUrl',
      description: `浏览器 - ${url}`,
      payload: { url: url },
    });
    isStudioCollapsed.value = false; // 展开studio面板
  } catch (error) {
    console.error('无法在studio中打开URL:', error);
    // 兜底：在新标签页打开
    window.open(url, '_blank');
  }
}

// 将函数暴露到全局，供HTML onclick使用
if (typeof window !== 'undefined') {
  (window as any).openUrlInStudio = openUrlInStudio;
}

// 格式化工具参数，提取主要内容
function formatToolParameters(parameters: any): string {
  if (!parameters || typeof parameters !== 'object') {
    return String(parameters || '');
  }
  
  // 常见的参数键名，优先显示这些
  const importantKeys = ['query', 'q', 'search', 'keyword', 'text', 'content', 'prompt', 'message', 'url', 'path', 'file', 'name'];
  
  // 查找重要的参数值
  for (const key of importantKeys) {
    if (parameters[key]) {
      return String(parameters[key]);
    }
  }
  
  // 如果没有找到重要参数，取第一个字符串值
  const values = Object.values(parameters);
  const firstStringValue = values.find(v => typeof v === 'string' && v.length > 0);
  if (firstStringValue) {
    return String(firstStringValue);
  }
  
  // 兜底：返回参数的简化JSON
  const keys = Object.keys(parameters);
  if (keys.length === 1) {
    return String(parameters[keys[0]]);
  }
  
  return JSON.stringify(parameters);
}

// 格式化工具参数，支持URL链接
function formatToolParametersWithUrls(parameters: any): string {
  const text = formatToolParameters(parameters);
  return formatTextWithUrls(text);
}

// 格式化文本，将URL转换为可点击的链接
function formatTextWithUrls(text: string): string {
  if (!text) return '';
  
  // URL正则表达式，匹配http和https链接
  const urlRegex = /(https?:\/\/[^\s\n]+)/g;
  
  // 将URL替换为可点击的链接
  return text.replace(urlRegex, (url) => {
    return `<a href="#" onclick="openUrlInStudio('${url}'); return false;" class="studio-url-link">${url}</a>`;
  });
}

function initializePlanStepStatuses(messageId: string, planData: any[]) {
  if (!planStepStatuses.value.has(messageId)) {
    const statusMap = new Map<number, 'pending' | 'running' | 'completed' | 'failed'>();
    planData.forEach(task => {
      const status = task.completed ? 'completed' : 'pending';
      statusMap.set(task.id, status);
    });
    planStepStatuses.value.set(messageId, statusMap);
  }
}

function updatePlanStepStatus(messageId: string, stepId: number, status: 'pending' | 'running' | 'completed' | 'failed') {
  if (!planStepStatuses.value.has(messageId)) {
    planStepStatuses.value.set(messageId, new Map());
  }
  planStepStatuses.value.get(messageId)!.set(stepId, status);
}

function getPlanStepStatus(messageId: string, stepId: number): 'pending' | 'running' | 'completed' | 'failed' {
  return planStepStatuses.value.get(messageId)?.get(stepId) || 'pending';
}

function getStatusIcon(status: 'pending' | 'running' | 'completed' | 'failed'): string {
  switch (status) {
    case 'pending': return '⏳';
    case 'running': return '🔄';
    case 'completed': return '✅';
    case 'failed': return '❌';
    default: return '⏳';
  }
}

// 获取tool_call的最新状态
function getToolCallStatus(message: Message, toolCallBlock: MessageContentBlock): string {
  const blocks = getBlocksForMessage(message);
  
  // 查找对应的tool_message
  const toolMessage = blocks.find(block => 
    block.type === 'tool_message' && 
    (block as any).toolName === ((toolCallBlock as any)?.toolName || (toolCallBlock.content as any)?.toolName) &&
    (block as any).agentId === ((toolCallBlock as any)?.agentId || (toolCallBlock.content as any)?.agentId)
  );
  
  if (toolMessage) {
    return (toolMessage as any)?.status || (toolMessage.content as any)?.status || 'completed';
  }
  
  // 如果没有找到对应的tool_message，返回原始状态
  return (toolCallBlock as any)?.status || (toolCallBlock.content as any)?.status || 'started';
}

function previewPlanSteps(_msg: Message, cblock: MessageContentBlock) {
  try {
    const content: any = (cblock as any)?.content;
    const metadata: any = (cblock as any)?.metadata;
    
    console.log('预览计划步骤 - cblock:', cblock);
    console.log('预览计划步骤 - content:', content);
    console.log('预览计划步骤 - metadata:', metadata);
    
    // 生成 todos.md 格式的内容
    let todosContent = '# Task Plan\n\n';
    todosContent += `Total Steps: ${metadata?.totalSteps || (Array.isArray(content) ? content.length : 'N/A')}\n\n`;
    todosContent += '## Todo List\n\n';
    
    if (Array.isArray(content)) {
      content.forEach((step: string, index: number) => {
        todosContent += `- [ ] ${index + 1}. ${step}\n`;
      });
    }
    
    // 如果有详细的计划数据，添加依赖关系信息
    if (metadata?.planData && Array.isArray(metadata.planData)) {
      todosContent += '\n## Detailed Plan\n\n';
      metadata.planData.forEach((task: any, index: number) => {
        todosContent += `### Task ${task.id || (index + 1)}\n`;
        todosContent += `**Description:** ${task.description}\n\n`;
        if (task.dependencies && task.dependencies.length > 0) {
          todosContent += `**Dependencies:** ${task.dependencies.join(', ')}\n\n`;
        }
        todosContent += `**Status:** ${task.completed ? '✅ Completed' : '⏳ Pending'}\n\n`;
        if (task.result) {
          todosContent += `**Result:** ${task.result}\n\n`;
        }
        todosContent += '---\n\n';
      });
    }
    
    studioBus.preview({
      type: 'editor',
      description: 'Task Plan - todos.md',
      payload: todosContent
    });
    isStudioCollapsed.value = false;
  } catch (e) {
    console.error('预览计划步骤失败:', e);
  }
}

// Token usage helpers
function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  try {
    const bytes = new TextEncoder().encode(text).length;
    return Math.ceil(bytes / 4);
  } catch {
    return Math.ceil(text.length / 4);
  }
}

function estimateTokensFromMessages(messages: Message[]): number {
  return messages.reduce((acc, m) => acc + estimateTokensFromText(m.content || ''), 0);
}

function estimatePromptTokens(messages: Message[]): number {
  return estimateTokensFromMessages(messages);
}

function updateEstimatedUsage(conversationId: string, messageId: string, content: string) {
  if (!conversationId || currentChatId.value !== conversationId) return;
  const estimate = estimateTokensFromText(content || '');
  const prev = perMessageUsage.value[messageId] || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const prompt = prev.prompt_tokens || 0;
  const completion = Math.max(prev.completion_tokens || 0, estimate);
  const total = Math.max(prev.total_tokens || 0, prompt + completion);
  perMessageUsage.value[messageId] = {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    estimated: true,
  };
}

function getUsageForMessage(messageId: string) {
  return perMessageUsage.value[messageId];
}

function handleTokenStatsUpdate(stats: TokenStats) {
  tokenStats.value = stats;
}

const tokenUsageListener = (event: Event) => {
  try {
    const detail: any = (event as any).detail || {};
    const usage = detail.usage as TokenUsage;
    if (!usage) return;

    // 优先使用事件中的会话ID，否则回退到当前会话
    let conversationId: string | undefined = detail.conversationId || currentChatId.value;
    if (!conversationId) return;

    // 仅在对应会话处于生成中时更新
    const isGen = !!generatingChats.value.get(conversationId);
    if (!isGen) return;

    // 确定目标消息ID：优先用事件提供的，否则使用该会话中最后一条助手消息
    let targetMessageId: string | undefined = detail.messageId;
    if (!targetMessageId) {
      const msgs =
        conversationId === currentChatId.value
          ? currentMessages.value
          : conversationCache.value.get(conversationId) || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === 'assistant') {
          targetMessageId = m.id;
          break;
        }
      }
    }

    if (targetMessageId) {
      perMessageUsage.value[targetMessageId] = {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        estimated: false,
      };
    }

    // 全局 tokenCounter 已在事件源更新，这里避免重复累加以防双重计数。
  } catch (e) {
    console.warn('Failed to handle token usage event:', e);
  }
};

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
          <div class="token-total">Tokens: {{ currentConversationTokenTotal }}</div>
          </div>
        </div>
        <div class="messages-container" ref="messagesContainer" @scroll="handleMessagesScroll">
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
        <template v-for="(cblock, index) in getBlocksForMessage(message)" :key="index">
          <template v-if="cblock.type === 'text'">
            <template v-for="(sub, sidx) in parseMessage(String(cblock.content))" :key="sidx">
              <CodeBlock v-if="isCodeBlock(sub)" :code="sub.code" :language="sub.language" />
              <MarkdownRenderer v-else-if="isMarkdownBlock(sub)" :content="sub.content" />
            </template>
          </template>
          <template v-else-if="cblock.type === 'tool_call'">
            <div class="tool-call-block">
              <div class="tool-call-hint">
                <span class="hint-icon">🔧</span>
                <div class="tool-call-inline">
                  工具：{{ (cblock as any)?.toolName || (cblock.content as any)?.toolName || cblock.content }}
                  <span v-if="(cblock as any)?.parameters || (cblock.content as any)?.parameters" class="tool-parameters-simple">
                    <span v-html="formatToolParametersWithUrls((cblock as any)?.parameters || (cblock.content as any)?.parameters)"></span>
                  </span>
                  <span class="tool-status-inline">{{ getToolCallStatus(message, cblock) }}</span>
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="cblock.type === 'url_links'">
            <div class="url-links-block">
              <div v-for="(link, lidx) in (Array.isArray(cblock.content) ? cblock.content : [])" :key="lidx">
                <a :href="link" target="_blank" rel="noopener noreferrer">{{ link }}</a>
              </div>
            </div>
          </template>
          <template v-else-if="cblock.type === 'plan_steps'">
            <div class="plan-steps-block" :class="{ collapsed: isPlanStepsCollapsed(message.id) }">
              <div class="plan-steps-header" @click.stop="togglePlanStepsCollapse(message.id)">
                <span class="plan-icon">📋</span>
                <span class="plan-title">To-dos</span>
                <span class="plan-collapse-icon">{{ isPlanStepsCollapsed(message.id) ? '▶' : '▼' }}</span>
              </div>
              <div class="plan-steps-content" v-show="!isPlanStepsCollapsed(message.id)">
                <ol>
                  <li 
                    v-for="(step, pidx) in (Array.isArray(cblock.content) ? cblock.content : [cblock.content])" 
                    :key="pidx"
                    class="plan-step-item"
                    @click="previewPlanSteps(message, cblock)"
                  >
                    <span 
                      class="step-status-icon" 
                      :class="`status-${getPlanStepStatus(message.id, pidx + 1)}`"
                    >
                      {{ getStatusIcon(getPlanStepStatus(message.id, pidx + 1)) }}
                    </span>
                    <span class="step-content">{{ step }}</span>
                  </li>
                </ol>
                <div class="plan-hint">点击步骤查看详细 todos.md</div>
              </div>
            </div>
          </template>
          <template v-else-if="cblock.type === 'step_result'">
            <div class="step-result-block">
              <pre>{{ typeof cblock.content === 'string' ? cblock.content : JSON.stringify(cblock.content, null, 2) }}</pre>
            </div>
          </template>
          <template v-else-if="cblock.type === 'subtask_status'">
            <SubTaskDisplay
              v-if="typeof cblock.content === 'object'"
              :subtask-number="(cblock.content as any).subtaskId"
              :subtask-description="(cblock.content as any).subtaskDescription"
              :status="(cblock.content as any).status"
            >
              <div class="subtask-progress">
                <span>进度: {{ (cblock.content as any).completedSubtasks }}/{{ (cblock.content as any).totalSubtasks }}</span>
                <span v-if="(cblock.content as any).status === 'completed'" class="success-icon">✅</span>
                <span v-else-if="(cblock.content as any).status === 'failed'" class="fail-icon">❌</span>
                <span v-else class="running-icon">⏳</span>
              </div>
            </SubTaskDisplay>
          </template>
          <template v-else-if="cblock.type === 'final_result'">
            <div class="final-result-block">
              <div class="final-result-header">
                <span class="result-icon">🎯</span>
                <span class="result-title">任务最终结果</span>
                <span class="result-status" :class="{ complete: (cblock.content as any).isMainTaskComplete }">
                  {{ (cblock.content as any).isMainTaskComplete ? '任务完成' : '部分完成' }}
                  ({{ (cblock.content as any).completedSubtasks }}/{{ (cblock.content as any).totalSubtasks }} 子任务)
                </span>
              </div>
              <div class="final-result-content">
                <MarkdownRenderer :content="(cblock.content as any).content" />
              </div>
            </div>
          </template>
          <template v-else-if="cblock.type === 'task'">
            <div class="task-block">
              <div class="task-header">🧩 任务</div>
              <div class="task-body">
                <div class="task-desc">
                  {{ typeof cblock.content === 'object' ? (cblock.content.description || '[无描述]') : String(cblock.content) }}
                </div>
                <button class="task-preview-btn" @click="previewTask(message, cblock)">预览</button>
              </div>
            </div>
          </template>
          <template v-else-if="cblock.type === 'html_report'">
            <div class="html-report-link">
              <a href="#" @click.prevent="viewHtmlReport(cblock)">
                {{ ((cblock.content as any)?.title || '报告') + '.html' }}
              </a>
            </div>
          </template>
          <template v-else-if="cblock.type === 'user_agent'">
            <div class="user-agent-block" :class="{ collapsed: isUserAgentCollapsed(cblock.id || `user_agent_${index}`) }">
              <div 
                class="user-agent-header" 
                @click="toggleUserAgentCollapse(cblock.id || `user_agent_${index}`)"
              >
                <span class="user-agent-collapse-icon">
                  {{ isUserAgentCollapsed(cblock.id || `user_agent_${index}`) ? '▶' : '▼' }}
                </span>
                <span v-if="isUserAgentCollapsed(cblock.id || `user_agent_${index}`)" class="user-agent-preview">
                  {{ String(cblock.content || '').substring(0, 50) }}{{ String(cblock.content || '').length > 50 ? '...' : '' }}
                </span>
              </div>
              <div class="user-agent-content" v-show="!isUserAgentCollapsed(cblock.id || `user_agent_${index}`)">
                <div class="user-agent-text" v-html="formatTextWithUrls(String(cblock.content || ''))">
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="cblock.type === 'assistant_agent'">
            <div class="assistant-agent-block" :class="{ collapsed: isAssistantAgentCollapsed(cblock.id || `assistant_agent_${index}`) }">
              <div 
                class="assistant-agent-header" 
                @click="toggleAssistantAgentCollapse(cblock.id || `assistant_agent_${index}`)"
              >
                <span class="assistant-agent-collapse-icon">
                  {{ isAssistantAgentCollapsed(cblock.id || `assistant_agent_${index}`) ? '▶' : '▼' }}
                </span>
                <span v-if="isAssistantAgentCollapsed(cblock.id || `assistant_agent_${index}`)" class="assistant-agent-preview">
                  {{ String(cblock.content || '').substring(0, 50) }}{{ String(cblock.content || '').length > 50 ? '...' : '' }}
                </span>
              </div>
              <div class="assistant-agent-content" v-show="!isAssistantAgentCollapsed(cblock.id || `assistant_agent_${index}`)">
                <div class="assistant-agent-text" v-html="formatTextWithUrls(String(cblock.content || ''))">
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>
      <!-- 加载动画，仅当是最后一条消息且是AI角色且内容为空且正在生成时显示 -->
      <div v-if="message.role === 'assistant' && generatingChats.get(currentChatId) && message.id === currentMessages[currentMessages.length - 1].id" 
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
            @click="copyMessage(message)"
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
      <div v-if="getUsageForMessage(message.id) && message.role === 'assistant'" class="token-usage">
        Tokens: {{ getCumulativeTotalForMessage(message.id) }}
      </div>
    </div>
              </div>
            </div>
          </div>

                  </div>
        
        <button
          v-show="!isAtBottom"
          class="scroll-to-bottom"
          @click="jumpToBottom"
          title="回到底部"
          aria-label="回到底部"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 16l-6-6h12l-6 6z"/>
          </svg>
        </button>

        <div class="input-container">
          <textarea 
            v-model="userInput" 
            placeholder="输入消息..." 
            class="message-input"
            @keydown.enter.prevent="sendMessage"
          ></textarea>
          <div class="input-footer">
            <div class="left-controls">
              <TaskModeSelector v-model:mode="taskMode" />
              <div class="model-selector">
                <ModelSelector
                  v-model:modelValue="modelStore.currentModelId"
                  :options="modelStore.modelConfigs"
                  labelKey="name"
                  valueKey="id"
                  direction="up"
                />
              </div>
            </div>

            <div class="generate-controls">
              <!-- 未生成：发送按钮 -->
              <button
                v-if="!generatingChats.get(currentChatId)"
                class="send-btn icon"
                @click="sendMessage"
                title="发送"
                aria-label="发送"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
                </svg>
              </button>

              <!-- 生成中：转圈圈，点击停止生成 -->
              <button
                v-else
                class="send-btn icon spinning"
                @click="stopGeneration"
                title="停止生成"
                aria-label="停止生成"
              >
                <span class="spinner" aria-hidden="true"></span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty-state">
        <h2>欢迎使用Dora.AI</h2>
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
    
    <!-- 右侧 Studio 停靠容器 -->
    <div class="studio-dock" :class="{ collapsed: isStudioCollapsed }">
      <div class="studio-dock__gutter">
        <button
          class="studio-toggle"
          @click="toggleStudio"
          :title="isStudioCollapsed ? '展开工作室' : '收起工作室'"
          :aria-expanded="!isStudioCollapsed"
        >
          <svg v-if="isStudioCollapsed" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 6l6 6-6 6V6z"/>
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15 6l-6 6 6 6V6z"/>
          </svg>
        </button>
      </div>
      <div class="studio-dock__panel" v-if="!isStudioCollapsed">
        <StudioPane :dock="true" />
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
  position: relative; /* 供回底部按钮定位 */
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

.chat-actions .model-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-actions .model-selector .selector-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.chat-actions .model-selector .model-select {
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-primary);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  min-width: 120px;
  transition: all 0.2s;
}

.chat-actions .model-selector .model-select:hover {
  background: var(--hover-bg);
  border-color: var(--border-color);
}

.chat-actions .model-selector .model-select:focus {
  outline: none;
  border-color: var(--primary-color);
  background: var(--hover-bg);
}

.chat-actions .model-selector .model-select option {
  background: #ffffff;
  color: var(--text-primary);
  padding: 4px;
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
  padding: 12px 16px;
  border-top: 0px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background-color: #ffffff;
  border: none;
  border-radius: 10px;
  margin: 12px;
  height: 150px;
}

.message-input {
  flex: 1;
  padding: 12px;
  border-radius: 8px;
  border: 0px solid var(--border-color);
  resize: none;
  height: 100px;
  font-family: inherit;
  background-color: var(--bg-color);
  color: var(--text-primary);
}

/* Remove default focus outlines on inputs */
.message-input:focus,
.message-input:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}

.edit-message-input:focus,
.edit-message-input:focus-visible {
  outline: none !important;
  box-shadow: none !important;
}

.message-input::placeholder {
  color: var(--text-secondary);
}

.input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.generating-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 10px 0 6px 0;
}
.generating-banner .generating-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: none;
  background-image: var(--gradient-blue);
  border-radius: 9999px;
  box-shadow: 0 2px 6px rgba(99, 102, 241, 0.18);
  color: #ffffff;
}
.bounce-dot {
  width: 6px;
  height: 6px;
  background-color: #ffffff;
  border-radius: 50%;
  display: inline-block;
  animation: dotBounce 1.2s infinite ease-in-out;
}
.bounce-dot:nth-child(1) { animation-delay: 0s; }
.bounce-dot:nth-child(2) { animation-delay: 0.2s; }
.bounce-dot:nth-child(3) { animation-delay: 0.4s; }
.generating-text {
  font-size: 12px;
  color: #ffffff;
}

.generating-banner .stop-btn.banner {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
  font-size: 14px;
  line-height: 1;
}
.generating-banner .stop-btn.banner:hover {
  background: rgba(255, 255, 255, 0.24);
}

.left-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-selector .selector-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.model-selector .model-select {
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-primary);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  min-width: 120px;
  transition: all 0.2s;
}

.model-selector .model-select:hover {
  background: var(--hover-bg);
  border-color: var(--border-color);
}

.model-selector .model-select:focus {
  outline: none;
  border-color: var(--primary-color);
  background: var(--hover-bg);
}

.model-selector .model-select option {
  background: #ffffff;
  color: var(--text-primary);
  padding: 4px;
}

.manage-btn {
  height: 36px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--hover-bg);
  color: var(--text-primary);
  cursor: pointer;
}

.send-btn {
  background: transparent;
  border: none;
  padding: 6px;
  height: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #7c6cf1; /* light purple icon color */
  cursor: pointer;
}

.generate-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.generating-hint {
  font-size: 12px;
  color: var(--text-secondary);
}
.stop-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  cursor: pointer;
}
.stop-btn:hover {
  background: rgba(239, 68, 68, 0.18);
}

.send-btn:hover {
  color: #5f51e6; /* slightly darker on hover */
  transform: none;
  box-shadow: none;
  background: transparent;
}

.send-btn.icon svg {
  width: 18px;
  height: 18px;
  display: block;
}

/* 生成中转圈圈样式 */
.send-btn.icon.spinning {
  color: #7c6cf1; /* 继承按钮主色 */
}
.send-btn.icon .spinner {
  width: 18px;
  height: 18px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
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

/* Remove borders from TaskModeSelector and ModelSelector */
.model-selector .model-select,
.chat-actions .model-selector .model-select {
  border: none !important;
  box-shadow: none !important;
}

:deep(task-mode-selector),
:deep(task-mode-selector *) {
  border: none !important;
  box-shadow: none !important;
}

.model-selector :deep(*),
.chat-actions .model-selector :deep(*) {
  border: none !important;
  box-shadow: none !important;
}

/* 右侧 Studio 停靠容器 */
.studio-dock {
  width: 36%;
  min-width: 360px;
  background: transparent; /* 避免圆角处露出深色背景 */
  display: flex;
}

@media (max-width: 1024px) {
  .studio-dock {
    width: 32%;
    min-width: 300px;
  }
}

@media (max-width: 768px) {
  .studio-dock {
    display: none;
  }
}

/* Studio dock collapse/expand */
.studio-dock__gutter {
  width: 20px;
  min-width: 20px;
  background: var(--hover-bg);
  border-left: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
}
.studio-dock__panel {
  flex: 1;
  display: flex;
}
.studio-dock.collapsed {
  width: 20px !important;
  min-width: 20px !important;
}
.studio-toggle {
  width: 14px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,0.12);
}
.studio-toggle:hover {
  background: var(--hover-bg);
}

/* Scroll-to-bottom button */
.scroll-to-bottom {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 180px; /* 位于输入区上方，避免遮挡 */
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  border: 1px solid #C4B5FD; /* purple-300 */
  background: #EDE9FE; /* purple-100/200 淡紫色填充 */
  color: #6D28D9; /* 深紫色图标 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(109, 40, 217, 0.18);
  z-index: 3;
  animation: bounceDown 1.4s infinite ease-in-out;
}
.scroll-to-bottom:hover {
  background: #DDD6FE; /* hover 加深 */
  border-color: #A78BFA; /* purple-400 */
}

@keyframes bounceDown {
  0%, 100% {
    transform: translateX(-50%) translateY(0);
  }
  50% {
    transform: translateX(-50%) translateY(-6px);
  }
}

/* Token usage UI */
.token-usage {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  gap: 8px;
  align-items: center;
}
.token-usage .token-item {
  padding: 2px 6px;
  background: rgba(99, 102, 241, 0.08);
  border-radius: 6px;
}
.token-usage .estimated-prefix {
  color: #f59e0b;
}
.token-total {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 工具调用一行样式 */
.tool-call-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background-color: #eff6ff;
  border-left: 3px solid #3b82f6;
  border-radius: 6px;
  margin: 8px 0;
}

.hint-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.tool-call-inline {
  color: #1d4ed8;
  font-weight: 500;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tool-parameters-simple {
  color: #4b5563;
  font-size: 14px;
  font-weight: normal;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-status-inline {
  color: #059669;
  font-size: 11px;
  font-weight: 500;
  background-color: rgba(5, 150, 105, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
}

/* 消息块样式 */
.url-links-block,
.step-result-block {
  background-color: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px;
  margin: 8px 0;
  font-size: 14px;
  overflow-x: auto;
}


/* Studio URL链接样式 */
.studio-url-link {
  color: #3b82f6 !important;
  text-decoration: underline;
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 500;
}

.studio-url-link:hover {
  color: #1d4ed8 !important;
  background-color: rgba(59, 130, 246, 0.1);
  padding: 2px 4px;
  border-radius: 3px;
}

.tool-result-text pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Courier New', monospace;
  color: #374151;
}

/* 可点击块样式 */
.clickable-block {
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.clickable-block:hover {
  background-color: #f3f4f6;
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
  transform: translateY(-1px);
}

/* 计划步骤特殊样式 */
.plan-steps-block {
  background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s ease;
}

.plan-steps-block.collapsed {
  border-color: #94a3b8;
}

.plan-steps-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(59, 130, 246, 0.05);
  border-bottom: 1px solid #e2e8f0;
  cursor: pointer;
  transition: background-color 0.2s;
}

.plan-steps-header:hover {
  background: rgba(59, 130, 246, 0.1);
}

.plan-icon {
  font-size: 18px;
}

.plan-title {
  font-weight: 600;
  color: #1e293b;
  font-size: 15px;
  flex: 1;
}

.plan-collapse-icon {
  font-size: 12px;
  color: #64748b;
  transition: transform 0.2s;
}

.plan-steps-content {
  padding: 12px 16px;
  animation: fadeIn 0.3s ease;
}

.plan-steps-content ol {
  margin: 0;
  padding-left: 0;
  list-style: none;
}

.plan-step-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 4px;
  cursor: pointer;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.plan-step-item:hover {
  background: rgba(59, 130, 246, 0.08);
  border-left-color: #3b82f6;
}

.step-status-icon {
  font-size: 16px;
  min-width: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
}

.step-status-icon.status-pending {
  opacity: 0.7;
}

.step-status-icon.status-running {
  animation: pulse 1.5s infinite;
  color: #3b82f6;
}

.step-status-icon.status-completed {
  color: #10b981;
}

.step-status-icon.status-failed {
  color: #ef4444;
}

.step-content {
  flex: 1;
  line-height: 1.5;
  color: #374151;
}

.plan-hint {
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
  opacity: 0.8;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    max-height: 0;
  }
  to {
    opacity: 1;
    max-height: 500px;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.1);
  }
}

.tool-message-block pre,
.step-result-block pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.task-block {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  margin: 8px 0;
  background-color: #ffffff;
}

.task-header {
  padding: 12px 16px;
  background-color: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  font-weight: 600;
  color: #374151;
}

.task-body {
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.task-desc {
  flex: 1;
  color: #4b5563;
}

.task-preview-btn {
  padding: 6px 12px;
  background-color: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.task-preview-btn:hover {
  background-color: #2563eb;
}

/* 子任务进度样式 */
.subtask-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: #4b5563;
}

.success-icon {
  color: #10b981;
  font-size: 16px;
}

.fail-icon {
  color: #ef4444;
  font-size: 16px;
}

.running-icon {
  color: #3b82f6;
  font-size: 16px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* 最终结果样式 */
.final-result-block {
  border: 2px solid #3b82f6;
  border-radius: 12px;
  margin: 16px 0;
  overflow: hidden;
  background-color: #ffffff;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
}

.final-result-header {
  padding: 16px;
  background-color: #eff6ff;
  border-bottom: 1px solid #dbeafe;
  display: flex;
  align-items: center;
  gap: 12px;
}

.result-icon {
  font-size: 24px;
}

.result-title {
  font-weight: 600;
  font-size: 16px;
  color: #1e40af;
  flex: 1;
}

.result-status {
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 13px;
  background-color: #fbbf24;
  color: #92400e;
}

.result-status.complete {
  background-color: #34d399;
  color: #064e3b;
}

.final-result-content {
  padding: 20px;
  color: #1f2937;
  line-height: 1.8;
}

.final-result-content p {
  margin-bottom: 12px;
}

.final-result-content ul,
.final-result-content ol {
  margin-left: 20px;
  margin-bottom: 12px;
}

.final-result-content li {
  margin-bottom: 6px;
}

/* HTML报告样式（简化为超链接） */
.html-report-link a {
  color: #2563eb;
  text-decoration: underline;
  cursor: pointer;
}
.html-report-link a:hover {
  color: #1d4ed8;
}

/* User Agent消息样式 - 简约设计 */
.user-agent-block {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  margin: 6px 0;
  transition: all 0.2s ease;
}

.user-agent-block.collapsed {
  border-color: #e2e8f0;
}

.user-agent-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 4px 8px;
  background: #f1f5f9;
  cursor: pointer;
  transition: background-color 0.2s;
  min-height: 20px;
}

.user-agent-header:hover {
  background: #e2e8f0;
}

.user-agent-collapse-icon {
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.2s;
}

.user-agent-preview {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: 8px;
  opacity: 0.8;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-agent-content {
  padding: 12px;
  animation: fadeIn 0.2s ease;
}

.user-agent-text {
  font-size: 12px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.4;
  opacity: 0.9;
}

/* Assistant Agent消息样式 - 简约设计 */
.assistant-agent-block {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  overflow: hidden;
  margin: 6px 0;
  transition: all 0.2s ease;
}

.assistant-agent-block.collapsed {
  border-color: #e2e8f0;
}

.assistant-agent-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 4px 8px;
  background: #f1f5f9;
  cursor: pointer;
  transition: background-color 0.2s;
  min-height: 20px;
}

.assistant-agent-header:hover {
  background: #e2e8f0;
}

.assistant-agent-collapse-icon {
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.2s;
}

.assistant-agent-preview {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: 8px;
  opacity: 0.8;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.assistant-agent-content {
  padding: 12px;
  animation: fadeIn 0.2s ease;
}

.assistant-agent-text {
  font-size: 12px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  line-height: 1.4;
  opacity: 0.9;
}

.final-result-content code {
  background-color: #f3f4f6;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.9em;
}

.final-result-content pre {
  background-color: #1f2937;
  color: #f9fafb;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 12px 0;
}
</style>
