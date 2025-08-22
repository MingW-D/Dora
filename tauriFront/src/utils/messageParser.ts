export interface CodeBlock {
  type: 'code';
  code: string;
  language: string;
}

export interface MarkdownBlock {
  type: 'markdown';
  content: string;
}

export type ContentBlock = CodeBlock | MarkdownBlock;

/**
 * 解析消息内容，将代码块和Markdown内容分离
 * @param content 消息内容
 * @returns 解析后的内容块数组
 */
export function parseMessage(content: string): ContentBlock[] {
  if (!content) return [];

  const blocks: ContentBlock[] = [];
  const codeBlockRegex = /```([\w-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // 添加代码块前的Markdown文本
    if (match.index > lastIndex) {
      const markdownBefore = content.substring(lastIndex, match.index).trim();
      if (markdownBefore) {
        blocks.push({
          type: 'markdown',
          content: markdownBefore
        });
      }
    }

    // 添加代码块
    const language = match[1].trim() || 'plaintext';
    const code = match[2];
    blocks.push({
      type: 'code',
      code,
      language
    });

    // 更新最后处理的索引
    lastIndex = match.index + match[0].length;
  }

  // 添加最后剩余的Markdown文本
  if (lastIndex < content.length) {
    const remainingText = content.substring(lastIndex).trim();
    if (remainingText) {
      blocks.push({
        type: 'markdown',
        content: remainingText
      });
    }
  }

  return blocks;
}

/**
 * 检查内容块是否是代码块
 */
export function isCodeBlock(block: ContentBlock): block is CodeBlock {
  return block.type === 'code';
}

/**
 * 检查内容块是否是Markdown块
 */
export function isMarkdownBlock(block: ContentBlock): block is MarkdownBlock {
  return block.type === 'markdown';
} 