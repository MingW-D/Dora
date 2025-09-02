import type { PreviewListItem } from '@dora/share';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import * as yaml from 'js-yaml';
import { BaseAgent } from '../../agent/base-agent.js';
import type { AgentTaskRef } from '../../agent/type.js';
import type { SpecializedToolAgent, SpecializedToolAgentConstructor } from '../types.js';
import { commonHeader } from './common-header.js';
import axios from 'axios';

// 搜索引擎配置接口
interface SearchEngineConfig {
  name: string;
  description: string;
  url: string;
  host: string;
  referrer: string;
  params: (query: string, page: number) => Record<string, string | number>;
  selector: string;
  titleSelector: string;
  linkSelector: string;
  snippetSelector:
    | string
    | ((element: cheerio.BasicAcceptedElems<AnyNode>, $: cheerio.CheerioAPI) => string);
  pageCount?: number;
  delay?: boolean;
}

// 创建搜索代理的工厂函数
export function createSearchAgent(config: SearchEngineConfig): SpecializedToolAgentConstructor {
  return class SearchAgent extends BaseAgent implements SpecializedToolAgent {
    override name = `${config.name}SearchTool`;
    description = config.description;
    parameters = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords' },
      },
      required: ['query'],
    };
    strict = true;

    async execute(query: Record<string, string>, taskRef: AgentTaskRef): Promise<unknown> {
      const results: PreviewListItem[] = [];
      // const cookies = ''; // 不再手动管理 Cookie

      for (let page = 0; page < (config.pageCount || 2); page++) {
        if (config.delay && page > 0) {
          const delay = 1000 + Math.floor(Math.random() * 2000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // 使用 tauriFetch 避免浏览器 CORS/受限请求头问题
        const url = new URL(config.url);
        const params = config.params(query.query, page);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

        const response = await tauriFetch(url.toString(), {
          method: 'GET',
          headers: {
            ...commonHeader,
            // 不要设置受限头：Host/Referer/Cookie
          },
        });
        const html = await response.text();

        // 由于不再从响应头读取 set-cookie，这一段删除
        // const setCookieHeader = response.headers['set-cookie'] as unknown as string;

        const $ = cheerio.load(html);
        $(config.selector).each((index, element) => {
          const title = $(element).find(config.titleSelector).text();
          const link = $(element).find(config.linkSelector).attr('href');

          let snippet: string;
          if (typeof config.snippetSelector === 'function') {
            snippet = config.snippetSelector(element, $);
          } else {
            snippet = $(element).find(config.snippetSelector).text();
          }

          if (!title || !link || !snippet) {
            return;
          }
          results.push({ title, url: link, description: snippet });
        });
      }

      await taskRef.studio.start(
        {
          type: 'searchResults',
          description: query.query,
          payload: {
            query: query.query,
            searchResults: results,
          },
        },
        taskRef.observer,
        taskRef.abortSignal,
      );

      return yaml.dump(results);
    }
  } as unknown as SpecializedToolAgentConstructor;
}

