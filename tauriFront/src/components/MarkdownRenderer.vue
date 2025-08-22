<template>
  <div class="markdown-body" v-html="renderedContent"></div>
</template>

<script>
export default {
  name: 'MarkdownRenderer',
  props: {
    content: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      renderedContent: ''
    }
  },
  watch: {
    content: {
      immediate: true,
      handler() {
        this.renderMarkdown();
      }
    }
  },
  methods: {
    renderMarkdown() {
      // 这里需要导入marked库
      // 如果没有安装marked，可以通过 npm install marked 安装
      try {
        // 检查是否加载了marked库
        if (typeof marked !== 'undefined') {
          // 使用marked库渲染Markdown
          this.renderedContent = marked.parse(this.content);
        } else {
          // 基础的Markdown处理（简单实现，不使用外部库）
          this.renderedContent = this.basicMarkdownRender(this.content);
        }
      } catch (error) {
        console.error('渲染Markdown失败:', error);
        // 退化方案：使用基础的Markdown处理
        this.renderedContent = this.basicMarkdownRender(this.content);
      }
    },
    
    basicMarkdownRender(text) {
      if (!text) return '';
      
      // 安全处理
      let safeText = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      
      // 处理标题 (# 标题)
      safeText = safeText.replace(/^(#{1,6})\s+(.+?)$/gm, (match, hashes, content) => {
        const level = hashes.length;
        return `<h${level}>${content}</h${level}>`;
      });
      
      // 处理粗体 (**粗体**)
      safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      
      // 处理斜体 (*斜体*)
      safeText = safeText.replace(/\*(.*?)\*/g, '<em>$1</em>');
      
      // 处理链接 [文本](URL)
      safeText = safeText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
      
      // 处理图片 ![替代文本](图片URL)
      safeText = safeText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">');
      
      // 处理无序列表 (- 项目)
      safeText = safeText.replace(/^(\s*)-\s+(.+?)$/gm, '$1<li>$2</li>');
      safeText = safeText.replace(/<li>(.+?)<\/li>/g, '<ul><li>$1</li></ul>');
      safeText = safeText.replace(/<\/ul>\s*<ul>/g, '');
      
      // 处理有序列表 (1. 项目)
      safeText = safeText.replace(/^(\s*)\d+\.\s+(.+?)$/gm, '$1<li>$2</li>');
      safeText = safeText.replace(/<li>(.+?)<\/li>/g, '<ol><li>$1</li></ol>');
      safeText = safeText.replace(/<\/ol>\s*<ol>/g, '');
      
      // 处理引用块 (> 引用)
      safeText = safeText.replace(/^>\s+(.+?)$/gm, '<blockquote>$1</blockquote>');
      safeText = safeText.replace(/<\/blockquote>\s*<blockquote>/g, '<br>');
      
      // 处理水平线 (---)
      safeText = safeText.replace(/^(-{3,}|={3,})$/gm, '<hr>');
      
      // 简单表格支持
      // 表格头部 | Header1 | Header2 |
      // 表格分隔 | ------- | ------- |
      // 表格内容 | Cell1   | Cell2   |
      safeText = safeText.replace(/^\|(.+)\|$/gm, (match, content) => {
        const cells = content.split('|').map(cell => cell.trim());
        const cellsHtml = cells.map(cell => `<td>${cell}</td>`).join('');
        return `<tr>${cellsHtml}</tr>`;
      });
      
      // 处理表格分隔行，将其替换为空行
      safeText = safeText.replace(/^\|([-:\s|]+)\|$/gm, '');
      
      // 将连续的表格行包装在table标签中
      safeText = safeText.replace(/(<tr>.+?<\/tr>)\s*(<tr>.+?<\/tr>)/g, '<table>$1$2</table>');
      safeText = safeText.replace(/<\/table>\s*<table>/g, '');
      
      // 处理代码块，但保留我们自定义的CodeBlock组件使用的格式
      safeText = safeText.replace(/```([^`]+)```/g, (match, code) => {
        return match; // 不处理，保留原始格式供CodeBlock组件处理
      });
      
      // 处理行内代码 (`代码`)
      safeText = safeText.replace(/`([^`]+)`/g, '<code>$1</code>');
      
      // 处理段落和换行
      safeText = safeText.replace(/\n\n/g, '</p><p>');
      safeText = '<p>' + safeText + '</p>';
      safeText = safeText.replace(/<p><\/p>/g, '');
      
      return safeText;
    }
  }
}
</script>

<style>
.markdown-body {
  color: inherit;
  font-size: 16px;
  line-height: 1.6;
  word-wrap: break-word;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

.markdown-body h1 {
  font-size: 2em;
  padding-bottom: .3em;
  border-bottom: 1px solid #eaecef;
}

.markdown-body h2 {
  font-size: 1.5em;
  padding-bottom: .3em;
  border-bottom: 1px solid #eaecef;
}

.markdown-body h3 {
  font-size: 1.25em;
}

.markdown-body h4 {
  font-size: 1em;
}

.markdown-body h5 {
  font-size: 0.875em;
}

.markdown-body h6 {
  font-size: 0.85em;
  color: #6a737d;
}

.markdown-body p {
  margin-top: 0;
  margin-bottom: 16px;
}

.markdown-body blockquote {
  padding: 0 1em;
  color: #6a737d;
  border-left: 0.25em solid #dfe2e5;
  margin: 0;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 2em;
  margin-top: 0;
  margin-bottom: 16px;
}

.markdown-body li {
  word-wrap: break-word;
}

.markdown-body li + li {
  margin-top: 0.25em;
}

.markdown-body code {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: rgba(27,31,35,0.05);
  border-radius: 3px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
}

.markdown-body pre {
  word-wrap: normal;
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: #f6f8fa;
  border-radius: 3px;
}

.markdown-body pre code {
  display: inline;
  max-width: auto;
  padding: 0;
  margin: 0;
  overflow: visible;
  line-height: inherit;
  word-wrap: normal;
  background-color: transparent;
  border: 0;
}

.markdown-body table {
  display: block;
  width: 100%;
  overflow: auto;
  border-spacing: 0;
  border-collapse: collapse;
  margin-top: 0;
  margin-bottom: 16px;
}

.markdown-body table th {
  font-weight: 600;
  padding: 6px 13px;
  border: 1px solid #dfe2e5;
}

.markdown-body table td {
  padding: 6px 13px;
  border: 1px solid #dfe2e5;
}

.markdown-body table tr {
  background-color: #fff;
  border-top: 1px solid #c6cbd1;
}

.markdown-body table tr:nth-child(2n) {
  background-color: #f6f8fa;
}

.markdown-body img {
  max-width: 100%;
  box-sizing: content-box;
  background-color: #fff;
}

.markdown-body hr {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: #e1e4e8;
  border: 0;
}

/* 深色模式支持 */
@media (prefers-color-scheme: dark) {
  .markdown-body table tr {
    background-color: #1e1e1e;
    border-top: 1px solid #444;
  }
  
  .markdown-body table tr:nth-child(2n) {
    background-color: #252525;
  }
  
  .markdown-body table td,
  .markdown-body table th {
    border: 1px solid #444;
  }
  
  .markdown-body blockquote {
    color: #9e9e9e;
    border-left: 0.25em solid #444;
  }
  
  .markdown-body code {
    background-color: rgba(255, 255, 255, 0.1);
  }
  
  .markdown-body pre {
    background-color: #2d2d2d;
  }
  
  .markdown-body hr {
    background-color: #444;
  }
  
  .markdown-body img {
    background-color: transparent;
  }
}
</style> 