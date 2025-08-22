// Token计数器工具类
// 用于统计AI模型的token使用情况

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface TokenStats {
  currentSession: TokenUsage;
  totalUsage: TokenUsage;
  lastUpdated: number;
}

export class TokenCounter {
  private static instance: TokenCounter;
  private tokenStats: TokenStats = {
    currentSession: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    totalUsage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    lastUpdated: Date.now()
  };

  // 事件监听器用于向前端发送实时更新
  private listeners: Array<(stats: TokenStats) => void> = [];

  private constructor() {}

  public static getInstance(): TokenCounter {
    if (!TokenCounter.instance) {
      TokenCounter.instance = new TokenCounter();
    }
    return TokenCounter.instance;
  }

  /**
   * 添加token使用量
   * @param usage 本次API调用的token使用量
   */
  public addUsage(usage: TokenUsage): void {
    this.tokenStats.currentSession.prompt_tokens += usage.prompt_tokens;
    this.tokenStats.currentSession.completion_tokens += usage.completion_tokens;
    this.tokenStats.currentSession.total_tokens += usage.total_tokens;

    this.tokenStats.totalUsage.prompt_tokens += usage.prompt_tokens;
    this.tokenStats.totalUsage.completion_tokens += usage.completion_tokens;
    this.tokenStats.totalUsage.total_tokens += usage.total_tokens;

    this.tokenStats.lastUpdated = Date.now();

    // 通知所有监听器
    this.notifyListeners();
  }

  /**
   * 获取当前token统计信息
   */
  public getStats(): TokenStats {
    return { ...this.tokenStats };
  }

  /**
   * 重置当前会话的token统计
   */
  public resetCurrentSession(): void {
    this.tokenStats.currentSession = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    };
    this.tokenStats.lastUpdated = Date.now();
    this.notifyListeners();
  }

  /**
   * 重置所有token统计
   */
  public resetAll(): void {
    this.tokenStats = {
      currentSession: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      totalUsage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      lastUpdated: Date.now()
    };
    this.notifyListeners();
  }

  /**
   * 添加token使用统计监听器
   * @param listener 监听器函数
   */
  public addListener(listener: (stats: TokenStats) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除token使用统计监听器
   * @param listener 要移除的监听器函数
   */
  public removeListener(listener: (stats: TokenStats) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    const stats = this.getStats();
    this.listeners.forEach(listener => {
      try {
        listener(stats);
      } catch (error) {
        console.error('Error in token stats listener:', error);
      }
    });
  }
}

// 导出单例实例
export const tokenCounter = TokenCounter.getInstance();