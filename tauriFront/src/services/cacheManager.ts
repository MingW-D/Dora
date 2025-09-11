import { ref, reactive } from 'vue';
import databaseService, { type Message } from './database';
import { v4 as uuidv4 } from 'uuid';

// 内容块类型定义
export interface MessageContentBlock {
  type: 'text' | 'tool_call' | 'url_links' | 'plan_steps' | 'step_result' | 'tool_message' | 'task' | 'subtask_status' | 'final_result' | 'html_report' | 'htmlReport' | 'user_agent' | 'assistant_agent';
  content: string | string[] | any;
  timestamp?: number;
  id?: string;
}

// 缓存对话数据结构
export interface CachedConversation {
  id: string;
  messages: Message[];
  toolCalls: Map<string, string>;        // 消息ID -> 工具调用名称
  urlLinks: Map<string, string[]>;       // 消息ID -> URL链接数组
  contentBlocks: Map<string, MessageContentBlock[]>; // 消息ID -> 内容块数组
  planStatuses?: Map<string, any>;       // 消息ID -> 计划状态
  stepResults?: Map<string, Map<string, any>>; // 消息ID -> 步骤结果映射
  planComparisons?: Map<string, any>;    // 消息ID -> 计划对比数据
  lastAccessed: number;                  // 最后访问时间戳
  isDirty: boolean;                      // 是否有未保存的更改
  isGenerating: boolean;                 // 是否正在生成中
  metadata: {                           // 对话元数据
    title: string;
    createdAt: number;
    updatedAt: number;
  };
}

// 缓存管理器配置
interface CacheConfig {
  maxCachedConversations: number;        // 最大缓存对话数量
  generatingConversationBonus: number;   // 生成中对话额外保留数量
  syncIntervalMs: number;                // 同步到数据库的间隔(毫秒)
  memoryThresholdPercent: number;        // 内存占用阈值百分比
}

/**
 * 缓存管理器类 - 实现LRU缓存策略和数据分层架构
 */
class CacheManager {
  private cache = reactive(new Map<string, CachedConversation>());
  private config: CacheConfig = {
    maxCachedConversations: 20,          // 默认缓存20个对话
    generatingConversationBonus: 5,      // 额外保留5个生成中对话
    syncIntervalMs: 10000,               // 10秒同步一次
    memoryThresholdPercent: 20           // 内存占用阈值20%
  };
  private syncTimer: number | null = null;
  private dirtyItems = new Set<string>(); // 需要同步到数据库的对话ID

  // 是否初始化完成
  private initialized = ref(false);
  
  /**
   * 初始化缓存管理器
   */
  async init(config?: Partial<CacheConfig>): Promise<void> {
    if (this.initialized.value) return;
    
    // 更新配置
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    try {
      // 确保数据库已初始化
      await databaseService.init();
      
      // 加载最近的对话到缓存
      await this.preloadRecentConversations();
      
      // 启动同步定时器
      this.startSyncTimer();
      
      this.initialized.value = true;
      console.log('缓存管理器初始化完成，已加载', this.cache.size, '个对话');
    } catch (error) {
      console.error('缓存管理器初始化失败:', error);
      throw error;
    }
  }
  
  /**
   * 预加载最近的对话到缓存
   */
  private async preloadRecentConversations(): Promise<void> {
    try {
      // 获取最近的对话列表
      const conversations = await databaseService.getConversations();
      const recentConversations = conversations.slice(0, this.config.maxCachedConversations);
      
      // 加载每个对话的消息
      for (const conversation of recentConversations) {
        const messages = await databaseService.getMessages(conversation.id);
        
        // 创建缓存对象
        const cachedConversation: CachedConversation = {
          id: conversation.id,
          messages: messages,
          toolCalls: new Map(),
          urlLinks: new Map(),
          contentBlocks: new Map(),
          lastAccessed: Date.now(),
          isDirty: false,
          isGenerating: false,
          metadata: {
            title: conversation.title,
            createdAt: conversation.created_at,
            updatedAt: conversation.updated_at
          }
        };
        
        // 解析消息中的工具调用和URL链接
        await this.parseMessageContent(cachedConversation);
        
        // 添加到缓存
        this.cache.set(conversation.id, cachedConversation);
      }
    } catch (error) {
      console.error('预加载对话失败:', error);
      throw error;
    }
  }
  
  /**
   * 解析消息内容，提取工具调用和URL链接
   */
  private async parseMessageContent(conversation: CachedConversation): Promise<void> {
    for (const message of conversation.messages) {
      if (message.role === 'assistant') {
        try {
          // 尝试解析JSON格式的内容块
          const contentData = JSON.parse(message.content);
          
          // 检查是否为内容块数组
          if (Array.isArray(contentData) && contentData.length > 0) {
            // 使用解析出的内容块
            conversation.contentBlocks.set(message.id, contentData);
            
            // 提取工具调用和URL链接
            for (const block of contentData) {
              if (block.type === 'tool_call') {
                conversation.toolCalls.set(message.id, block.content as string);
              } else if (block.type === 'url_links') {
                conversation.urlLinks.set(message.id, block.content as string[]);
              }
              // tool_message, subtask_status, final_result 类型的消息不需要特别处理，已经在contentBlocks中
            }
          } else {
            // 如果不是数组或为空，创建单个文本块
            conversation.contentBlocks.set(message.id, [
              {
                type: 'text',
                content: message.content,
                timestamp: message.timestamp
              }
            ]);
          }
        } catch (e) {
          // 解析失败，表示内容不是JSON格式，按普通文本处理
          conversation.contentBlocks.set(message.id, [
            {
              type: 'text',
              content: message.content,
              timestamp: message.timestamp
            }
          ]);
        }
      }
    }
  }
  
  /**
   * 启动同步定时器
   */
  private startSyncTimer(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
    }
    
    this.syncTimer = window.setInterval(() => {
      this.syncDirtyItemsToDatabase();
    }, this.config.syncIntervalMs);
  }
  
  /**
   * 同步脏数据到数据库
   */
  async syncDirtyItemsToDatabase(): Promise<void> {
    if (this.dirtyItems.size === 0) return;
    
    console.log(`开始同步 ${this.dirtyItems.size} 个对话到数据库`);
    
    const itemsToSync = Array.from(this.dirtyItems);
    this.dirtyItems.clear();
    
    for (const conversationId of itemsToSync) {
      try {
        const conversation = this.cache.get(conversationId);
        if (!conversation) continue;
        
        // 更新对话元数据
        await databaseService.updateConversation(
          conversationId, 
          conversation.metadata.title
        );
        
        // 更新或添加消息
        for (const message of conversation.messages) {
          // 检查消息是否有内容块
          if (conversation.contentBlocks.has(message.id)) {
            // 将内容块转换为JSON格式
            const contentBlocks = conversation.contentBlocks.get(message.id);
            if (contentBlocks && contentBlocks.length > 0) {
              // 将内容块序列化为JSON字符串
              message.content = JSON.stringify(contentBlocks);
            }
          }
          
          try {
            // 使用更安全的方式保存消息到数据库 - 先尝试更新，如果没有行受影响则插入
            const db = await (databaseService as any).ensureConnection();
            const result = await db.execute(
              'UPDATE messages SET content = $1, timestamp = $2 WHERE id = $3',
              [message.content, message.timestamp, message.id]
            );
            
            // 如果没有更新任何行，说明消息不存在，需要插入
            if (result.rowsAffected === 0) {
              await databaseService.addMessage(message);
            }
          } catch (dbError) {
            // 捕获并记录单个消息的错误，但不中断整个同步过程
            console.error(`保存消息 ${message.id} 失败:`, dbError);
          }
        }
        
        // **关键修复：同步计划状态到数据库**
        if (conversation.planStatuses) {
          for (const [messageId, planStatus] of conversation.planStatuses) {
            try {
              // **关键修复：所有计划状态都保存到数据库，包括未确认的**
              const completePlanStatus = {
                ...planStatus,
                messageId: messageId || planStatus.messageId, // 确保messageId存在
                conversationId: conversationId || planStatus.conversationId // 确保conversationId存在
              };
              
              // 验证必需字段
              if (!completePlanStatus.messageId) {
                console.error(`计划状态缺少messageId，跳过保存:`, planStatus);
                continue;
              }
              
              await databaseService.savePlanStatus(completePlanStatus as any);
              console.log(`计划状态已同步到数据库: ${messageId}, 状态: ${planStatus.status}`);
            } catch (dbError) {
              console.error(`保存计划状态 ${messageId} 失败:`, dbError);
            }
          }
        }
        
        // **关键修复：同步步骤结果到数据库**
        if (conversation.stepResults) {
          for (const [messageId, stepResultsMap] of conversation.stepResults) {
            try {
              for (const [stepId, stepResult] of stepResultsMap) {
                // 步骤结果通过updateStepStatus方法更新
                await databaseService.updateStepStatus(
                  stepId,
                  (stepResult as any).status || 'completed',
                  (stepResult as any).result || stepResult,
                  (stepResult as any).error
                );
              }
              console.log(`步骤结果已同步到数据库: ${messageId}`);
            } catch (dbError) {
              console.error(`保存步骤结果 ${messageId} 失败:`, dbError);
            }
          }
        }
        
        // 标记为已同步
        conversation.isDirty = false;
        
        console.log(`对话 ${conversationId.substring(0, 6)} 已同步到数据库`);
      } catch (error) {
        console.error(`同步对话 ${conversationId} 失败:`, error);
        // 重新添加到脏数据集合，下次再尝试
        this.dirtyItems.add(conversationId);
      }
    }
  }
  
  /**
   * 获取对话，优先从缓存读取，缓存未命中则从数据库加载
   */
  async getConversation(id: string): Promise<CachedConversation | null> {
    // 检查缓存
    if (this.cache.has(id)) {
      const conversation = this.cache.get(id)!;
      // 更新最后访问时间
      conversation.lastAccessed = Date.now();
      return conversation;
    }
    
    // 缓存未命中，从数据库加载
    try {
      const conversationData = await databaseService.getConversation(id);
      if (!conversationData) return null;
      
      const messages = await databaseService.getMessages(id);
      
      // 创建缓存对象
      const cachedConversation: CachedConversation = {
        id: conversationData.id,
        messages: messages,
        toolCalls: new Map(),
        urlLinks: new Map(),
        contentBlocks: new Map(),
        planStatuses: new Map(),
        stepResults: new Map(),
        lastAccessed: Date.now(),
        isDirty: false,
        isGenerating: false,
        metadata: {
          title: conversationData.title,
          createdAt: conversationData.created_at,
          updatedAt: conversationData.updated_at
        }
      };
      
      // 解析消息中的工具调用和URL链接
      await this.parseMessageContent(cachedConversation);
      
      // 添加到缓存前检查容量
      this.ensureCacheCapacity();
      
      // 添加到缓存
      this.cache.set(id, cachedConversation);
      
      return cachedConversation;
    } catch (error) {
      console.error(`加载对话 ${id} 失败:`, error);
      return null;
    }
  }
  
  /**
   * 获取所有缓存的对话
   */
  getCachedConversations(): CachedConversation[] {
    return Array.from(this.cache.values());
  }
  
  /**
   * 创建新对话
   */
  async createConversation(title: string = '新对话'): Promise<CachedConversation> {
    const id = uuidv4();
    const now = Date.now();
    
    // 创建缓存对象
    const cachedConversation: CachedConversation = {
      id: id,
      messages: [],
      toolCalls: new Map(),
      urlLinks: new Map(),
      contentBlocks: new Map(),
      planStatuses: new Map(),
      stepResults: new Map(),
      lastAccessed: now,
      isDirty: true,
      isGenerating: false,
      metadata: {
        title: title,
        createdAt: now,
        updatedAt: now
      }
    };
    
    // 确保缓存容量
    this.ensureCacheCapacity();
    
    // 添加到缓存
    this.cache.set(id, cachedConversation);
    this.dirtyItems.add(id);
    
    // 创建数据库记录
    await databaseService.createConversation({
      id: id,
      title: title
    });
    
    return cachedConversation;
  }
  
  /**
   * 更新对话
   */
  updateConversation(id: string, updates: Partial<CachedConversation>): boolean {
    if (!this.cache.has(id)) return false;
    
    const conversation = this.cache.get(id)!;
    
    // 更新消息
    if (updates.messages) {
      conversation.messages = updates.messages;
    }
    
    // 更新工具调用
    if (updates.toolCalls) {
      conversation.toolCalls = updates.toolCalls;
    }
    
    // 更新URL链接
    if (updates.urlLinks) {
      conversation.urlLinks = updates.urlLinks;
    }
    
    // 更新内容块
    if (updates.contentBlocks) {
      conversation.contentBlocks = updates.contentBlocks;
    }
    
    // 更新计划状态
    if (updates.planStatuses) {
      conversation.planStatuses = updates.planStatuses;
    }
    
    // 更新步骤结果
    if (updates.stepResults) {
      conversation.stepResults = updates.stepResults;
    }
    
    // 更新元数据
    if (updates.metadata) {
      conversation.metadata = {
        ...conversation.metadata,
        ...updates.metadata,
        updatedAt: Date.now()
      };
    } else {
      // 即使没有明确的元数据更新，也要更新时间戳
      conversation.metadata.updatedAt = Date.now();
    }
    
    // 更新生成状态
    if (updates.isGenerating !== undefined) {
      conversation.isGenerating = updates.isGenerating;
    }
    
    // 标记为脏数据
    conversation.isDirty = true;
    this.dirtyItems.add(id);
    
    // 更新最后访问时间
    conversation.lastAccessed = Date.now();
    
    return true;
  }
  
  /**
   * 添加消息到对话
   */
  async addMessage(conversationId: string, message: Message): Promise<boolean> {
    // 确保对话存在于缓存中
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return false;
    
    // **关键修复：检查消息是否已经存在，防止重复添加**
    const existingMessage = conversation.messages.find(msg => msg.id === message.id);
    if (existingMessage) {
      console.log(`消息已存在，跳过添加: ${message.id.substring(0, 8)}`);
      return false;
    }
    
    // 添加消息
    conversation.messages.push(message);
    console.log(`成功添加消息到缓存: ${message.id.substring(0, 8)}, 角色: ${message.role}`);
    
    // 更新元数据
    conversation.metadata.updatedAt = Date.now();
    
    // 标记为脏数据
    conversation.isDirty = true;
    this.dirtyItems.add(conversationId);
    
    return true;
  }
  
  /**
   * 更新消息内容
   */
  updateMessage(
    conversationId: string, 
    messageId: string, 
    content: string,
    contentBlocks?: MessageContentBlock[]
  ): boolean {
    if (!this.cache.has(conversationId)) return false;
    
    const conversation = this.cache.get(conversationId)!;
    
    // 查找消息
    const messageIndex = conversation.messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) return false;
    
    // 更新消息内容
    conversation.messages[messageIndex].content = content;
    conversation.messages[messageIndex].timestamp = Date.now();
    
    // 更新内容块
    if (contentBlocks) {
      conversation.contentBlocks.set(messageId, contentBlocks);
      
      // 更新工具调用和URL链接映射
      for (const block of contentBlocks) {
        if (block.type === 'tool_call') {
          conversation.toolCalls.set(messageId, block.content as string);
        } else if (block.type === 'url_links') {
          conversation.urlLinks.set(messageId, block.content as string[]);
        }
      }
    }
    
    // 标记为脏数据
    conversation.isDirty = true;
    this.dirtyItems.add(conversationId);
    
    return true;
  }
  
  /**
   * 添加或更新内容块
   */
  updateContentBlocks(
    conversationId: string,
    messageId: string,
    blocks: MessageContentBlock[]
  ): boolean {
    if (!this.cache.has(conversationId)) return false;
    
    const conversation = this.cache.get(conversationId)!;
    
    // 更新内容块
    conversation.contentBlocks.set(messageId, blocks);
    
    // 更新工具调用和URL链接映射
    for (const block of blocks) {
      if (block.type === 'tool_call') {
        conversation.toolCalls.set(messageId, block.content as string);
      } else if (block.type === 'url_links') {
        conversation.urlLinks.set(messageId, block.content as string[]);
      }
    }
    
    // 标记为脏数据
    conversation.isDirty = true;
    this.dirtyItems.add(conversationId);
    
    return true;
  }
  
  /**
   * 删除对话
   */
  async deleteConversation(id: string): Promise<boolean> {
    // 从缓存中移除
    if (this.cache.has(id)) {
      this.cache.delete(id);
    }
    
    // 从脏数据集合中移除
    this.dirtyItems.delete(id);
    
    // 从数据库中删除
    try {
      await databaseService.deleteConversation(id);
      return true;
    } catch (error) {
      console.error(`删除对话 ${id} 失败:`, error);
      return false;
    }
  }
  
  /**
   * 设置对话生成状态
   */
  setGeneratingStatus(id: string, isGenerating: boolean): boolean {
    if (!this.cache.has(id)) return false;
    
    const conversation = this.cache.get(id)!;
    conversation.isGenerating = isGenerating;
    conversation.lastAccessed = Date.now();
    
    return true;
  }
  
  /**
   * 确保缓存容量不超过限制
   */
  private ensureCacheCapacity(): void {
    // 如果缓存未满，直接返回
    if (this.cache.size < this.config.maxCachedConversations) return;
    
    // 计算需要保留的生成中对话数量
    const generatingConversations = Array.from(this.cache.values())
      .filter(conv => conv.isGenerating);
    
    const maxNonGeneratingConversations = 
      this.config.maxCachedConversations - Math.min(
        generatingConversations.length,
        this.config.generatingConversationBonus
      );
    
    // 如果非生成中对话数量未超过限制，直接返回
    const nonGeneratingConversations = Array.from(this.cache.values())
      .filter(conv => !conv.isGenerating);
    
    if (nonGeneratingConversations.length <= maxNonGeneratingConversations) return;
    
    // 按最后访问时间排序
    nonGeneratingConversations.sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    // 计算需要移除的数量
    const removeCount = nonGeneratingConversations.length - maxNonGeneratingConversations;
    
    // 移除最旧的非生成中对话
    for (let i = 0; i < removeCount; i++) {
      const conversation = nonGeneratingConversations[i];
      
      // 如果有未保存的更改，先同步到数据库
      if (conversation.isDirty) {
        this.dirtyItems.add(conversation.id);
      }
      
      // 从缓存中移除
      this.cache.delete(conversation.id);
      
      console.log(`缓存容量控制: 移除对话 ${conversation.id.substring(0, 6)}`);
    }
  }
  
  /**
   * 强制同步所有缓存到数据库
   */
  async forceSyncAll(): Promise<void> {
    // 将所有对话标记为脏数据
    for (const [id, conversation] of this.cache.entries()) {
      if (conversation.isDirty) {
        this.dirtyItems.add(id);
      }
    }
    
    // 执行同步
    await this.syncDirtyItemsToDatabase();
  }
  
  /**
   * 清理缓存
   */
  async cleanup(): Promise<void> {
    // 同步所有未保存的更改
    await this.forceSyncAll();
    
    // 清空缓存
    this.cache.clear();
    this.dirtyItems.clear();
    
    // 停止同步定时器
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    
    this.initialized.value = false;
  }
}

// 导出单例
const cacheManager = new CacheManager();
export default cacheManager;