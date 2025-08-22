import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import databaseService from '../services/database';

export interface ModelSettings {
  modelName: string;
  apiUrl: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  developerMode: boolean; // 添加开发者模式选项
}

export const useSettingsStore = defineStore('settings', () => {
  // 默认设置
  const defaultSettings: ModelSettings = {
    modelName: 'gpt-3.5-turbo',
    apiUrl: 'https://api.openai.com/v1/completions',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 1500,
    developerMode: false // 默认关闭开发者模式
  };

  // 状态
  const settings = reactive<ModelSettings>({...defaultSettings});
  const isOpen = ref(false);
  
  // 日志相关
  const showLogPanel = ref(false);
  const logs = ref<{time: string, message: string, type: string}[]>([]);
  const maxLogs = ref(100); // 最多保存100条日志

  // 打开设置对话框
  function openSettings() {
    isOpen.value = true;
  }

  // 关闭设置对话框
  function closeSettings() {
    isOpen.value = false;
  }

  // 从数据库加载设置
  async function loadSettings() {
    try {
      const modelName = await databaseService.getSetting('modelName');
      const apiUrl = await databaseService.getSetting('apiUrl');
      const apiKey = await databaseService.getSetting('apiKey');
      const temperature = await databaseService.getSetting('temperature');
      const maxTokens = await databaseService.getSetting('maxTokens');
      const developerMode = await databaseService.getSetting('developerMode');

      if (modelName) settings.modelName = modelName;
      if (apiUrl) settings.apiUrl = apiUrl;
      if (apiKey) settings.apiKey = apiKey;
      if (temperature) settings.temperature = parseFloat(temperature);
      if (maxTokens) settings.maxTokens = parseInt(maxTokens);
      if (developerMode) settings.developerMode = developerMode === 'true';
      
      // 如果开发者模式开启，初始化日志拦截
      if (settings.developerMode) {
        initLogInterceptor();
      }
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }

  // 保存设置到数据库
  async function saveSettings() {
    try {
      await databaseService.setSetting('modelName', settings.modelName);
      await databaseService.setSetting('apiUrl', settings.apiUrl);
      await databaseService.setSetting('apiKey', settings.apiKey);
      await databaseService.setSetting('temperature', settings.temperature.toString());
      await databaseService.setSetting('maxTokens', settings.maxTokens.toString());
      await databaseService.setSetting('developerMode', settings.developerMode.toString());
      
      // 根据开发者模式设置初始化或移除日志拦截
      if (settings.developerMode) {
        initLogInterceptor();
      } else {
        removeLogInterceptor();
        showLogPanel.value = false;
      }
      
      closeSettings();
      return true;
    } catch (error) {
      console.error('保存设置失败:', error);
      return false;
    }
  }

  // 重置设置为默认值
  function resetSettings() {
    Object.assign(settings, defaultSettings);
  }
  
  // 添加日志
  function addLog(message: any, type: string = 'info') {
    const time = new Date().toLocaleTimeString();
    let logMessage = message;
    
    // 处理不同类型的消息
    if (typeof message === 'object') {
      try {
        logMessage = JSON.stringify(message);
      } catch (e) {
        logMessage = String(message);
      }
    }
    
    logs.value.push({ time, message: String(logMessage), type });
    
    // 限制日志数量
    if (logs.value.length > maxLogs.value) {
      logs.value = logs.value.slice(-maxLogs.value);
    }
  }
  
  // 清空日志
  function clearLogs() {
    logs.value = [];
  }
  
  // 初始化日志拦截器
  function initLogInterceptor() {
    if (typeof window !== 'undefined') {
      // 保存原始console方法
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      
      // 替换console.log
      console.log = function() {
        originalConsoleLog.apply(console, arguments);
        addLog(Array.from(arguments).join(' '), 'info');
      };
      
      // 替换console.error
      console.error = function() {
        originalConsoleError.apply(console, arguments);
        addLog(Array.from(arguments).join(' '), 'error');
      };
      
      // 替换console.warn
      console.warn = function() {
        originalConsoleWarn.apply(console, arguments);
        addLog(Array.from(arguments).join(' '), 'warning');
      };
      
      // 存储原始方法，以便后续可以恢复
      window._originalConsoleMethods = {
        log: originalConsoleLog,
        error: originalConsoleError,
        warn: originalConsoleWarn
      };
    }
  }
  
  // 移除日志拦截器
  function removeLogInterceptor() {
    if (typeof window !== 'undefined' && window._originalConsoleMethods) {
      console.log = window._originalConsoleMethods.log;
      console.error = window._originalConsoleMethods.error;
      console.warn = window._originalConsoleMethods.warn;
    }
  }
  
  // 切换日志面板显示状态
  function toggleLogPanel() {
    showLogPanel.value = !showLogPanel.value;
  }

  return {
    settings,
    isOpen,
    logs,
    showLogPanel,
    openSettings,
    closeSettings,
    loadSettings,
    saveSettings,
    resetSettings,
    toggleLogPanel,
    clearLogs,
    addLog
  };
}); 