import { BaseAgent } from '../../agent/base-agent';
import type { AgentTaskRef } from '../../agent/type';
import type { SpecializedToolAgent } from '../types';
import { generateHtmlTemplate } from './html-template';
import databaseService from '../../../services/database';
import { lastValueFrom, defaultIfEmpty } from 'rxjs';

export class HtmlReportAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'HtmlReportTool';

  description = 'Generate beautiful HTML reports that summarize conversation content and task execution results with modern UI design and responsive layout. ONLY use this tool when the user explicitly requests to generate a report, export conversation data, or create a summary document. Do not use this tool for regular conversation responses.';

  parameters = {
    type: 'object',
    properties: {
      title: { 
        type: 'string', 
        description: 'Report title',
        default: 'Dora AI Conversation Report'
      },
      summary: { 
        type: 'string', 
        description: 'Content summary (optional)'
      },
      fileName: {
        type: 'string',
        description: 'HTML file name (optional, defaults to timestamp)'
      }
    },
    required: [],
  };

  strict = true;

  async execute(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<string> {
    const title = (query.title as string) || 'Dora AI 对话报告';
    const summary = query.summary as string || '';
    const fileName = (query.fileName as string) || `dora_report_${Date.now()}.html`;
    try {
      // 获取对话消息
      let messages: any[] = [];
      try {
        messages = await databaseService.getMessages(taskRef.conversationId);
      } catch (error) {
        console.warn('获取消息失败:', error);
      }
      
      console.log('messages', messages);

      // 格式化数据，提取图片URL
      const formattedMessages = messages.map(msg => {
        // 解析消息内容，可能包含JSON格式的工具调用信息
        let content = msg.content || '';
        let toolCalls = undefined;
        
        try {
          // 尝试解析JSON格式的内容
          const parsedContent = JSON.parse(content);
          if (parsedContent.text) {
            content = parsedContent.text;
          }
          if (parsedContent.toolCalls) {
            toolCalls = this.formatToolCalls(parsedContent.toolCalls);
          }
        } catch {
          // 如果不是JSON格式，直接使用原内容
        }

        const strContent = String(content);
        const images = this.extractImageUrls(strContent);
        
        return {
          role: msg.role || 'unknown',
          content: content,
          timestamp: msg.timestamp ? new Date(msg.timestamp).toLocaleString('zh-CN') : undefined,
          toolCalls: toolCalls,
          images
        };
      });

      console.log('formattedMessages', formattedMessages);
      const allImages: string[] = Array.from(new Set(formattedMessages.flatMap((m: any) => Array.isArray(m.images) ? m.images : [])));

      const reportData = {
        title,
        summary,
        conversationId: taskRef.conversationId,
        timestamp: new Date().toLocaleString('zh-CN'),
        messages: formattedMessages,
        images: allImages
      };

      // 生成HTML内容
      let htmlContent: string;
      htmlContent = await this.generateHtmlWithAI(reportData, taskRef);

      // 确保是完整可独立打开的HTML文档
      htmlContent = this.ensureFullHtml(htmlContent, reportData);

      // 直接在Studio中显示HTML报告，提供下载功能
      await taskRef.studio.start(
        {
          type: 'htmlReport',
          payload: {
            htmlContent: htmlContent,
            title: title,
            fileName: fileName,
            reportData: reportData
          },
          description: `HTML报告 - ${title}`,
        },
        taskRef.observer,
        taskRef.abortSignal,
      );

      // 完成任务并添加报告链接
      const successMessage = [
        '✅ HTML报告已生成并打开。',
        `• 报告标题：${title}`,
        `• 生成时间：${new Date().toLocaleString('zh-CN')}`,
        `• 对话消息数：${formattedMessages.length}`,
        `• 检测到图片：${allImages.length} 张`,
        '',
        '操作提示：点击消息中的报告链接可查看报告，右上角“下载报告”可保存为HTML离线查看。'
      ].join('\n');
      
      const messageModel = await taskRef.createMessage(successMessage);
      
      // 添加报告链接内容块
      const reportLinkBlock = {
        type: 'html_report',
        content: {
          title: title,
          timestamp: new Date().toLocaleString('zh-CN'),
          conversationId: taskRef.conversationId,
          htmlContent: htmlContent,
          fileName: fileName
        },
        timestamp: Date.now()
      };
      
      // 将报告链接块添加到消息内容中
      try {
        const existingContent = JSON.parse(messageModel.content || '[]');
        const updatedContent = Array.isArray(existingContent) ? existingContent : [];
        updatedContent.push(reportLinkBlock);
        messageModel.content = JSON.stringify(updatedContent);
      } catch {
        // 如果解析失败，创建新的内容块数组
        messageModel.content = JSON.stringify([{
          type: 'text',
          content: successMessage,
          timestamp: Date.now()
        }, reportLinkBlock]);
      }
      
      taskRef.completeMessage(messageModel);
      taskRef.observer.next(messageModel);

      return JSON.stringify({
        success: true,
        fileName: fileName,
        title: title,
        messageCount: formattedMessages.length,
        imageCount: allImages.length,
        message: '✅ HTML报告已生成并显示',
        instructions: '📊 报告已打开，点击"下载报告"按钮即可保存到本地',
        previewMode: 'studio'
      }, null, 2);

    } catch (error) {
      console.error('生成HTML报告失败:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: '❌ HTML报告生成失败'
      }, null, 2);
    }
  }

  // 将文本中的图片URL提取出来
  private extractImageUrls(text: string): string[] {
    if (!text) return [];
    const urls = new Set<string>();
    const regex = /(https?:\/\/[^\s'"()<>]+\.(?:png|jpe?g|gif|webp|svg))(?:\?[^\s'"<>]*)?/ig;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      urls.add(m[1]);
    }
    // 支持 data URL 图片
    const dataUrlRegex = /(data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)\/??/ig;
    while ((m = dataUrlRegex.exec(text)) !== null) {
      urls.add(m[1]);
    }
    return Array.from(urls);
  }

  // 确保HTML文档完整可用：若AI仅返回片段，则包裹进标准模板外壳
  private ensureFullHtml(html: string, data: any): string {
    const hasHtmlTag = /<html[\s>]/i.test(html);
    const hasBodyTag = /<body[\s>]/i.test(html);
    const hasDoctype = /<!DOCTYPE\s+html/i.test(html);
    if (hasHtmlTag && hasBodyTag && hasDoctype) return html;

    const safeTitle = (data?.title || 'Dora 报告').toString();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; margin: 0; padding: 0; background: #0b0b0f; color: #e5e7eb; }
    .shell { max-width: 1200px; margin: 0 auto; padding: 24px; }
    header { margin: 12px 0 16px; }
    header h1 { font-size: 20px; margin: 0; }
    .content { background: #111827; border: 1px solid #374151; border-radius: 12px; padding: 16px; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    pre { background: #1f2937; color: #f3f4f6; padding: 12px; border-radius: 8px; overflow: auto; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>${safeTitle}</h1>
      <div>生成时间：${new Date().toLocaleString('zh-CN')}</div>
    </header>
    <div class="content">${html}</div>
  </div>
</body>
</html>`;
  }

  private async generateHtmlWithAI(reportData: any, taskRef: AgentTaskRef): Promise<string> {
    // 设置系统消息
    this.initialSystemMessage(`你是一个专业的HTML报告生成器。你需要根据提供的数据生成一个美观、现代化且可离线打开的HTML报告。

要求：
1. 必须生成完整的HTML文档，包含 <!DOCTYPE html>、<html>、<head>、<body> 标签
2. 使用现代CSS样式，包含响应式设计
3. 如果数据中提供了图片URL，请在合适位置以网格或图集形式展示图片（使用 <img src="...">，自适应宽度）
4. 所有代码必须合法、闭合且格式正确
5. 只返回HTML源码，不要包含任何解释文字`);

    // 构建提示词
    const prompt = `请基于以下数据生成详细的、可直接打开的HTML报告：\n\n` +reportData.messages.map((msg: any) => `${msg.role}: ${msg.content}`).join('\n') 
    try {
      // 调用AI生成HTML
      const completion = await this.run(prompt, taskRef);
      if (!completion) {
        throw new Error('AI生成失败');
      }

      // 获取生成的内容
      const htmlContent = await lastValueFrom(
        completion.contentStream.pipe(defaultIfEmpty(''))
      );

      if (!htmlContent.trim()) {
        throw new Error('AI生成的HTML内容为空');
      }

      return htmlContent;
    } catch (error) {
      console.error('AI生成HTML失败:', error);
      // 如果AI生成失败，回退到模板生成
      return generateHtmlTemplate(reportData as any);
    }
  }

  private formatToolCalls(toolCalls: any): Array<{ name: string; args: any; result: any }> {
    if (!Array.isArray(toolCalls)) return [];
    
    return toolCalls.map(call => ({
      name: call.name || call.function?.name || 'unknown',
      args: call.args || call.function?.arguments || call.arguments || {},
      result: call.result || call.output || 'No result'
    }));
  }
}