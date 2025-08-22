<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import type { StepResult, PlanStatus } from '../types';

// 定义emits
const emit = defineEmits(['confirm-plan', 'regenerate-plan', 'edit-plan', 'accept-new-plan', 'reject-new-plan']);

// 定义props
const props = defineProps({
  planSteps: {
    type: String,
    required: true
  },
  messageId: {
    type: String,
    required: true
  },
  conversationId: {
    type: String,
    required: true
  },
  readonly: {
    type: Boolean,
    default: false
  },
  stepResults: {
    type: Object as () => Map<string, StepResult>,
    default: () => new Map()
  },
  planStatus: {
    type: Object as () => PlanStatus | null,
    default: null
  },
  // 新增：计划对比数据
  planComparison: {
    type: Object as () => any,
    default: null
  }
});

// 状态变量
const isLoading = ref(false);
// 新增：对比模式相关状态
const isComparisonMode = ref(false);
// 动态步骤对比状态
const stepStates = ref(new Map<number, { accepted: boolean; rejected: boolean }>());
// 最终计划状态 - 用于在对比模式结束后显示最终计划
const finalPlanContent = ref('');
// 步骤编辑状态
const editingStepIndex = ref(-1);
const editingStepContent = ref('');
// **新增：计划面板折叠状态**
const isPlanCollapsed = ref(false);
// 根据计划状态初始化动作状态
const getInitialActionStatus = () => {
  if (props.planStatus) {
    switch (props.planStatus.status) {
      case 'confirmed':
      case 'executing':
      case 'completed':
        return 'confirmed';
      case 'failed':
        return 'pending';
      default:
        return 'pending';
    }
  }
  return 'pending';
};

const actionStatus = ref<'pending' | 'confirmed' | 'regenerating'>(getInitialActionStatus());
const collapsedSteps = ref(new Set<number>());

// **最简方案：添加步骤结果流式展示相关状态** 
const streamingSteps = ref(new Set<number>()); // 正在流式显示的步骤
const stepUpdateTimers = ref(new Map<number, NodeJS.Timeout>()); // 步骤更新定时器
const streamingContent = ref(new Map<number, string>()); // 正在流式显示的内容
const streamingTimers = ref(new Map<number, NodeJS.Timeout>()); // 流式显示定时器
const userScrollPaused = ref(new Map<number, boolean>()); // 用户是否暂停了自动滚动
const resultContainerRefs = ref(new Map<number, HTMLElement>()); // 结果容器的引用

// 监听计划状态变化，更新动作状态
watch(() => props.planStatus, (newPlanStatus) => {
  if (newPlanStatus) {
    switch (newPlanStatus.status) {
      case 'confirmed':
      case 'executing':
      case 'completed':
        actionStatus.value = 'confirmed';
        // **关键：计划确认后自动折叠计划面板**
        if (newPlanStatus.status === 'confirmed' || newPlanStatus.status === 'executing') {
          isPlanCollapsed.value = true;
          console.log('计划已确认，折叠计划面板');
        }
        break;
      case 'failed':
        actionStatus.value = 'pending';
        break;
      default:
        actionStatus.value = 'pending';
        isPlanCollapsed.value = false; // 重置折叠状态
    }
  } else {
    actionStatus.value = 'pending';
    isPlanCollapsed.value = false;
  }
}, { immediate: true });

// 监听计划对比数据变化
watch(() => props.planComparison, (newComparison) => {
  if (newComparison && newComparison.status === 'success') {
    isComparisonMode.value = true;
    actionStatus.value = 'regenerating';
    // 重置步骤状态
    stepStates.value.clear();
    // 清除之前的最终计划内容，确保显示新的对比
    finalPlanContent.value = '';
    console.log('收到计划对比数据:', newComparison);
  } else {
    isComparisonMode.value = false;
    stepStates.value.clear();
  }
}, { immediate: true });

// **新增：切换计划面板折叠状态**
const togglePlanCollapse = () => {
  isPlanCollapsed.value = !isPlanCollapsed.value;
  console.log('切换计划面板折叠状态:', isPlanCollapsed.value);
};



// **关键修复：监听步骤结果变化，实现流式展示和自动折叠**
watch(() => props.stepResults, (newStepResults) => {
  if (!newStepResults) return;
  
  const steps = formatPlanSteps(props.planSteps);
  
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const stepResult = getStepStatus(stepIndex);
    
    if (stepResult) {
      const { status } = stepResult;
      
      // 处理步骤状态变化
      if (status === 'running') {
        // 开始运行时，展开步骤结果
        streamingSteps.value.add(stepIndex);
        collapsedSteps.value.delete(stepIndex);
        
        // 清除之前的定时器
        const existingTimer = stepUpdateTimers.value.get(stepIndex);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        
        // 步骤开始运行时，初始化滚动状态
        userScrollPaused.value.set(stepIndex, false);
        
        // 延迟一下确保容器已创建后滚动
        setTimeout(() => {
          simpleScrollToBottom(stepIndex);
        }, 100);
      } else if (status === 'completed' || status === 'failed') {
        // **关键修复：开始流式展示结果内容**
        const content = stepResult.result ? formatStepResult(stepResult.result) : stepResult.error;
        if (content && content.length > 50) { // 只对长内容进行流式展示
          streamingSteps.value.add(stepIndex);
          collapsedSteps.value.delete(stepIndex);
          
          // 清除之前的折叠定时器
          const existingTimer = stepUpdateTimers.value.get(stepIndex);
          if (existingTimer) {
            clearTimeout(existingTimer);
            stepUpdateTimers.value.delete(stepIndex);
          }
          
          // 初始化滚动状态
          userScrollPaused.value.set(stepIndex, false);
          
          startStreamingContent(stepIndex, content);
        } else {
          // 短内容直接显示，立即设置折叠定时器
          streamingSteps.value.delete(stepIndex);
          
          // 短内容也只需要容器内滚动，不需要页面滚动
          
          const timer = setTimeout(() => {
            collapsedSteps.value.add(stepIndex);
            stepUpdateTimers.value.delete(stepIndex);
          }, 3000); // 短内容3秒后折叠
          
          stepUpdateTimers.value.set(stepIndex, timer);
        }
      }
    }
  }
}, { deep: true });

// 组件挂载时不需要页面滚动，只需要结果容器滚动
// onMounted(() => {
//   // 只保留结果容器滚动功能
// });

// **最简方案：组件销毁时清理定时器和状态**
onUnmounted(() => {
  stepUpdateTimers.value.forEach(timer => clearTimeout(timer));
  stepUpdateTimers.value.clear();
  streamingTimers.value.forEach(timer => clearTimeout(timer));
  streamingTimers.value.clear();
  userScrollPaused.value.clear();
  streamingSteps.value.clear();
  streamingContent.value.clear();
  resultContainerRefs.value.clear();
  // 清理最终计划内容
  finalPlanContent.value = '';
});

// 计算属性
const displayContent = computed(() => {
  if (finalPlanContent.value) {
    // 如果有最终计划内容，使用最终计划
    return finalPlanContent.value;
  } else {
    // 否则使用原始计划
    return props.planSteps;
  }
});

const isActionDisabled = computed(() => {
  return isLoading.value || props.readonly || actionStatus.value !== 'pending';
});

// 显示步骤的计算属性
const displaySteps = computed(() => {
  if (!props.planComparison) {
    // 没有对比数据时，显示原计划
    const originalSteps = formatPlanSteps(props.planSteps);
    return originalSteps.map((step) => ({
      original: step,
      new: null,
      showOriginal: true,
      showNew: false,
      accepted: false,
      rejected: false,
      shouldDelete: false,
      justAdded: false
    }));
  }
  
  const originalSteps = formatPlanSteps(props.planComparison.plan_comparison?.original_text || props.planSteps);
  const newSteps = formatPlanSteps(props.planComparison.plan_comparison?.new_text || '');
  
  const maxLength = Math.max(originalSteps.length, newSteps.length);
  const steps = [];
  
  for (let i = 0; i < maxLength; i++) {
    const stepState = stepStates.value.get(i) || { accepted: false, rejected: false };
    const hasNewStep = newSteps[i] && newSteps[i] !== originalSteps[i];
    
    steps.push({
      original: originalSteps[i] || null,
      new: newSteps[i] || null,
      // 显示逻辑：
      // 1. 如果没有新步骤，显示原步骤
      // 2. 如果有新步骤但未处理，同时显示原步骤和新步骤
      // 3. 如果接受了新步骤，只显示新步骤
      // 4. 如果拒绝了新步骤，只显示原步骤
      showOriginal: (!hasNewStep || (!stepState.accepted && !stepState.rejected) || stepState.rejected) && !stepState.accepted,
      showNew: hasNewStep && !stepState.rejected,
      accepted: stepState.accepted,
      rejected: stepState.rejected,
      shouldDelete: stepState.accepted && hasNewStep, // 接受新步骤时，原步骤应该删除
      justAdded: hasNewStep && !stepState.accepted && !stepState.rejected // 刚添加的新步骤
    });
  }
  
  return steps;
});

// 检查是否所有有变化的步骤都已处理完成
const allStepsProcessed = computed(() => {
  return displaySteps.value.every(step => {
    // 如果没有新步骤，认为已处理
    if (!step.new || step.new === step.original) return true;
    // 如果有新步骤，必须已接受或已拒绝
    return step.accepted || step.rejected;
  });
});

// 方法
const confirmPlan = async () => {
  if (isActionDisabled.value) return;
  
  try {
    isLoading.value = true;
    actionStatus.value = 'confirmed';
    
    // **新增：确认后立即折叠计划面板**
    isPlanCollapsed.value = true;
    
    // 使用当前显示的计划内容，而不是原始计划
    const currentPlan = finalPlanContent.value || props.planSteps;
    
    emit('confirm-plan', {
      messageId: props.messageId,
      conversationId: props.conversationId,
      planSteps: currentPlan
    });
    
    console.log('用户确认执行计划，计划面板已折叠:', currentPlan);
  } catch (error) {
    console.error('确认计划失败:', error);
    actionStatus.value = 'pending';
    // 失败时恢复计划面板显示
    isPlanCollapsed.value = false;
  } finally {
    isLoading.value = false;
  }
};

const regeneratePlan = async () => {
  if (isActionDisabled.value) return;
  
  try {
    isLoading.value = true;
    actionStatus.value = 'regenerating';
    
    // 清除之前的最终计划内容
    finalPlanContent.value = '';
    
    emit('regenerate-plan', {
      messageId: props.messageId,
      conversationId: props.conversationId
    });
    
    console.log('用户请求重新生成计划');
  } catch (error) {
    console.error('重新生成计划失败:', error);
    actionStatus.value = 'pending';
  } finally {
    isLoading.value = false;
  }
};

// 双击编辑步骤
const startEditingStep = (stepIndex: number, stepContent: string) => {
  if (props.readonly || actionStatus.value === 'confirmed') return;
  
  console.log('开始编辑步骤:', stepIndex, '原内容:', stepContent);
  console.log('当前displayContent:', displayContent.value);
  
  editingStepIndex.value = stepIndex;
  editingStepContent.value = stepContent;
  
  // 下一帧自动聚焦到输入框
  nextTick(() => {
    const input = document.querySelector('.step-edit-input') as HTMLInputElement;
    if (input) {
      input.focus();
      input.select();
    }
  });
};

const cancelEditingStep = () => {
  editingStepIndex.value = -1;
  editingStepContent.value = '';
};

const saveEditedStep = async () => {
  if (!editingStepContent.value.trim() || editingStepIndex.value === -1) return;
  
  try {
    console.log('保存编辑步骤:', editingStepIndex.value, '新内容:', editingStepContent.value);
    
    // 更新步骤内容
    const steps = formatPlanSteps(displayContent.value);
    console.log('当前所有步骤:', steps);
    console.log('修改前步骤', editingStepIndex.value, ':', steps[editingStepIndex.value]);
    
    steps[editingStepIndex.value] = editingStepContent.value;
    const updatedPlan = steps.join('\n');
    
    console.log('修改后步骤', editingStepIndex.value, ':', steps[editingStepIndex.value]);
    console.log('更新后的完整计划:', updatedPlan);
    
    // 立即更新本地显示内容
    finalPlanContent.value = updatedPlan;
    
    emit('edit-plan', {
      messageId: props.messageId,
      conversationId: props.conversationId,
      editedPlanSteps: updatedPlan
    });
    
    const stepIndex = editingStepIndex.value;
    cancelEditingStep();
    console.log('用户编辑了步骤:', stepIndex, '编辑完成');
  } catch (error) {
    console.error('保存编辑步骤失败:', error);
  }
};

// 格式化计划步骤文本，支持换行显示
const formatPlanSteps = (content: string) => {
  return content.split('\n').filter(line => line.trim());
};

// 获取步骤的执行状态
const getStepStatus = (stepIndex: number) => {
  // 查找匹配的步骤结果
  for (const [, result] of props.stepResults.entries()) {
    if (result.stepNumber === stepIndex + 1) {
      return result;
    }
  }
  return null;
};

// 获取步骤状态图标
const getStepIcon = (stepIndex: number) => {
  const result = getStepStatus(stepIndex);
  if (!result) return { icon: '⏳', color: '#6b7280', isAnimated: false }; // 等待中
  
  switch (result.status) {
    case 'running':
      // 图标换成转圈圈的图标
      return { icon: '⏳', color: '#3b82f6', isAnimated: true }; // 运行中 - 使用CSS动画
    case 'completed':
      return { icon: '✓', color: '#22c55e', isAnimated: false }; // 已完成
    case 'failed':
      return { icon: '✕', color: '#ef4444', isAnimated: false }; // 失败
    default:
      return { icon: '⏳', color: '#6b7280', isAnimated: false }; // 默认等待
  }
};

// 切换步骤结果的折叠状态
const toggleStepCollapse = (stepIndex: number) => {
  if (collapsedSteps.value.has(stepIndex)) {
    collapsedSteps.value.delete(stepIndex);
  } else {
    collapsedSteps.value.add(stepIndex);
  }
};

// 判断步骤是否有结果可显示
const hasStepResult = (stepIndex: number) => {
  const result = getStepStatus(stepIndex);
  return result && (result.result || result.error);
};

// 格式化步骤结果
const formatStepResult = (result: any) => {
  if (typeof result === 'string') {
    return result;
  } else if (typeof result === 'object') {
    return JSON.stringify(result, null, 2);
  }
  return String(result);
};

// **关键修复：格式化步骤执行时间**
const formatStepTime = (stepResult: any) => {
  if (!stepResult) return '';
  
  const status = stepResult.status;
  const timestamp = stepResult.timestamp;
  const startedAt = stepResult.startedAt;
  const completedAt = stepResult.completedAt;
  
  if (status === 'running' && startedAt) {
    return `开始时间: ${new Date(startedAt).toLocaleString()}`;
  } else if ((status === 'completed' || status === 'failed') && completedAt) {
    return `完成时间: ${new Date(completedAt).toLocaleString()}`;
  } else if (timestamp) {
    return `执行时间: ${new Date(timestamp).toLocaleString()}`;
  } else {
    return `执行时间: ${new Date().toLocaleString()}`;
  }
};

// **关键修复：实现步骤结果内容的流式展示**
const startStreamingContent = (stepIndex: number, content: string) => {
  // 清除之前的流式显示
  const existingTimer = streamingTimers.value.get(stepIndex);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  streamingContent.value.set(stepIndex, '');
  
  let currentIndex = 0;
  const streamInterval = 100; // 每100毫秒显示一次，减少更新频率
  const charsPerInterval = 15; // 每次显示15个字符，减少总更新次数
  
  let scrollCounter = 0; // 滚动计数器
  
  const showNextChars = () => {
    if (currentIndex < content.length) {
      const currentContent = streamingContent.value.get(stepIndex) || '';
      const nextChars = content.slice(currentIndex, currentIndex + charsPerInterval);
      streamingContent.value.set(stepIndex, currentContent + nextChars);
      currentIndex += charsPerInterval;
      scrollCounter++;
      
      // **节流滚动：每3次更新才滚动一次，减少滚动频率**
      if (scrollCounter % 3 === 0) {
        simpleScrollToBottom(stepIndex);
      }
      
      const timer = setTimeout(showNextChars, streamInterval);
      streamingTimers.value.set(stepIndex, timer);
    } else {
      // **最简方案：流式显示完成后进行最后一次滚动**
      simpleScrollToBottom(stepIndex);
      
      streamingSteps.value.delete(stepIndex);
      streamingTimers.value.delete(stepIndex);
      
      // 设置延迟自动折叠
      const collapseTimer = setTimeout(() => {
        collapsedSteps.value.add(stepIndex);
        stepUpdateTimers.value.delete(stepIndex);
      }, 5000); // 流式完成后5秒自动折叠，给用户更多时间查看结果
      
      stepUpdateTimers.value.set(stepIndex, collapseTimer);
    }
  };
  
  showNextChars();
};

// **关键修复：获取流式显示的内容**
const getStreamingContent = (stepIndex: number) => {
  const stepResult = getStepStatus(stepIndex);
  if (!stepResult) return '';
  
  // 如果正在流式显示，返回流式内容
  if (streamingSteps.value.has(stepIndex)) {
    return streamingContent.value.get(stepIndex) || '';
  }
  
  // 否则返回完整内容
  if (stepResult.result) {
    return formatStepResult(stepResult.result);
  } else if (stepResult.error) {
    return stepResult.error;
  }
  
  return '';
};

// **最简方案：设置结果容器的ref引用**
const setResultContainerRef = (stepIndex: number, el: HTMLElement | null) => {
  if (el) {
    resultContainerRefs.value.set(stepIndex, el);
  } else {
    // 清理引用
    resultContainerRefs.value.delete(stepIndex);
  }
};

// **最简方案：简单滚动到底部**
const simpleScrollToBottom = (stepIndex: number) => {
  // 检查用户是否暂停了自动滚动
  if (userScrollPaused.value.get(stepIndex)) {
    return;
  }
  
  const container = resultContainerRefs.value.get(stepIndex);
  if (!container) {
    return;
  }
  
  try {
    // 简单直接的滚动
    container.scrollTop = container.scrollHeight;
  } catch (error) {
    // 静默处理错误，避免控制台输出过多
  }
};

// **新增：处理用户手动滚动的函数**
const handleUserScroll = (stepIndex: number, event: Event) => {
  const container = event.target as HTMLElement;
  const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
  
  if (isAtBottom) {
    // 用户滚动到底部，恢复自动滚动
    userScrollPaused.value.set(stepIndex, false);
  } else if (streamingSteps.value.has(stepIndex)) {
    // 用户在流式展示过程中滚动到其他位置，暂停自动滚动
    userScrollPaused.value.set(stepIndex, true);
    
    // 3秒后自动恢复滚动
    setTimeout(() => {
      if (streamingSteps.value.has(stepIndex)) {
        userScrollPaused.value.set(stepIndex, false);
      }
    }, 3000);
  }
};







// 步骤级别的操作方法
const acceptStep = (stepIndex: number) => {
  stepStates.value.set(stepIndex, { accepted: true, rejected: false });
  console.log(`接受步骤 ${stepIndex + 1}`);
  
  // 如果所有步骤都已处理，自动应用最终计划
  if (allStepsProcessed.value) {
    setTimeout(() => {
      applyFinalPlan();
    }, 500);
  }
};

const rejectStep = (stepIndex: number) => {
  stepStates.value.set(stepIndex, { accepted: false, rejected: true });
  console.log(`拒绝步骤 ${stepIndex + 1}`);
  
  // 如果所有步骤都已处理，自动应用最终计划
  if (allStepsProcessed.value) {
    setTimeout(() => {
      applyFinalPlan();
    }, 500);
  }
};

const acceptAllSteps = () => {
  displaySteps.value.forEach((step, index) => {
    if (step.new && step.new !== step.original) {
      stepStates.value.set(index, { accepted: true, rejected: false });
    }
  });
  console.log('接受所有新步骤');
  
  setTimeout(() => {
    applyFinalPlan();
  }, 1000);
};

const rejectAllSteps = () => {
  displaySteps.value.forEach((step, index) => {
    if (step.new && step.new !== step.original) {
      stepStates.value.set(index, { accepted: false, rejected: true });
    }
  });
  console.log('拒绝所有新步骤');
  
  setTimeout(() => {
    applyFinalPlan();
  }, 1000);
};

// 应用最终计划
const applyFinalPlan = async () => {
  try {
    // 构建最终计划文本（用于前端显示）
    const finalPlan = displaySteps.value
      .map((step) => {
        // 如果接受了新步骤，使用新步骤
        if (step.accepted && step.new) {
          return step.new;
        }
        // 如果拒绝了新步骤或没有新步骤，使用原步骤
        else if (step.rejected || !step.new || step.new === step.original) {
          return step.original;
        }
        // 其他情况使用原步骤
        return step.original;
      })
      .filter(step => step !== null)
      .join('\n');
    
    console.log('应用最终计划:', finalPlan);
    
    // **关键修复：获取完整的新计划结构数据而不是只传文本**
    let newPlanData = null;
    if (props.planComparison && props.planComparison.new_plan) {
      // 使用完整的新计划结构数据
      newPlanData = props.planComparison.new_plan;
      console.log('使用完整的新计划结构数据:', newPlanData);
    }
    
    // 保存最终计划内容，这样在退出对比模式后显示的是最终计划
    finalPlanContent.value = finalPlan;
    
    // 发送接受计划的事件，传递最终计划
    emit('accept-new-plan', {
      messageId: props.messageId,
      conversationId: props.conversationId,
      finalPlan: finalPlan,  // 传递最终确定的计划文本（用于前端显示）
      newPlan: newPlanData   // **关键：传递完整的新计划结构数据**
    });
    
    // 重置状态
    isComparisonMode.value = false;
    actionStatus.value = 'pending';
    stepStates.value.clear();
    
  } catch (error) {
    console.error('应用最终计划失败:', error);
  }
};



// 已移除页面滚动相关函数，只保留结果容器滚动
</script>

<template>
  <div class="plan-steps-panel">
    <!-- 计划步骤头部 -->
    <div class="plan-header" @click="togglePlanCollapse" :class="{ 'collapsible': actionStatus === 'confirmed' }">
      <div class="plan-title">
        <span class="title-text">To-dos</span>
        <span class="status-badge" :class="actionStatus">
          {{ 
            actionStatus === 'pending' ? '等待确认' :
            actionStatus === 'confirmed' ? '已确认' :
            actionStatus === 'regenerating' ? '重新生成中' : '等待确认'
          }}
        </span>
        <!-- **新增：折叠指示器** -->
        <span v-if="actionStatus === 'confirmed'" class="collapse-indicator">
          {{ isPlanCollapsed ? '▼' : '▲' }}
        </span>
      </div>
    </div>

    <!-- 计划内容区域 -->
    <div class="plan-content" v-show="!isPlanCollapsed">
      <!-- 简化的计划对比视图 -->
      <div v-if="isComparisonMode" class="simplified-comparison-view">
        <div class="simplified-steps-container">
          <div 
            v-for="(step, index) in displaySteps" 
            :key="'step-' + index"
            class="step-comparison-item"
          >
            <!-- 原步骤 -->
            <div 
              v-if="step.original"
              class="original-step-item"
              :class="{ 'will-be-replaced': step.new && step.accepted }"
            >
              <div class="step-marker">
                <span class="step-number">{{ index + 1 }}</span>
              </div>
              <div class="step-content">{{ step.original }}</div>
            </div>
            
            <!-- 新步骤（如果有变化） -->
            <div 
              v-if="step.new && step.new !== step.original"
              class="new-step-item"
              :class="{ 
                'accepted': step.accepted, 
                'rejected': step.rejected,
                'pending': !step.accepted && !step.rejected
              }"
            >
              <div class="step-marker new">
                <span class="step-number">{{ index + 1 }}</span>
                <span class="change-indicator">新</span>
              </div>
              <div class="step-content">{{ step.new }}</div>
              
              <!-- 操作按钮 -->
              <div v-if="!step.accepted && !step.rejected" class="step-actions">
                <button 
                  class="action-btn accept" 
                  @click="acceptStep(index)"
                  title="接受此变更"
                >
                  ✓ 接受
                </button>
                <button 
                  class="action-btn reject" 
                  @click="rejectStep(index)"
                  title="拒绝此变更"
                >
                  ✕ 拒绝
                </button>
              </div>
              
              <!-- 状态标识 -->
              <div v-if="step.accepted" class="step-status accepted">
                ✓ 已接受
              </div>
              <div v-if="step.rejected" class="step-status rejected">
                ✕ 已拒绝
              </div>
            </div>
          </div>
        </div>
        
        <!-- 全局操作按钮移到底部 -->
        <div class="global-actions-bottom">
          <button class="global-btn accept-all" @click="acceptAllSteps">
            <span>✓</span> 全部接受
          </button>
          <button class="global-btn reject-all" @click="rejectAllSteps">
            <span>✕</span> 全部拒绝
          </button>
        </div>
      </div>
      
      <div v-if="!isComparisonMode" class="plan-display">
        <div 
          v-for="(line, index) in formatPlanSteps(displayContent)" 
          :key="index"
          class="plan-step"
          :class="getStepStatus(index)?.status || 'pending'"
        >
          <div class="step-marker" :style="{ backgroundColor: getStepIcon(index).color }">
            <span v-if="getStepIcon(index).isAnimated" class="step-spinner"></span>
            <span v-else class="step-icon">{{ getStepIcon(index).icon }}</span>
            <!-- <span class="step-number">{{ index + 1 }}</span> -->
          </div>
          <div class="step-content">
            <div 
              class="step-description" 
              @dblclick="startEditingStep(index, line)"
              :class="{ 'editable': !props.readonly && actionStatus !== 'confirmed' }"
            >
              <!-- 编辑模式 -->
              <div v-if="editingStepIndex === index" class="step-edit-container">
                <input 
                  v-model="editingStepContent"
                  class="step-edit-input"
                  @keydown.enter="saveEditedStep"
                  @keydown.escape="cancelEditingStep"
                  @blur="saveEditedStep"
                />
                <div class="step-edit-hint">按回车保存，ESC取消</div>
              </div>
              <!-- 普通显示模式 -->
              <span v-else>{{ line }}</span>
            </div>
            
            <!-- 步骤结果区域 -->
            <div v-if="hasStepResult(index)" class="step-result-section">
              <button 
                class="result-toggle"
                @click="toggleStepCollapse(index)"
                :class="{ collapsed: collapsedSteps.has(index) }"
              >
                <span class="toggle-icon">{{ collapsedSteps.has(index) ? '▶' : '▼' }}</span>
                <span class="toggle-text">
                  {{ getStepStatus(index)?.status === 'failed' ? '错误详情' : '执行结果' }}
                </span>
              </button>
              
              <div 
                v-if="!collapsedSteps.has(index)" 
                class="step-result"
                :class="{ 'streaming': streamingSteps.has(index) }"
              >
                <div v-if="getStepStatus(index)?.result || streamingSteps.has(index)" class="result-content">
                  <div class="result-label">结果：</div>
                  <div 
                    :ref="(el) => setResultContainerRef(index, el as HTMLElement)"
                    class="result-text-container"
                    :class="{ 'streaming-container': streamingSteps.has(index) }"
                    @scroll="(event) => handleUserScroll(index, event)"
                  >
                    <pre class="result-text" :class="{ 'streaming-text-content': streamingSteps.has(index) }">{{ 
                      streamingSteps.has(index) ? getStreamingContent(index) : formatStepResult(getStepStatus(index)?.result) 
                    }}<span v-if="streamingSteps.has(index)" class="streaming-cursor">|</span></pre>
                  </div>
                </div>
                <div v-if="getStepStatus(index)?.error && !streamingSteps.has(index)" class="error-content">
                  <div class="error-label">错误：</div>
                  <pre class="error-text">{{ getStepStatus(index)?.error }}</pre>
                </div>
                <div class="result-timestamp">
                  {{ formatStepTime(getStepStatus(index)) }}
                </div>
                
                <!-- **关键修复：流式展示指示器** -->
                <div v-if="streamingSteps.has(index)" class="streaming-indicator">
                  <div class="streaming-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <span class="streaming-text">正在执行...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- 操作按钮区域 -->
    <div class="plan-actions" v-if="!readonly">
      <!-- 动态对比模式不显示底部按钮，操作都在步骤级别 -->
      <template v-if="isComparisonMode">
        <!-- 动态对比模式下的操作都在步骤级别，这里不需要按钮 -->
      </template>
      
      <!-- 正常模式的按钮 -->
      <template v-else>
        <button 
          class="action-btn confirm-btn"
          :disabled="isActionDisabled"
          @click="confirmPlan"
        >
          <svg v-if="isLoading && actionStatus === 'confirmed'" class="loading-icon" width="16" height="16" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="32" stroke-dashoffset="32">
              <animate attributeName="stroke-dasharray" dur="2s" values="0 32;16 16;0 32;0 32" repeatCount="indefinite"/>
              <animate attributeName="stroke-dashoffset" dur="2s" values="0;-16;-32;-32" repeatCount="indefinite"/>
            </circle>
          </svg>
          <span v-else>✓</span>
          {{ actionStatus === 'confirmed' ? '已确认' : '确认执行' }}
        </button>
        
        <button 
          class="action-btn regenerate-btn"
          :disabled="isActionDisabled"
          @click="regeneratePlan"
        >
          <svg v-if="isLoading && actionStatus === 'regenerating'" class="loading-icon" width="16" height="16" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="32" stroke-dashoffset="32">
              <animate attributeName="stroke-dasharray" dur="2s" values="0 32;16 16;0 32;0 32" repeatCount="indefinite"/>
              <animate attributeName="stroke-dashoffset" dur="2s" values="0;-16;-32;-32" repeatCount="indefinite"/>
            </circle>
          </svg>
          <span v-else>↻</span>
          {{ actionStatus === 'regenerating' ? '生成中...' : '重新生成' }}
        </button>
      </template>
    </div>

    <!-- 已确认状态的提示 -->
    <div v-if="actionStatus === 'confirmed'" class="confirmed-status">
      <div class="confirmed-icon">✓</div>
      <div class="confirmed-text">计划已确认      </div>
    </div>


  </div>
</template>

<style scoped>
/* **新增：折叠相关样式** */
.plan-header.collapsible {
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.plan-header.collapsible:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.collapse-indicator {
  margin-left: auto;
  font-size: 12px;
  color: #666;
  transition: transform 0.2s ease;
}



.plan-steps-panel {
  width: 100%;
  margin: 12px 0;
  border-radius: 12px;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%);
  border: 1px solid rgba(139, 92, 246, 0.2);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.1);
  transition: all 0.3s ease;
}

.plan-steps-panel:hover {
  box-shadow: 0 6px 16px rgba(139, 92, 246, 0.15);
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%);
  border-bottom: 1px solid rgba(139, 92, 246, 0.15);
}



.plan-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-text {
  font-weight: 600;
  font-size: 14px;
  color: #1f2937;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-badge.pending {
  background-color: rgba(251, 191, 36, 0.1);
  color: #d97706;
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.status-badge.confirmed {
  background-color: rgba(34, 197, 94, 0.1);
  color: #16a34a;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.status-badge.regenerating {
  background-color: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.status-badge.editing {
  background-color: rgba(168, 85, 247, 0.1);
  color: #7c3aed;
  border: 1px solid rgba(168, 85, 247, 0.3);
}

.plan-content {
  padding: 12px;
}

.plan-display {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plan-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  background-color: rgba(255, 255, 255, 0.7);
  border-radius: 6px;
  border-left: 3px solid #8b5cf6;
  transition: all 0.2s ease;
}

.plan-step:hover {
  background-color: rgba(255, 255, 255, 0.9);
  transform: translateX(2px);
}

.step-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  font-size: 8px;
  font-weight: 600;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.step-icon {
  position: absolute;
  font-size: 12px;
  opacity: 0.9;
}

.step-number {
  position: absolute;
  font-size: 8px;
  font-weight: bold;
  bottom: -1px;
  right: -1px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  width: 10px;
  height: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-spinner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.step-content {
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
  color: #374151;
  font-weight: 500;
}

.step-description {
  margin-bottom: 8px;
}

/* 步骤结果相关样式 */
.step-result-section {
  margin-top: 12px;
      border-top: 1px solid rgba(139, 92, 246, 0.1);
  padding-top: 12px;
}

.result-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  transition: all 0.2s ease;
}

.result-toggle:hover {
  background-color: rgba(139, 92, 246, 0.1);
  color: #8b5cf6;
}

.toggle-icon {
  font-size: 10px;
  transition: transform 0.2s ease;
}

.result-toggle.collapsed .toggle-icon {
  transform: rotate(-90deg);
}

.step-result {
  margin-top: 8px;
  padding: 12px;
  background-color: rgba(255, 255, 255, 0.8);
  border-radius: 6px;
  border-left: 3px solid #8b5cf6;
}

.result-content, .error-content {
  margin-bottom: 8px;
}

.result-label, .error-label {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  color: #374151;
}

.error-label {
  color: #ef4444;
}

.result-text, .error-text {
  background-color: rgba(243, 244, 246, 0.5);
  padding: 8px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

.error-text {
  background-color: rgba(254, 242, 242, 0.8);
  color: #dc2626;
  border-left: 3px solid #ef4444;
}

.result-timestamp {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 8px;
  text-align: right;
}

/* 步骤状态样式 */
.plan-step.running {
  border-left-color: #3b82f6;
  background-color: rgba(59, 130, 246, 0.05);
}

.plan-step.completed {
  border-left-color: #22c55e;
  background-color: rgba(34, 197, 94, 0.05);
}

.plan-step.failed {
  border-left-color: #ef4444;
  background-color: rgba(239, 68, 68, 0.05);
}



.plan-actions {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  background-color: rgba(255, 255, 255, 0.5);
  border-top: 1px solid rgba(139, 92, 246, 0.15);
}

/* 步骤编辑相关样式 */
.step-description.editable {
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.step-description.editable:hover {
  background-color: rgba(139, 92, 246, 0.1);
  border: 1px dashed rgba(139, 92, 246, 0.3);
}

.step-edit-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.step-edit-input {
  width: 100%;
  padding: 8px 12px;
  border: 2px solid #8b5cf6;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  background-color: white;
  box-shadow: 0 2px 4px rgba(139, 92, 246, 0.1);
}

.step-edit-input:focus {
  outline: none;
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2);
}

.step-edit-hint {
  font-size: 11px;
  color: #8b5cf6;
  font-style: italic;
}

/* 全局操作按钮底部布局样式 */
.global-actions-bottom {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 20px;
  margin-top: 20px;
  border-top: 2px solid rgba(139, 92, 246, 0.1);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.confirm-btn {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed);
  color: white;
  flex: 1;
}

.confirm-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
}

.regenerate-btn {
  background: linear-gradient(135deg, #a855f7, #9333ea);
  color: white;
}

.regenerate-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #9333ea, #7e22ce);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);
}



.loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.confirmed-status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(168, 85, 247, 0.1));
  border-top: 1px solid rgba(139, 92, 246, 0.2);
}

.confirmed-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #8b5cf6;
  color: white;
  font-size: 14px;
  font-weight: 600;
}

.confirmed-text {
  font-size: 14px;
  color: #7c3aed;
  font-weight: 500;
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .plan-steps-panel {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%);
    border-color: rgba(139, 92, 246, 0.3);
  }
  
  .plan-header {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(168, 85, 247, 0.15) 100%);
    border-bottom-color: rgba(139, 92, 246, 0.2);
  }
  
  .title-text {
    color: #f9fafb;
  }
  
  .plan-step {
    background-color: rgba(17, 24, 39, 0.7);
    border-left-color: #8b5cf6;
  }
  
  .plan-step:hover {
    background-color: rgba(17, 24, 39, 0.9);
  }
  
  .step-content {
    color: #e5e7eb;
  }
  
  .step-description {
    color: #e5e7eb;
  }
  
  .step-result {
    background-color: rgba(31, 41, 55, 0.8);
  }
  
  .result-text, .error-text {
    background-color: rgba(55, 65, 81, 0.6);
    color: #e5e7eb;
  }
  
  .error-text {
    background-color: rgba(127, 29, 29, 0.4);
    color: #fca5a5;
  }
  
  .result-label, .error-label {
    color: #e5e7eb;
  }
  
  .error-label {
    color: #fca5a5;
  }
  
  .result-toggle {
    color: #9ca3af;
  }
  
  .result-toggle:hover {
    background-color: rgba(139, 92, 246, 0.15);
    color: #8b5cf6;
  }
  

  
  .plan-actions {
    background-color: rgba(17, 24, 39, 0.5);
    border-top-color: rgba(139, 92, 246, 0.2);
  }
  
  .confirmed-status {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(168, 85, 247, 0.15));
    border-top-color: rgba(139, 92, 246, 0.3);
  }
  
  .confirmed-text {
    color: #8b5cf6;
  }
}

/* **关键修复：流式展示动画样式** */
.step-result.streaming {
  animation: pulse-border 2s infinite;
  border-left: 3px solid #3b82f6;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  background-color: rgba(59, 130, 246, 0.1);
  border-radius: 6px;
  border-left: 3px solid #3b82f6;
}

.streaming-dots {
  display: flex;
  gap: 4px;
}

.streaming-dots span {
  width: 6px;
  height: 6px;
  background-color: #3b82f6;
  border-radius: 50%;
  animation: dot-flashing 1.4s infinite linear alternate;
}

.streaming-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.streaming-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

.streaming-text {
  font-size: 12px;
  color: #3b82f6;
  font-weight: 500;
}

@keyframes pulse-border {
  0%, 100% {
    border-left-color: #3b82f6;
  }
  50% {
    border-left-color: #60a5fa;
  }
}

@keyframes dot-flashing {
  0% {
    opacity: 0.2;
    transform: scale(1);
  }
  50%, 100% {
    opacity: 1;
    transform: scale(1.2);
  }
}

/* **关键修复：步骤结果容器样式** */
.result-text-container {
  max-height: 300px;
  min-height: 60px;
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background-color: #f9fafb;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 #f1f5f9;
}

.result-text-container::-webkit-scrollbar {
  width: 8px;
}

.result-text-container::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 4px;
}

.result-text-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
  transition: background-color 0.2s ease;
}

.result-text-container::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

.result-text-container.streaming-container {
  border-color: #3b82f6;
  background-color: rgba(59, 130, 246, 0.05);
}

.result-text {
  margin: 0;
  padding: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  background: transparent;
  border: none;
}

/* **关键修复：流式文本显示样式** */
.streaming-text-content {
  position: relative;
}

.streaming-cursor {
  animation: blink 1s infinite;
  color: #3b82f6;
  font-weight: bold;
}

@keyframes blink {
  0%, 50% {
    opacity: 1;
  }
  51%, 100% {
    opacity: 0;
  }
}

/* 暗色模式下的流式展示样式 */
@media (prefers-color-scheme: dark) {
  .streaming-indicator {
    background-color: rgba(59, 130, 246, 0.15);
  }
  
  .streaming-text {
    color: #60a5fa;
  }
  
  .streaming-dots span {
    background-color: #60a5fa;
  }
  
  .streaming-cursor {
    color: #60a5fa;
  }
  
  .result-text-container {
    border-color: rgba(75, 85, 99, 0.6);
    background-color: rgba(17, 24, 39, 0.6);
    scrollbar-color: #4b5563 #1f2937;
  }
  
  .result-text-container::-webkit-scrollbar-track {
    background: #1f2937;
  }
  
  .result-text-container::-webkit-scrollbar-thumb {
    background: #4b5563;
  }
  
  .result-text-container::-webkit-scrollbar-thumb:hover {
    background: #6b7280;
  }
  
  .result-text-container.streaming-container {
    border-color: #60a5fa;
    background-color: rgba(59, 130, 246, 0.1);
  }
  
  .result-text {
    color: #e5e7eb;
  }
}

/* 简化的计划对比视图样式 */
.simplified-comparison-view {
  margin-bottom: 20px;
}

.comparison-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding: 16px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(16, 185, 129, 0.08));
  border-radius: 8px;
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.comparison-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.comparison-icon {
  font-size: 18px;
}

.global-actions {
  display: flex;
  gap: 12px;
}

.global-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.global-btn.accept-all {
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
}

.global-btn.accept-all:hover {
  background: linear-gradient(135deg, #059669, #047857);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.global-btn.reject-all {
  background: linear-gradient(135deg, #6b7280, #4b5563);
  color: white;
}

.global-btn.reject-all:hover {
  background: linear-gradient(135deg, #4b5563, #374151);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(107, 114, 128, 0.3);
}

.simplified-steps-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step-comparison-item {
  border-radius: 8px;
  overflow: hidden;
}

.original-step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(99, 102, 241, 0.05);
  border: 1px solid rgba(99, 102, 241, 0.15);
  border-radius: 8px;
  transition: all 0.3s ease;
}

.original-step-item.will-be-replaced {
  opacity: 0.6;
  text-decoration: line-through;
  background: rgba(239, 68, 68, 0.05);
  border-color: rgba(239, 68, 68, 0.15);
}

.new-step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  margin-top: 8px;
  border-radius: 8px;
  transition: all 0.3s ease;
  position: relative;
}

.new-step-item.pending {
  background: rgba(16, 185, 129, 0.05);
  border: 2px solid rgba(16, 185, 129, 0.2);
  animation: pulse-border 2s infinite;
}

.new-step-item.accepted {
  background: rgba(34, 197, 94, 0.1);
  border: 2px solid rgba(34, 197, 94, 0.3);
}

.new-step-item.rejected {
  background: rgba(239, 68, 68, 0.05);
  border: 2px solid rgba(239, 68, 68, 0.2);
  opacity: 0.7;
}

.step-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #4f46e5);
  color: white;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
  position: relative;
}

.step-marker.new {
  background: linear-gradient(135deg, #10b981, #059669);
}

.step-number {
  font-size: 12px;
  font-weight: bold;
}

.change-indicator {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #f59e0b;
  color: white;
  font-size: 8px;
  font-weight: bold;
  padding: 2px 4px;
  border-radius: 6px;
  line-height: 1;
}

.step-content {
  flex: 1;
  font-size: 14px;
  line-height: 1.6;
  color: #374151;
  padding-right: 120px; /* 为按钮留出空间 */
}

.step-actions {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 8px;
}

.action-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn.accept {
  background: #10b981;
  color: white;
}

.action-btn.accept:hover {
  background: #059669;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.4);
}

.action-btn.reject {
  background: #6b7280;
  color: white;
}

.action-btn.reject:hover {
  background: #4b5563;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(107, 114, 128, 0.4);
}

.step-status {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.step-status.accepted {
  background: rgba(34, 197, 94, 0.2);
  color: #16a34a;
}

.step-status.rejected {
  background: rgba(239, 68, 68, 0.2);
  color: #dc2626;
}

/* 简化的动画效果 */
@keyframes pulse-border {
  0%, 100% {
    border-color: rgba(16, 185, 129, 0.2);
  }
  50% {
    border-color: rgba(16, 185, 129, 0.4);
  }
}





/* 暗色模式下的简化对比视图样式 */
@media (prefers-color-scheme: dark) {
  .comparison-header {
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(16, 185, 129, 0.12));
    border-color: rgba(59, 130, 246, 0.3);
  }
  
  .comparison-title {
    color: #f9fafb;
  }
  
  .original-step-item {
    background: rgba(99, 102, 241, 0.1);
    border-color: rgba(99, 102, 241, 0.25);
  }
  
  .original-step-item.will-be-replaced {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.2);
  }
  
  .new-step-item.pending {
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.25);
  }
  
  .new-step-item.accepted {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.35);
  }
  
  .new-step-item.rejected {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.25);
  }
  
  .step-content {
    color: #e5e7eb;
  }
  
  .step-status.accepted {
    background: rgba(34, 197, 94, 0.25);
    color: #6ee7b7;
  }
  
  .step-status.rejected {
    background: rgba(239, 68, 68, 0.25);
    color: #fca5a5;
  }
}
</style>
