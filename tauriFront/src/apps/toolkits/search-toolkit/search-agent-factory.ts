import type { PreviewListItem } from '@dora/share';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { BaseAgent } from '../../agent/base-agent.js';
import type { AgentTaskRef } from '../../agent/type.js';
import type { SpecializedToolAgent, SpecializedToolAgentConstructor } from '../types.js';
import { commonHeader } from './common-header.js';

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
      
      try {

      for (let page = 0; page < (config.pageCount || 2); page++) {
        if (config.delay && page > 0) {
          const delay = 1000 + Math.floor(Math.random() * 2000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // 使用 tauriFetch 避免浏览器 CORS/受限请求头问题
        const url = new URL(config.url);
        const params = config.params(query.query, page);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

        console.log(`[${config.name}Search] Searching for: "${query.query}" (page ${page + 1})`);
        console.log(`[${config.name}Search] Request URL: ${url.toString()}`);

        try {
          const response = await tauriFetch(url.toString(), {
            method: 'GET',
            headers: {
              ...commonHeader,
              // 添加更多模拟真实浏览器的请求头
              'Referer': config.referrer,
              'Accept-Charset': 'utf-8',
              'DNT': '1',
              // 不要设置受限头：Host/Cookie (由Tauri自动处理)
            },
            // Tauri fetch doesn't support timeout parameter
          });

          if (!response.ok) {
            console.warn(`[${config.name}Search] HTTP ${response.status}: ${response.statusText}`);
            continue; // 跳过这一页，尝试下一页
          }

          const html = await response.text();
          console.log(`[${config.name}Search] Response length: ${html.length} characters`);

          // 检查是否被反爬虫机制阻止
          if (html.includes('百度安全验证') || html.includes('安全验证') || html.includes('请输入验证码')) {
            console.warn(`[${config.name}Search] Anti-bot detection triggered, skipping this page`);
            continue;
          }

          const $ = cheerio.load(html);
          const elements = $(config.selector);
          console.log(`[${config.name}Search] Found ${elements.length} result elements on page ${page + 1}`);

          elements.each((index, element) => {
            try {
              // 提取标题
              const titleElement = $(element).find(config.titleSelector);
              let title = titleElement.first().text().trim();
              
              // 如果标题为空，尝试从链接文本中获取
              if (!title) {
                title = $(element).find(config.linkSelector).first().text().trim();
              }

              // 提取链接
              let link = $(element).find(config.linkSelector).first().attr('href');
              
              // 处理相对链接和百度跳转链接
              if (link) {
                if (link.startsWith('/link?url=')) {
                  // 百度跳转链接，提取实际URL
                  const urlMatch = link.match(/url=([^&]+)/);
                  if (urlMatch) {
                    link = decodeURIComponent(urlMatch[1]);
                  }
                } else if (link.startsWith('/')) {
                  // 相对链接，转换为绝对链接
                  link = `https://${config.host}${link}`;
                } else if (!link.startsWith('http')) {
                  // 其他情况的相对链接
                  link = `https://${config.host}/${link}`;
                }
              }

              // 提取描述
              let snippet: string = '';
              if (typeof config.snippetSelector === 'function') {
                snippet = config.snippetSelector(element, $);
              } else {
                snippet = $(element).find(config.snippetSelector).text();
              }

              // 清理文本
              title = title.replace(/\s+/g, ' ').trim();
              snippet = snippet.replace(/\s+/g, ' ').trim();

              // 验证结果的有效性
              if (!title || title.length < 2) {
                console.log(`[${config.name}Search] Skipping result ${index + 1}: empty title`);
                return;
              }

              if (!link || (!link.startsWith('http') && !link.startsWith('/'))) {
                console.log(`[${config.name}Search] Skipping result ${index + 1}: invalid link - ${link}`);
                return;
              }

              if (!snippet || snippet.length < 5) {
                console.log(`[${config.name}Search] Skipping result ${index + 1}: empty or too short snippet`);
                return;
              }

              console.log(`[${config.name}Search] Found valid result ${index + 1}: ${title.substring(0, 50)}...`);
              results.push({ 
                title, 
                url: link, 
                description: snippet.substring(0, 300) // 限制描述长度
              });
            } catch (error) {
              console.warn(`[${config.name}Search] Error parsing result element ${index + 1}:`, error);
            }
          });
        } catch (error) {
          console.error(`[${config.name}Search] Error fetching page ${page + 1}:`, error);
          // 继续处理下一页，而不是完全失败
          continue;
        }
      }

      console.log(`[${config.name}Search] Search completed. Found ${results.length} valid results`);

      // 如果没有找到任何结果，提供有用的反馈
      if (results.length === 0) {
        console.warn(`[${config.name}Search] No results found for query: "${query.query}"`);
        
        await taskRef.studio.start(
          {
            type: 'searchResults',
            description: `${query.query} - 未找到结果`,
            payload: {
              query: query.query,
              searchResults: [],
              message: `未找到关于 "${query.query}" 的搜索结果。建议：\n1. 检查搜索关键词的拼写\n2. 尝试使用更通用的关键词\n3. 稍后再试（可能是网络问题）`
            },
          },
          taskRef.observer,
          taskRef.abortSignal,
        );

        return `未找到关于 "${query.query}" 的搜索结果。建议尝试使用不同的关键词或稍后重试。`;
      }

      // 去重处理 - 移除重复的URL
      const uniqueResults = results.filter((result, index, arr) => 
        arr.findIndex(r => r.url === result.url) === index
      );

      // 只保留前三个结果
      const limitedResults = uniqueResults.slice(0, 3);

      console.log(`[${config.name}Search] After deduplication: ${uniqueResults.length} unique results, limited to: ${limitedResults.length}`);

      await taskRef.studio.start(
        {
          type: 'searchResults',
          description: `${query.query} - 找到${limitedResults.length}个结果`,
          payload: {
            query: query.query,
            searchResults: limitedResults,
            resultCount: limitedResults.length
          },
        },
        taskRef.observer,
        taskRef.abortSignal,
      );

      // 创建搜索结果摘要
      const summary = limitedResults.map((result, index) => 
        `${index + 1}. ${result.title}\n   链接: ${result.url}\n   描述: ${result.description}\n`
      ).join('\n');

      return `搜索 "${query.query}" 共找到 ${limitedResults.length} 个结果：\n\n${summary}`;
      
      } catch (error: any) {
        console.error(`[${config.name}Search] Fatal error during search:`, error);
        
        await taskRef.studio.start(
          {
            type: 'searchResults',
            description: `${query.query} - 搜索失败`,
            payload: {
              query: query.query,
              searchResults: [],
              error: `搜索失败: ${error instanceof Error ? error.message : '未知错误'}`
            },
          },
          taskRef.observer,
          taskRef.abortSignal,
        );

        throw new Error(`搜索失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  } as unknown as SpecializedToolAgentConstructor;
}

