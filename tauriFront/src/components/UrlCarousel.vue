<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import type { UrlItem } from '../types';

// 定义props
const props = defineProps({
  urls: {
    type: Array as () => UrlItem[],
    required: true
  },
  autoplay: {
    type: Boolean,
    default: true
  },
  interval: {
    type: Number,
    default: 3000
  },
  showProgress: {
    type: Boolean,
    default: true
  }
});

// 状态变量
const currentIndex = ref(0);
const isPlaying = ref(props.autoplay);
const timer = ref<number | null>(null);
const isHovering = ref(false);
const animationDirection = ref('next'); // 'next' or 'prev'

// 启动轮播
const startCarousel = () => {
  if (timer.value) clearInterval(timer.value);
  if (props.urls.length <= 1) return;
  
  timer.value = window.setInterval(() => {
    if (!isHovering.value && isPlaying.value) {
      animationDirection.value = 'next';
      nextSlide();
    }
  }, props.interval);
};

// 停止轮播
const stopCarousel = () => {
  if (timer.value) {
    clearInterval(timer.value);
    timer.value = null;
  }
};

// 下一张幻灯片
const nextSlide = () => {
  animationDirection.value = 'next';
  currentIndex.value = (currentIndex.value + 1) % props.urls.length;
};

// 上一张幻灯片
const prevSlide = () => {
  animationDirection.value = 'prev';
  currentIndex.value = (currentIndex.value - 1 + props.urls.length) % props.urls.length;
};

// 直接跳转到特定幻灯片
const goToSlide = (index: number) => {
  animationDirection.value = index > currentIndex.value ? 'next' : 'prev';
  currentIndex.value = index;
};

// 切换播放/暂停
const togglePlay = () => {
  isPlaying.value = !isPlaying.value;
  if (isPlaying.value) {
    startCarousel();
  } else {
    stopCarousel();
  }
};

// 在鼠标悬停时暂停轮播
const onMouseEnter = () => {
  isHovering.value = true;
};

const onMouseLeave = () => {
  isHovering.value = false;
};

// 在组件挂载时开始轮播
onMounted(() => {
  if (props.autoplay) {
    startCarousel();
  }
});

// 在组件卸载前清理
onBeforeUnmount(() => {
  stopCarousel();
});

// 监听URLs变化，如果有新的URL加入，重新启动轮播
watch(() => props.urls, (newUrls, oldUrls) => {
  if (newUrls.length !== oldUrls.length) {
    if (newUrls.length > 0) {
      startCarousel();
    }
  }
}, { deep: true });

// 打开URL
const openUrl = (url: string) => {
  window.open(url, '_blank');
};
</script>

<template>
  <div class="url-carousel" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave">
    <!-- 搜索中动画 -->
    <div class="searching-animation" v-if="props.urls.length === 0">
      <div class="searching-text">正在搜索相关结果...</div>
      <div class="searching-dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    </div>
    
    <!-- 轮播内容 -->
    <div class="carousel-container" v-else>
      <!-- 轮播项 -->
      <div class="carousel-track">
        <transition-group name="slide">
          <div 
            v-for="(item, index) in props.urls" 
            :key="index"
            class="carousel-item"
            :class="{ active: index === currentIndex }"
            v-show="index === currentIndex"
            @click="openUrl(item.url)"
          >
            <div class="url-card">
              <div class="url-content">
                <!-- 放大镜图标 -->
                <div class="search-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </div>
                <div class="url-details">
                  <div class="url-title">{{ item.url.split('/')[2] }}</div>
                  <div class="url-link">{{ item.url }}</div>
                </div>
              </div>
            </div>
          </div>
        </transition-group>
      </div>
      
      <!-- 结果数量和指示器 -->
      <div class="carousel-info">
        <div class="result-count">共 {{ props.urls.length }} 个结果</div>
        <div class="indicators" v-if="props.urls.length > 1">
          <button
            v-for="(_, index) in props.urls"
            :key="index"
            class="indicator"
            :class="{ active: index === currentIndex }"
            @click.stop="goToSlide(index)"
          ></button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.url-carousel {
  width: 100%;
  margin: 10px 0;
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  background-color: rgba(96, 165, 250, 0.05);
  border: 1px solid rgba(96, 165, 250, 0.2);
  box-shadow: 0 4px 12px rgba(96, 165, 250, 0.1);
}

.searching-animation {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 80px;
  padding: 20px;
}

.searching-text {
  font-size: 15px;
  font-weight: 500;
  color: #2563eb;
  margin-bottom: 10px;
}

.searching-dots {
  display: flex;
  gap: 6px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #3b82f6;
  opacity: 0.6;
  animation: pulse 1.5s infinite ease-in-out;
}

.dot:nth-child(1) {
  animation-delay: 0s;
}

.dot:nth-child(2) {
  animation-delay: 0.3s;
}

.dot:nth-child(3) {
  animation-delay: 0.6s;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(0.8);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.2);
    opacity: 1;
  }
}

.carousel-container {
  position: relative;
  width: 100%;
  min-height: 100px;
  max-height: 120px;
  display: flex;
  flex-direction: column;
}

.carousel-track {
  width: 100%;
  position: relative;
  padding: 10px 20px;
  min-height: 70px;
  max-height: 70px;
  flex: 1;
}

.carousel-item {
  width: 100%;
  height: 70px;
  transition: all 0.4s ease;
  position: absolute;
  left: 0;
  right: 0;
  padding: 0 20px;
  display: flex;
  align-items: center;
}

.carousel-item.active {
  z-index: 5;
}

.url-card {
  width: 100%;
  background-color: transparent;
  border-radius: 8px;
  padding: 12px;
  transition: all 0.3s;
  cursor: pointer;
  border: 1px solid rgba(96, 165, 250, 0.15);
  background-color: rgba(59, 130, 246, 0.05);
}

.url-card:hover {
  background-color: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
  transform: translateY(-2px);
}

.url-content {
  display: flex;
  align-items: center;
  gap: 12px;
  max-height: 46px;
  overflow: hidden;
}

.search-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background-color: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  flex-shrink: 0;
}

.url-details {
  flex-grow: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.url-title {
  font-weight: 600;
  font-size: 14px;
  color: #2563eb;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.url-link {
  font-size: 12px;
  color: #4b5563;
  word-break: break-all;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 17px;
}

.carousel-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid rgba(96, 165, 250, 0.1);
  margin-top: auto;
  height: 40px;
}

.result-count {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.indicators {
  display: flex;
  gap: 6px;
}

.indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: rgba(59, 130, 246, 0.3);
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
}

.indicator.active {
  background-color: #3b82f6;
  transform: scale(1.2);
}

/* 动画效果 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.4s ease;
}

.slide-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.slide-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .url-carousel {
    background-color: rgba(30, 41, 59, 0.7);
    border-color: rgba(96, 165, 250, 0.2);
  }
  
  .searching-text {
    color: #93c5fd;
  }
  
  .url-card {
    background-color: rgba(59, 130, 246, 0.08);
    border-color: rgba(96, 165, 250, 0.2);
  }
  
  .url-card:hover {
    background-color: rgba(59, 130, 246, 0.15);
  }
  
  .search-icon {
    background-color: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
  }
  
  .url-title {
    color: #93c5fd;
  }
  
  .url-link {
    color: #cbd5e1;
  }
  
  .result-count {
    color: #94a3b8;
  }
  
  .carousel-info {
    border-top-color: rgba(96, 165, 250, 0.2);
  }
}
</style> 