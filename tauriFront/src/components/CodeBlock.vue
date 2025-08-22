<template>
  <div class="code-block-container">
    <div class="code-header">
      <span class="language-tag">{{ language }}</span>
      <button class="copy-btn" @click="copyToClipboard" :title="copied ? '已复制' : '复制代码'">
        <span v-if="copied" class="copied-text">已复制</span>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z" fill="currentColor"/>
        </svg>
      </button>
    </div>
    <div class="code-content">
      <pre class="code-pre"><code ref="codeRef"></code></pre>
    </div>
  </div>
</template>

<script>
export default {
  name: 'CodeBlock',
  props: {
    code: {
      type: String,
      required: true
    },
    language: {
      type: String,
      default() {
        // 自动检测语言
        const code = this.code || '';
        if (/^\s*</.test(code)) return 'html';
        if (/^\s*(import|export|from|class|function|const|let|var)\s/.test(code)) return 'javascript';
        if (/^\s*(def|class|import|from|if __name__)/m.test(code)) return 'python';
        return 'plaintext';
      }
    }
  },
  data() {
    return {
      copied: false
    }
  },
  mounted() {
    this.highlightCode();
  },
  watch: {
    code() {
      this.highlightCode();
    },
    language() {
      this.highlightCode();
    }
  },
  methods: {
    highlightCode() {
      const codeElement = this.$refs.codeRef;
      if (!codeElement) return;
      
      // 处理代码，确保安全
      const safeCode = this.code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      
      // 添加语言类名
      codeElement.className = `language-${this.language}`;
      codeElement.innerHTML = safeCode;
    },
    copyToClipboard() {
      navigator.clipboard.writeText(this.code)
        .then(() => {
          this.copied = true;
          setTimeout(() => {
            this.copied = false;
          }, 2000);
        })
        .catch(err => {
          console.error('复制失败:', err);
        });
    }
  }
}
</script>

<style scoped>
.code-block-container {
  margin: 1rem 0;
  border-radius: 8px;
  overflow: hidden;
  background-color: #2d2d2d;
  color: #f8f8f2;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace;
  font-size: 14px;
  border: 1px solid #444;
}

.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background-color: #444;
  color: #f8f8f2;
  border-bottom: 1px solid #555;
}

.language-tag {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.1);
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: #f8f8f2;
  padding: 4px 8px;
  border-radius: 4px;
  opacity: 0.7;
  transition: all 0.2s;
}

.copy-btn:hover {
  opacity: 1;
  background-color: rgba(255, 255, 255, 0.1);
}

.copied-text {
  font-size: 12px;
  color: #8BE9FD;
}

.code-content {
  overflow-x: auto;
}

.code-pre {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  background: transparent;
}

code {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace;
  white-space: pre;
  word-wrap: normal;
  tab-size: 2;
}

/* 语言特定样式 */
.language-python, .language-javascript, .language-html, .language-css {
  color: #f8f8f2;
}

/* 暗色主题支持 */
@media (prefers-color-scheme: dark) {
  .code-block-container {
    border: 1px solid #555;
  }
}
</style> 