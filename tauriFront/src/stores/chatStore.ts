import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import databaseService, { type Conversation, type Message } from '../services/database';
import { v4 as uuidv4 } from 'uuid';
import { CoordinateRolePlayAgent } from '../agents/CoordinateRolePlayAgent';

export const useChatStore = defineStore('chat', () => {
  // 状态
  const conversations = ref<Conversation[]>([]);
  const currentConversationId = ref<string>('');
  const messages = ref<Message[]>([]);
  const isLoading = ref<boolean>(false);

  // 获取当前对话
  const currentConversation = computed(() => 
    conversations.value.find(conv => conv.id === currentConversationId.value)
  );

  // 加载所有对话
  async function loadConversations() {
    isLoading.value = true;
    try {
      conversations.value = await databaseService.getConversations();
    } catch (error) {
      console.error('加载对话列表失败:', error);
    } finally {
      isLoading.value = false;
    }
  }

  // 加载特定对话的消息
  async function loadMessages(conversationId: string) {
    if (!conversationId) return;
    
    try {
      messages.value = await databaseService.getMessages(conversationId);
      currentConversationId.value = conversationId;
    } catch (error) {
      console.error('加载消息失败:', error);
    }
  }

  // 创建新对话
  async function createConversation(title: string = '新对话') {
    const id = uuidv4();
    
    try {
      await databaseService.createConversation({
        id,
        title
      });
      
      const newConversation: Conversation = {
        id,
        title,
        created_at: Date.now(),
        updated_at: Date.now()
      };
      
      conversations.value = [newConversation, ...conversations.value];
      await selectConversation(id);
      
      return id;
    } catch (error) {
      console.error('创建对话失败:', error);
      throw error;
    }
  }

  // 选择对话
  async function selectConversation(id: string) {
    if (id === currentConversationId.value) return;
    
    await loadMessages(id);
  }

  // 删除对话
  async function deleteConversation(id: string) {
    try {
      await databaseService.deleteConversation(id);
      
      // 更新本地状态
      conversations.value = conversations.value.filter(c => c.id !== id);
      
      // 如果删除的是当前选中的对话
      if (id === currentConversationId.value) {
        currentConversationId.value = '';
        messages.value = [];
        
        // 如果还有其他对话，选择第一个
        if (conversations.value.length > 0) {
          await selectConversation(conversations.value[0].id);
        }
      }
    } catch (error) {
      console.error('删除对话失败:', error);
      throw error;
    }
  }

  // 添加消息
  async function addMessage(content: string, role: 'user' | 'assistant' = 'user') {
    if (!content.trim() || !currentConversationId.value) return;

    const message: Message = {
      id: uuidv4(),
      conversation_id: currentConversationId.value,
      role,
      content,
      timestamp: Date.now()
    };

    try {
      await databaseService.addMessage(message);
      messages.value = [...messages.value, message];

      // 如果对话标题是默认的，且这是用户的第一条消息，更新标题
      const conversation = conversations.value.find(c => c.id === currentConversationId.value);
      if (conversation && conversation.title === '新对话' && role === 'user' && messages.value.length <= 2) {
        const newTitle = content.length > 20 ? `${content.substring(0, 20)}...` : content;
        await updateConversationTitle(currentConversationId.value, newTitle);
      }

      // 触发多智能体框架（协调代理）执行（仅在用户发送时）
      if (role === 'user') {
        const agent = new CoordinateRolePlayAgent();
        const controller = new AbortController();
        const assistantId = uuidv4();
        const assistantMessage: Message = {
          id: assistantId,
          conversation_id: currentConversationId.value,
          role: 'assistant',
          content: '正在分析与执行任务…',
          timestamp: Date.now(),
        };
        await databaseService.addMessage(assistantMessage);
        messages.value = [...messages.value, assistantMessage];

        try {
          const { ReplaySubject } = await import('rxjs');
          const { Studio } = await import('../agents/Studio');
          const taskRef: import('../agents/types').AgentTaskRef = {
            conversationId: currentConversationId.value,
            abortSignal: controller.signal,
            studio: new Studio(),
            observer: new ReplaySubject<import('../agents/types').MessageStream>(),
            createTaskMessage: async (task) => ({
              id: Date.now().toString(),
              conversationId: currentConversationId.value,
              content: '',
              role: 'ASSISTANT' as const,
              status: 'COMPLETED' as const,
              task,
            }),
            completeTaskMessage: async () => {},
            createMessage: async () => ({
              id: Date.now().toString(),
              conversationId: currentConversationId.value,
              content: '',
              role: 'ASSISTANT' as const,
              status: 'COMPLETED' as const,
              task: null,
            }),
            completeMessage: async () => {},
          };

          const finalAnswer = await agent.run(content, taskRef);
          assistantMessage.content = finalAnswer || '（任务执行已完成）';
          assistantMessage.timestamp = Date.now();
          messages.value = messages.value.map((m) => (m.id === assistantId ? { ...assistantMessage } : m));
          await databaseService.updateMessage(assistantMessage);
        } catch (err) {
          console.error('代理执行失败: ', err);
          assistantMessage.content = '执行失败，请重试。';
          assistantMessage.timestamp = Date.now();
          messages.value = messages.value.map((m) => (m.id === assistantId ? { ...assistantMessage } : m));
          await databaseService.updateMessage(assistantMessage);
        }
      }

      return message.id;
    } catch (error) {
      console.error('添加消息失败:', error);
      throw error;
    }
  }

  // 更新对话标题
  async function updateConversationTitle(id: string, title: string) {
    try {
      await databaseService.updateConversation(id, title);
      
      // 更新本地状态
      const index = conversations.value.findIndex(c => c.id === id);
      if (index !== -1) {
        conversations.value[index] = {
          ...conversations.value[index],
          title,
          updated_at: Date.now()
        };
      }
    } catch (error) {
      console.error('更新对话标题失败:', error);
      throw error;
    }
  }

  // 初始化
  async function initialize() {
    // 初始化数据库
    await databaseService.init();
    
    // 加载对话列表
    await loadConversations();
    
    // 如果有对话，选择第一个
    if (conversations.value.length > 0) {
      await selectConversation(conversations.value[0].id);
    }
  }

  return {
    // 状态
    conversations,
    currentConversationId,
    messages,
    isLoading,
    
    // 计算属性
    currentConversation,
    
    // 方法
    initialize,
    loadConversations,
    loadMessages,
    createConversation,
    selectConversation,
    deleteConversation,
    addMessage,
    updateConversationTitle
  };
});