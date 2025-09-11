import type { BasicAcceptedElems, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

const name = 'Baidu';
const host = 'www.baidu.com';

export const BaiduSearchConfig = {
  name,
  description: `${name} search tool`,
  url: `https://${host}/s`,
  host,
  referrer: `https://${host}/`,
  params: (query: string, page: number) => ({
    wd: query,
    pn: page * 10,
    ie: 'utf-8',
    rn: 10,
    // 添加更多参数以模拟真实搜索
    tn: 'baiduhome_pg',
    rsv_spt: 1,
    rsv_iqid: '0x98ace65100003d5b',
  }),
  // 更新选择器以匹配最新的百度页面结构
  selector: '.result, .result-op, .c-container[tpl], .c-result, div[class*="result"]',
  // 优化标题选择器
  titleSelector: 'h3 a, .t a, .tts-title, h3, .result-title',
  // 优化链接选择器 
  linkSelector: 'h3 a, .t a, .tts-title, .result-title a, a[href*="http"]',
  snippetSelector: (element: BasicAcceptedElems<AnyNode>, $: CheerioAPI) => {
    // 扩展描述文本的选择器，增加更多可能的类名
    const selectors = [
      '.c-abstract', 
      '.c-span-last .c-color-text',
      '.content-right',
      '.right-link', 
      '.c-row .c-span-last',
      '.abstract',
      '.op_exactqa_s_answer',
      '.op_exactqa_detail',
      '.c-gap-top-small',
      '.c-font-normal',
      // 添加更多可能的描述选择器
      'div[class*="abstract"]',
      'div[class*="content"]',
      'span[class*="c-color-text"]'
    ];

    let snippetText = '';
    
    // 按优先级尝试各个选择器
    for (const selector of selectors) {
      const found = $(element).find(selector);
      if (found.length > 0) {
        const text = found.text().trim();
        if (text && text.length > 10) { // 确保有意义的文本长度
          snippetText = text;
          break;
        }
      }
    }
    
    // 如果以上都没找到，尝试直接从元素中提取文本（排除标题）
    if (!snippetText) {
      const titleText = $(element).find('h3, .t, .tts-title, .result-title').text();
      const allText = $(element).text().replace(titleText, '').trim();
      
      // 提取前200个字符作为描述
      if (allText && allText.length > 10) {
        snippetText = allText.substring(0, 200) + (allText.length > 200 ? '...' : '');
      }
    }

    return snippetText;
  },
  pageCount: 2,
  delay: true,
};
