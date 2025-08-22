import { lastValueFrom } from 'rxjs';
import { BaseAgent } from '../../agent/base-agent.js';
import type { AgentTaskRef } from '../../agent/type.js';
import type { SpecializedToolAgent } from '../types.js';
import { extractHtmlContent } from './extract-html-content.js';
import { fetch } from '@tauri-apps/plugin-http'
import { isExternalWebUrl } from '../../../utils/urlGuards';



export class WebPageSummaryAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'WebPageSummaryTool';

  description = 'Web page summary tool';

  parameters = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Web page url' },
    },
    required: ['url'],
  };

  strict = true;

  async execute(query: Record<string, string>, taskRef: AgentTaskRef): Promise<unknown> {
    this.initialSystemMessage(`You are a web page summary tool.
    You will receive a web page url, and you need to extract the core points and necessary information from the web page content.
    Please reply in the same language as that of the web page.
    `);

    // 仅在 URL 为外部网页时才让 Studio 预览
    if (isExternalWebUrl(query.url)) {
      await taskRef.studio.start(
        {
          type: 'openUrl',
          payload: {
            url: query.url,
          },
          description: query.url,
        },
        taskRef.observer,
        taskRef.abortSignal,
      );
    } else {
      // 给出友好提示，避免在 Studio 面板中打开应用自身界面
      await taskRef.studio.start(
        {
          type: 'editor',
          payload: `Blocked opening app URL in Studio: ${query.url}`,
          description: 'Blocked internal app URL',
        },
        taskRef.observer,
        taskRef.abortSignal,
      );
    }

    // 直接通过 Tauri HTTP 插件抓取页面 HTML，避免 executeJavaScript 依赖 Electron
    const response = await fetch(query.url, { method: 'GET' });
    const html = await response.text();
    try {
      const summary = extractHtmlContent(html);

      const summaryCompletion = await this.run(
        `Extract the core points and necessary information from the following web page content: 

${summary}`,
        taskRef,
      );

      if (!summaryCompletion) {
        throw new Error('Failed to extract html content');
      }

      taskRef.studio.browserUse.webContentsView.setVisible(false);

      await taskRef.studio.startWithStream(
        {
          type: 'editor',
          description: 'Web Page Summary',
          payload: '',
        },
        summaryCompletion,
        taskRef.observer,
      );

      return await lastValueFrom(summaryCompletion.contentStream);
    } catch (error) {
      throw new Error('Failed to extract html content');
    }
  }
}
