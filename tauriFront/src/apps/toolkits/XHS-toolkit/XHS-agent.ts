import { BaseAgent } from '../../agent/base-agent';
import type { AgentTaskRef } from '../../agent/type';
import type { SpecializedToolAgent } from '../types';
import { smartHttpRequest } from '../../../utils/tauriHttp';
import xhsvmScript from './xhsvm.js?raw';
import { Command } from '@tauri-apps/plugin-shell';



// 简化的笔记内容接口 - 对应Python版本的content_list结构
interface XHSSimpleNote {
  author: string;
  publish_time: string;
  content: string;
  images: string[];
}

// 简化的评论接口 - 对应Python版本的comment_list结构
interface XHSSimpleComment {
  author: string;
  content: string;
  create_time: string;
}

// 简化的搜索结果接口 - 对应Python版本的search_notes返回格式
interface XHSSimpleSearchResult {
  title: string;
  liked_count: number;
  url: string;
  note_id: string;
}

// XHS API 类

class XhsApi {
  private _cookie: string;
  private _base_url = 'https://edith.xiaohongshu.com';
  private _defaultHeaders: Record<string, string> = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'content-type': 'application/json;charset=UTF-8',
    'origin': 'https://www.xiaohongshu.com',
    'referer': 'https://www.xiaohongshu.com/',
    'sec-ch-ua': '"Chromium";v="135", "Not(A:Brand";v="24", "Google Chrome";v="135"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
  };

  // 缓存签名函数
  private _getXsXtFn: ((uri: string, data: any, cookie: string) => { 'X-s': string; 'X-t': number } | string) | null = null;

  constructor(cookie: string) {
    this._cookie = cookie;
  }

  private _parse_cookie(cookie: string): Record<string, string> {
    const cookie_dict: Record<string, string> = {};
    if (cookie) {
      const pairs = cookie.split(';');
      for (const pair of pairs) {
        const [key, value] = pair.trim().split('=', 2);
        if (key) cookie_dict[key] = value ?? '';
      }
    }
    return cookie_dict;
  }

  private async request(
    uri: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      headers?: Record<string, string>;
      params?: Record<string, any>;
      data?: any;
    } = {}
  ): Promise<any> {
    const { method = 'GET', headers = {}, params, data } = options;

    // 构建完整URL，包含查询参数
    let fullUrl = `${this._base_url}${uri}`;
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const paramString = searchParams.toString();
      if (paramString) {
        fullUrl += `?${paramString}`;
      }
    }

    const requestHeaders = {
      ...this._defaultHeaders,
      Cookie: this._cookie,
      ...headers
    };

    // 调试日志
    console.log('=== XHS API 请求 ===');
    console.log('URL:', fullUrl);
    console.log('Method:', method);
    console.log('Headers:', requestHeaders);
    if (data) {
      console.log('Body:', JSON.stringify(data, null, 2));
    }

    // 使用 smartHttpRequest 替换 axios，避免CORS问题
    const response = await smartHttpRequest({
      url: fullUrl,
      method,
      headers: requestHeaders,
      body: data ? JSON.stringify(data) : undefined
    });

    console.log('=== XHS API 响应 ===');
    console.log('Status:', response.status);
    console.log('Body:', response.body.substring(0,2000) + '...'); // 只打印前500字符

    // 检查响应状态
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP请求失败: ${response.status}`);
    }

    // 解析响应体
    try {
      const parsed = JSON.parse(response.body);
      return parsed;
    } catch (error) {
      console.error('解析响应JSON失败:', error);
      console.error('响应内容:', response.body);
      return response.body;
    }
  }

  private base36encodeBigInt(number: bigint, alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'): string {
    let base36 = '';
    const sign = number < 0n ? '-' : '';
    number = number < 0n ? -number : number;
    const base = 36n;
    if (number === 0n) return alphabet[0];
    while (number > 0n) {
      const i = Number(number % base);
      base36 = alphabet[i] + base36;
      number = number / base;
    }
    return sign + base36;
  }

  private search_id(): string {
    // 与 Python: (int(time.time()*1000) << 64) + rand 的逻辑等价
    const e = (BigInt(Date.now()) << 64n);
    const t = BigInt(Math.floor(Math.random() * 2147483646));
    return this.base36encodeBigInt(e + t);
  }

  private ensureGetXsXtLoaded() {
    if (this._getXsXtFn) return;
    try {
      // 由于xhsvm.js是为Node.js环境设计的，需要特殊处理
      if (typeof window !== 'undefined') {
        // 检查是否已经加载过
        if ((window as any).__XHS_GetXsXt && typeof (window as any).__XHS_GetXsXt === 'function') {
          this._getXsXtFn = (window as any).__XHS_GetXsXt;
          console.log('使用已加载的 GetXsXt 函数');
          return;
        }
        
        try {
          // 修改xhsvm.js脚本，使其兼容浏览器环境
          // 将第一行的 "window = global" 替换为兼容性代码
          let modifiedScript = xhsvmScript;
          
          // 替换第一行，使其在浏览器环境中兼容
          modifiedScript = modifiedScript.replace(
            /^window\s*=\s*global/m,
            'var global = (typeof global !== "undefined") ? global : window;'
          );
          
          // 删除或注释掉 "delete global" 和 "delete Buffer"
          modifiedScript = modifiedScript.replace(/^delete\s+global/m, '// delete global');
          modifiedScript = modifiedScript.replace(/^delete\s+Buffer/m, '// delete Buffer');
          
          // 在全局作用域执行修改后的脚本
          const scriptElement = document.createElement('script');
          scriptElement.textContent = modifiedScript;
          scriptElement.id = 'xhsvm-script-modified';
          document.head.appendChild(scriptElement);
          
          // 检查GetXsXt函数是否可用
          if ((window as any).GetXsXt && typeof (window as any).GetXsXt === 'function') {
            this._getXsXtFn = (window as any).GetXsXt;
            (window as any).__XHS_GetXsXt = this._getXsXtFn;
            console.log('成功加载 GetXsXt 函数');
          } else {
            // 清理script标签
            document.head.removeChild(scriptElement);
            throw new Error('GetXsXt function not found after loading modified xhsvm.js');
          }
        } catch (evalError) {
          console.error('执行 xhsvm.js 失败:', evalError);
          throw evalError;
        }
      } else {
        throw new Error('Window object not available, cannot load xhsvm.js');
      }
    } catch (err) {
      console.error('加载 xhsvm.js 失败:', err);
      throw err;
    }
  }

  private get_xs_xt(uri: string, data: any, cookie: string): { 'X-s': string; 'X-t': number } {
    this.ensureGetXsXtLoaded();
    const raw = this._getXsXtFn!(uri, data, cookie);
    // Python 返回的是 JSON 字符串，这里兼容对象与字符串
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }
    return raw as { 'X-s': string; 'X-t': number };
  }

  async get_me(): Promise<any> {
    const uri = '/api/sns/web/v2/user/me';
    return this.request(uri, { method: 'GET' });
  }

  async searchNotes(keywords: string, limit: number = 20): Promise<any> {
    const data = {
      keyword: keywords,
      page: 1,
      page_size: limit,
      search_id: this.search_id(),
      sort: 'general',
      note_type: 0,
      ext_flags: [] as any[],
      geo: '',
      image_formats: JSON.stringify(['jpg', 'webp', 'avif'])
    };
    
    const uri = '/api/sns/web/v1/search/notes';
    
    // 尝试添加签名（虽然Python版本不需要，但Tauri HTTP可能需要）
    console.log('尝试为search_notes添加签名...');
    try {
      const xsxt = this.get_xs_xt(uri, data, this._cookie);
      const headers: Record<string, string> = {
        'x-s': xsxt['X-s'],
        'x-t': String(xsxt['X-t'])
      };
      console.log('签名生成成功:', xsxt);
      return this.request(uri, { method: 'POST', data, headers });
    } catch (signError) {
      console.warn('签名生成失败，尝试不使用签名:', signError);
      // 如果签名失败，回退到不使用签名
      return this.request(uri, { method: 'POST', data });
    }
  }

  async home_feed(): Promise<any> {
    const data = {
      category: 'homefeed_recommend',
      cursor_score: '',
      image_formats: JSON.stringify(['jpg', 'webp', 'avif']),
      need_filter_image: false,
      need_num: 8,
      num: 18,
      note_index: 33,
      refresh_type: 1,
      search_key: '',
      unread_begin_note_id: '',
      unread_end_note_id: '',
      unread_note_count: 0
    };
    const uri = '/api/sns/web/v1/homefeed';
    const xsxt = this.get_xs_xt(uri, data, this._cookie);
    const headers: Record<string, string> = {
      'x-s': xsxt['X-s'],
      'x-t': String(xsxt['X-t'])
    };
    return this.request(uri, { method: 'POST', data, headers });
  }

  async getNoteContent(note_id: string, xsec_token: string): Promise<any> {
    const data = {
      source_note_id: note_id,
      image_formats: ['jpg', 'webp', 'avif'],
      extra: { need_body_topic: '1' },
      xsec_source: 'pc_feed',
      xsec_token
    };
    const uri = '/api/sns/web/v1/feed';
    const xsxt = this.get_xs_xt(uri, data, this._cookie);
    const headers: Record<string, string> = {
      'x-s': xsxt['X-s'],
      'x-t': String(xsxt['X-t']),
      // 与 Python 版本保持一致
      'x-s-common': '2UQAPsHCPUIjqArjwjHjNsQhPsHCH0rjNsQhPaHCH0c1PahIHjIj2eHjwjQ+GnPW/MPjNsQhPUHCHdYiqUMIGUM78nHjNsQh+sHCH0c1+0H1PUHVHdWMH0ijP/DAP9L9P/DhPerUJoL72nIM+9Qf8fpC2fHA8n4Fy0m1Gnpd4n+I+BHAPeZIPerMw/GhPjHVHdW9H0il+Ac7weZ7PAWU+/LUNsQh+UHCHSY8pMRS2LkCGp4D4pLAndpQyfRk/Sz8yLleadkYp9zMpDYV4Mk/a/8QJf4EanS7ypSGcd4/pMbk/9St+BbH/gz0zFMF8eQnyLSk49S0Pfl1GflyJB+1/dmjP0zk/9SQ2rSk49S0zFGMGDqEybkea/8QJLkx/fkb+pkgpfYwpFSE/p4Q4MkLp/+ypMph/dkDJpkTp/p+pB4C/F4ayDETn/Qw2fPI/Szz4MSgngkwPSk3nSzwyDRrp/myySLF/dkp2rMra/QypMDlnnM8PrEL/fMypMLA/L4aybkLz/p+pMQT/LzQ+LRLc/+8yfzVnD4+2bkLzflwzbQx/nktJLELngY+yfVMngktJrEr/gY+ySrF/nkm2DFUnfkwJL83nD4zPFMgz/+Ozrk3/Lz8+pkrafkyprbE/M4p+pkrngYypbphnnM+PMkxcg482fYxnD4p+rExyBMyzFFl/dk0PFMCp/pOzrFM/Dz04FECcg4yzBzingkz+LMCafS+pMQi/fM8PDEx/gYyzFEinfM8PLETpg4wprDM/0QwJbSgzg4OpBTCnDz+4MSxy74wySQx/L4tJpkLngSwzB4hn/QbPrErL/zwJLMh/gkp2SSLa/bwzFEknpzz2LMx/gSwpMDA//Qz4Mkr/fMwzrLA/nMzPSkTnfk+2fVM/pzpPMkrzfY8pFDInS4ayLELafSOzbb7npzDJpkLy7kwzBl3/gkDyDRL87Y+yDMC/DzaJpkrLg4+PSkknDzQ4FEoL/zwpBVUngkVyLMoL/m8JLp7/nMyJLMC8BTwpbphnDziyLExzgY+yDEinpzz2pkTpgk8yDbC/0QByFMTn/zOzbDl/LziJpSLcgYypFDlnnMQPFMC8A+ypBVl/gk32pkLL/++zFk3anhIOaHVHdWhH0ija/PhqDYD87+xJ7mdag8Sq9zn494QcUT6aLpPJLQy+nLApd4G/B4BprShLA+jqg4bqD8S8gYDPBp3Jf+m2DMBnnEl4BYQyrkSL9zL2obl49zQ4DbApFQ0yo4c4ozdJ/c9aMpC2rSiPoPI/rTAydb7JdD7zbkQ4fRA2BQcydSy4LbQyrTSzBr7q98ppbztqgzat7b7cgmDqrEQc9YT/Sqha7kn4M+Qc94Sy7pFao4l4FzQzL8laLL6qMzQnfSQ2oQ+ag8d8nzl4MH3+7mc2Skwq9z8P9pfqgzmanTw8/+n494lqgzIqopF2rTC87Plp7mSaL+npFSiL/Z6LozzaM87cLDAn0Q6JnzSygb78DSecnpLpdzUaLL3tFSbJnE08fzSyf4CngQ6J7+fqg4OnS468nzPzrzsJ94AySkIcDSha7+DpdzYanT98n8l4MQj/LlQz9GFcDDA+7+hqgzbNM4O8gWIJezQybbAaLLhtFYd/B8Q2rpAwrMVJLS3G98jLo4/aL+lpAYdad+8nLRAyMm7LDDAa9pfcDbS8eZFtFSbPo+hGfMr4bm7yDS3a9LA878ApfF6qAbc4rEINFRSydp7pDS9zn4Ccg8SL7p74Dlsad+/4gq3a/PhJDDAwepT4g4oJpm7afRmy/zNpFESzBqM8/8l49+QyBpAzeq98/bCL0SQzLEA8DMSqA8xG9lQyFESPMmFprSkG0mELozIaSm78rSh8npkpdzBaLLIqMzM4M+QysRAzopFL74M47+6pdzGag8HpLDAagrFGgmaLLzdqA+l4r+Q2BM+anTtqFzl4obPzsTYJAZIq9cIaB8QygQsz7pFJ7QM49lQ4DESpSmFnaTBa9pkGFEAyLSC8LSi87P9JA8ApopFqURn47bQPFbSPob7yrS389L9q7pPaL+D8pSA4fpfLoz+a/P7qM8M47pOcLclanS84FSh8BL92DkA2bSdqFzyP9prpd4YanW3pFSezfV6Lo41a/+rpDSkafpnagk+2/498n8n4AQQyMZ6JSm7anMU8nLIaLbA8dpF8Lll4rRQy9D9aLpz+bmn4oSOqg4Ca/P6q9kQ+npkLo4lqgbFJDSi+ezA4gc9a/+ynSkSzFkQynzAzeqAq9k68Bp34gqhaopFtFSknSbQP9zA+dpFpDSkJ9p8zrpfag8aJ9RgL9+Qzp+SaL+m8/bl4Mq6pdc3/S8FJrShLr+QzLbAnnLI8/+l4A+IGdQeag8c8AYl4sTOLoz+anTUarS3JpSQPMQPagGI8nzj+g+/L7i94M8FnDDAap4Y4g4YGdp7pFSiPBp3+7QGanSccLldPBprLozk8gpFJnRCLB+7+9+3anTzyomM47pQyFRAPnF3GFS3LfRFpd4FagY/pfMl4sTHpdzNaL+/aLDAy9VjNsQhwaHCP/HlweGM+/Z9PjIj2erIH0iU+emR'
    };
    return this.request(uri, { method: 'POST', data, headers });
  }

  async getNoteComments(note_id: string, xsec_token: string): Promise<any> {
    const uri = '/api/sns/web/v2/comment/page';
    const params = {
      note_id,
      cursor: '',
      top_comment_id: '',
      image_formats: 'jpg,webp,avif',
      xsec_token
    };
    return this.request(uri, { method: 'GET', params });
  }

  async post_comment(note_id: string, comment: string): Promise<any> {
    const uri = '/api/sns/web/v1/comment/post';
    const data = {
      note_id,
      content: comment,
      at_users: [] as any[]
    };
    const xsxt = this.get_xs_xt(uri, data, this._cookie);
    const headers: Record<string, string> = {
      'x-s': xsxt['X-s'],
      'x-t': String(xsxt['X-t'])
    };
    return this.request(uri, { method: 'POST', headers, data });
  }
}


export class XiaohongshuAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'XiaohongshuTool';
  
  description = 'Search and extract Xiaohongshu (Little Red Book) content—including note text, images, videos, hashtags, user comments, and metadata—focusing on travel itineraries, product reviews, lifestyle tips, or how-to guides. Prioritize recent, high-engagement posts with practical, step-by-step advice.';
  
  // 配置：是否使用Python后端（推荐）
  // true: 使用Python脚本（稳定，可靠）
  // false: 使用TypeScript直接调用（可能因Tauri HTTP限制而失败）
  private readonly USE_PYTHON_BACKEND = true;
  
  // 小红书Cookie配置（需要从有效登录会话获取）
  // ⚠️ 重要：请确保Cookie是最新的！可以从浏览器的开发者工具中获取
  // 获取方法：打开 xiaohongshu.com -> F12 -> Application -> Cookies -> 复制所有Cookie值
  private readonly XHS_COOKIE = 'abRequestId=c57fe682-d2fc-5f58-8ce2-0c8b42ff20a3; a1=1970fd420e08csfwx62vnn688m1bgvahhuhlacu7y50000302545; webId=44ab99e10509af6d75c0887343fb4d28; gid=yjW8if4qiWxSyjW8if4J87S7d8YSMiECKJhIxWvIKYY6y128Dkh0x0888q8J2428f4DSi0yd; webBuild=4.79.0; xsecappid=xhs-pc-web; web_session=0400698d369e974828e10de98a3a4b942f34d2; acw_tc=0a5085c517573997204463137e2d5ba030f87c7afb9b969b5ae532b84589e0; loadts=1757399891064; unread={%22ub%22:%2268ba6574000000001b01e410%22%2C%22ue%22:%2268ba9113000000001c0121db%22%2C%22uc%22:32}; websectiga=6169c1e84f393779a5f7de7303038f3b47a78e47be716e7bec57ccce17d45f99; sec_poison_id=5c09b5be-7b4c-46be-b75e-e61afd1eedc7';
  
  // XhsApi 实例
  private xhsApi: XhsApi;
  
  constructor() {
    super();
    this.xhsApi = new XhsApi(this.XHS_COOKIE);
  }
  
  parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search keywords'
      },
      limit: {
        type: 'number',
        description: 'Limit on number of search results (default 10)',
        default: 10,
        minimum: 1,
        maximum: 50
      },
      saveToFile: {
        type: 'boolean',
        description: 'Whether to save results to file (default false)',
        default: false
      },
      fileName: {
        type: 'string',
        description: 'File name to save (optional)'
      }
    },
    required: ['query']
  };
  
  strict = true;
  
  async execute(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<string> {
    try {
      // 直接执行搜索并获取详情功能
      const result = await this.searchWithAllDetails(query, taskRef);
      
      // 在Studio中显示结果
      await this.displayInStudio(result, taskRef);
      
      return result; // searchWithAllDetails已经返回JSON字符串
      
    } catch (error) {
      console.error('小红书Agent执行失败:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: '❌ 搜索失败'
      }, null, 2);
    }
  }
  

  // 搜索并获取所有详细信息（包括内容和评论）- 匹配Python版本格式
  private async searchWithAllDetails(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<any> {
    const searchQuery = query.query as string;
    const limit = (query.limit as number) || 10;
    
    if (!searchQuery) {
      throw new Error('搜索详情操作需要提供query参数');
    }
    
    const progressMessage = await taskRef.createMessage(`🔍 正在搜索并获取详情: "${searchQuery}"...`);
    taskRef.observer.next(progressMessage);
    
    try {
      // 如果启用Python后端，直接调用Python脚本
      if (this.USE_PYTHON_BACKEND) {
        console.log('使用Python后端获取小红书数据...');
        const result = await this.callPythonBackend(searchQuery, taskRef);
        return result;
      }
      
      // 否则使用TypeScript版本（可能失败）
      console.log('使用TypeScript版本获取小红书数据...');
      
      // 先验证Cookie是否有效
      console.log('验证Cookie有效性...');
      try {
        const meResponse = await this.xhsApi.get_me();
        console.log('get_me响应:', JSON.stringify(meResponse, null, 2));
        if (meResponse && meResponse.data) {
          console.log('✓ Cookie有效，用户信息:', meResponse.data);
        } else {
          console.warn('⚠ Cookie可能无效或已过期');
        }
      } catch (error) {
        console.error('✗ Cookie验证失败:', error);
      }
      
      // 先搜索笔记 - 使用简化搜索格式
      const searchResults = await this.performSimpleSearch(searchQuery, limit);
      
      if (searchResults.length === 0) {
        throw new Error('未找到相关笔记');
      }

      // 显示搜索结果列表
      await this.displaySearchResults(searchResults, taskRef);

      const allDetails = [];

      // 为每个笔记获取详细内容和评论
      for (let i = 0; i < searchResults.length; i++) {
        const note = searchResults[i];
        progressMessage.content = `📝 正在获取第 ${i + 1}/${searchResults.length} 篇笔记详情...`;
        taskRef.observer.next(progressMessage);

        try {
          // 获取笔记内容 - 返回简化格式
          const noteContent = await this.getSimpleNoteContent(note.url);
          
          // 获取评论 - 返回简化格式  
          const noteComments = await this.getSimpleNoteComments(note.url);

          allDetails.push({
            title: note.title,
            url: note.url,
            content: noteContent,
            comments: noteComments
          });

          // 添加延迟避免请求过快
          await this.delay(1000);

        } catch (error) {
          console.error(`获取详情失败: ${note.url}`, error);
          allDetails.push({
            title: note.title,
            url: note.url,
            content: [],
            comments: [],
            error: error instanceof Error ? error.message : '获取失败'
          });
        }
      }

      progressMessage.content = `✅ 完成! 获取了 ${allDetails.length} 篇笔记的详情`;
      taskRef.completeMessage(progressMessage);
      taskRef.observer.next(progressMessage);
      
      return JSON.stringify(allDetails, null, 2);
      
    } catch (error) {
      progressMessage.content = `❌ 搜索详情失败: ${error instanceof Error ? error.message : '未知错误'}`;
      taskRef.completeMessage(progressMessage);
      throw error;
    }
  }
  
  // 获取简化的笔记内容 - 匹配Python版本
  private async getSimpleNoteContent(noteUrl: string): Promise<XHSSimpleNote[]> {
    try {
      const { noteId, xsecToken } = this.extractNoteIdAndToken(noteUrl);
      
      if (!xsecToken) {
        throw new Error('URL缺少xsec_token参数');
      }

      const contentResponse = await this.xhsApi.getNoteContent(noteId, xsecToken);
      
      if (!contentResponse || !contentResponse.data || !contentResponse.data.items || !contentResponse.data.items.length) {
        return [];
      }

      const item = contentResponse.data.items[0];
      if (!item.note_card) {
        return [];
      }

      const noteCard = item.note_card;
      
      // 按照Python版本的逻辑提取图片
      let images: string[] = [];
      if (noteCard.image_list && noteCard.image_list.length > 0) {
        const imageInfoList = noteCard.image_list[0]?.info_list || [];
        images = imageInfoList
          .map((imgInfo: any) => imgInfo.url)
          .filter((url: string) => url);
      }

      return [{
        author: noteCard.user?.nickname || '未知用户',
        publish_time: noteCard.time ? new Date(noteCard.time).toISOString() : new Date().toISOString(),
        content: noteCard.desc || '',
        images: images
      }];
      
    } catch (error) {
      console.error('获取简化笔记内容失败:', error);
      return [];
    }
  }

  // 获取简化的评论 - 匹配Python版本
  private async getSimpleNoteComments(noteUrl: string): Promise<XHSSimpleComment[]> {
    try {
      const { noteId, xsecToken } = this.extractNoteIdAndToken(noteUrl);
      
      if (!xsecToken) {
        return [];
      }

      const commentsResponse = await this.xhsApi.getNoteComments(noteId, xsecToken);
      
      if (!commentsResponse || !commentsResponse.data || !commentsResponse.data.comments) {
        return [];
      }

      return commentsResponse.data.comments.map((comment: any) => ({
        author: comment.user_info?.nickname || '匿名用户',
        content: comment.content || '',
        create_time: comment.create_time ? new Date(comment.create_time).toISOString() : new Date().toISOString()
      }));
        
      } catch (error) {
      console.error('获取简化评论失败:', error);
      return [];
    }
  }
  
  // 简化搜索实现 - 匹配Python版本的search_notes格式
  private async performSimpleSearch(query: string, limit: number): Promise<XHSSimpleSearchResult[]> {
    try {
      // 使用XhsApi搜索笔记
      const searchResponse = await this.xhsApi.searchNotes(query, limit);
      
      // 添加调试日志
      console.log('搜索API响应:', JSON.stringify(searchResponse, null, 2));
      
      // 检查响应结构
      if (!searchResponse) {
        console.error('搜索响应为空');
        return [];
      }
      
      if (!searchResponse.data) {
        console.error('搜索响应缺少data字段:', searchResponse);
        return [];
      }
      
      if (!searchResponse.data.items) {
        console.error('搜索响应data缺少items字段:', searchResponse.data);
        return [];
      }
      
      if (searchResponse.data.items.length === 0) {
        console.warn('搜索响应items为空数组');
        return [];
      }

      const resList: XHSSimpleSearchResult[] = [];
      
      for (const item of searchResponse.data.items) {
        if (item.note_card && item.note_card.display_title) {
          const noteCard = item.note_card;
          const interactInfo = noteCard.interact_info || {};
          
          // 构造笔记URL - 匹配Python格式
          const url = `https://www.xiaohongshu.com/explore/${item.id}?xsec_token=${item.xsec_token}`;
          
          resList.push({
            title: noteCard.display_title,
            liked_count: interactInfo.liked_count || 0,
            url: url,
            note_id: item.id
          });
          
          console.log(`找到笔记: ${noteCard.display_title}`);
        }
      }
      
      console.log(`共找到 ${resList.length} 条笔记`);
      return resList;

    } catch (error) {
      console.error('搜索失败:', error);
      return [];
    }
  }
  
  
  // 从URL提取笔记ID和token
  private extractNoteIdAndToken(url: string): { noteId: string; xsecToken?: string } {
    try {
      const urlObj = new URL(url);
      const pathMatch = urlObj.pathname.match(/\/(explore|discovery\/item)\/([a-zA-Z0-9]+)/);
      const noteId = pathMatch ? pathMatch[2] : 'unknown';
      
      const xsecToken = urlObj.searchParams.get('xsec_token') || undefined;
      
      return { noteId, xsecToken };
    } catch (error) {
      console.error('解析URL失败:', error);
      return { noteId: 'unknown' };
    }
  }

  // 显示搜索结果列表
  private async displaySearchResults(searchResults: XHSSimpleSearchResult[], taskRef: AgentTaskRef) {
    // 创建简单的HTML渲染内容
    const htmlContent = this.createSearchResultsHTML(searchResults);
    
    await taskRef.studio.start(
      {
        type: 'htmlContent',
        payload: {
          content: htmlContent,
          title: '小红书搜索结果',
          timestamp: new Date().toISOString()
        },
        description: '小红书搜索结果列表'
      },
      taskRef.observer,
      taskRef.abortSignal
    );
  }

  // 创建搜索结果的HTML内容
  private createSearchResultsHTML(searchResults: XHSSimpleSearchResult[]): string {
    if (!Array.isArray(searchResults) || searchResults.length === 0) {
      return '<div style="padding: 20px; text-align: center; color: #666;">暂无搜索结果</div>';
    }

    const htmlItems = searchResults.map((item, index) => {
      const title = item.title || '无标题';
      const url = item.url || '';
      const likedCount = item.liked_count || 0;
      
      return `
        <div style="
          padding: 12px 16px;
          margin-bottom: 8px;
          border: 1px solid #e1e5e9;
          border-radius: 8px;
          background-color: #fafbfc;
          transition: background-color 0.2s;
        ">
          <div style="display: flex; align-items: flex-start; justify-content: space-between;">
            <div style="flex: 1;">
              <h4 style="
                margin: 0 0 8px 0;
                font-size: 16px;
                font-weight: 600;
                color: #1f2937;
                line-height: 1.4;
              ">${index + 1}. ${title}</h4>
              
              <div style="
                display: flex;
                gap: 12px;
                margin-bottom: 8px;
                font-size: 14px;
                color: #6b7280;
              ">
                <span>❤️ ${likedCount} 赞</span>
                <span>🆔 ${item.note_id}</span>
              </div>
              
              <a href="${url}" 
                 target="_blank"
                 style="
                   color: #3b82f6;
                   text-decoration: none;
                   font-size: 14px;
                   word-break: break-all;
                 ">
                🔗 ${url}
              </a>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
        background-color: white;
      ">
        <div style="
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 2px solid #e1e5e9;
        ">
          <h2 style="
            margin: 0;
            font-size: 24px;
            font-weight: 700;
            color: #1f2937;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            🔍 小红书搜索结果
            <span style="
              font-size: 16px;
              font-weight: 400;
              color: #6b7280;
              background-color: #f3f4f6;
              padding: 4px 8px;
              border-radius: 4px;
            ">${searchResults.length} 条</span>
          </h2>
        </div>
        
        <div style="margin-top: 16px;">
          ${htmlItems}
        </div>
        
        <div style="
          margin-top: 20px;
          text-align: center;
          font-size: 14px;
          color: #9ca3af;
        ">
          搜索时间: ${new Date().toLocaleString('zh-CN')}
        </div>
      </div>
    `;
  }
  
  // 在Studio中展示结果
  private async displayInStudio(data: any, taskRef: AgentTaskRef) {
    await taskRef.studio.start(
      {
        type: 'xiaohongshuContent',
        payload: {
          data: data,
          timestamp: new Date().toISOString()
        },
        description: '小红书内容提取结果'
      },
      taskRef.observer,
      taskRef.abortSignal
    );
  }
  
  
  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 调用Python后端获取小红书数据
   * @param keywords 搜索关键词
   * @param taskRef Agent任务引用
   * @returns JSON字符串格式的搜索结果
   */
  private async callPythonBackend(keywords: string, taskRef: AgentTaskRef): Promise<string> {
    try {
      // 构建Python脚本的路径
      // 在Tauri开发模式下，工作目录通常在src-tauri，需要返回上一级
      const scriptPath = '../src/apps/toolkits/XHS-toolkit/searchXHS.py';
      
      const progressMsg = await taskRef.createMessage('🐍 正在调用Python后端...');
      taskRef.observer.next(progressMsg);
      
      console.log('执行Python命令:', `python ${scriptPath} --action details --keywords "${keywords}"`);
      
      // 创建Python命令
      const command = Command.create('python', [
        scriptPath,
        '--action', 'details',
        '--keywords', keywords
      ]);
      
      // 执行命令并获取输出
      const output = await command.execute();
      
      console.log('Python脚本退出码:', output.code);
      console.log('Python脚本stdout:', output.stdout.substring(0, 500));
      console.log('Python脚本stderr:', output.stderr.substring(0, 500));
      
      if (output.code !== 0) {
        throw new Error(`Python脚本执行失败 (退出码: ${output.code})\n错误: ${output.stderr}`);
      }
      
      // 解析Python输出的JSON
      let result;
      try {
        result = JSON.parse(output.stdout);
      } catch (parseError) {
        console.error('解析Python输出失败:', parseError);
        console.error('原始输出:', output.stdout);
        throw new Error('解析Python脚本输出失败: ' + (parseError instanceof Error ? parseError.message : String(parseError)));
      }
      
      progressMsg.content = '✅ Python后端调用成功';
      taskRef.completeMessage(progressMsg);
      taskRef.observer.next(progressMsg);
      
      // 返回JSON字符串
      return JSON.stringify(result, null, 2);
      
    } catch (error) {
      console.error('Python后端调用失败:', error);
      throw new Error(`Python后端调用失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}