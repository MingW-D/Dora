import { BaseAgent } from '../../agent/base-agent';
import type { AgentTaskRef } from '../../agent/type';
import type { SpecializedToolAgent } from '../types';

export class VideoAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'VideoSearchTool';

  description = 'Professional video search tool that supports searching video content from platforms like iQiyi. When you need to find videos, movies, TV series, variety shows, etc., prioritize using this tool. Can obtain detailed video information including titles, play links, cover images, duration, etc.';

  parameters = {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'Video search keywords, can be movie names, TV series names, variety show names, actor names, etc.'
      },
      page: {
        type: 'number',
        description: 'Search result page number for pagination browsing (default 1)',
        default: 1
      },
      pageSize: {
        type: 'number',
        description: 'Number of videos returned per page, recommended between 5-25 (default 25)',
        default: 25
      }
    },
    required: ['keyword'],
  };

  strict = true;

  async execute(query: Record<string, unknown>, taskRef: AgentTaskRef): Promise<string> {
    const keyword = query.keyword as string;
    const page = (query.page as number) || 1;
    const pageSize = (query.pageSize as number) || 25;

    try {
      return await this.searchVideos(keyword, page, pageSize, taskRef);
    } catch (error) {
      console.error('视频搜索失败:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: '❌ 视频搜索失败'
      }, null, 2);
    }
  }

  private async searchVideos(keyword: string, page: number, pageSize: number, taskRef: AgentTaskRef): Promise<string> {
    if (!keyword) {
      throw new Error('搜索关键词不能为空');
    }

    try {
      // 直接调用爱奇艺API进行搜索
      const result = await this.callIqiyiAPI(keyword, page, pageSize);
      
      if (!result.success) {
        throw new Error(result.error || '搜索失败');
      }

      const searchData = result.data;
      const videos = searchData.videos || [];
      const albumInfo = searchData.album_info || {};

      // 格式化搜索结果
      const formattedVideos = videos.map((video: any, index: number) => ({
        index: index + 1,
        title: video.title || '未知标题',
        number: video.number || '',
        duration: video.subscriptContent || '未知时长',
        playUrl: video.pageUrl || '',
        cover: video.img || '',
        qipuId: video.qipuId || '',
        year: video.year || ''
      }));

      // 在Studio中显示搜索结果
      await taskRef.studio.start(
        {
          type: 'videoSearch',
          payload: {
            keyword: keyword,
            videos: formattedVideos,
            totalCount: searchData.total_count || 0,
            page: page,
            pageSize: pageSize
          },
          description: `视频搜索结果 - ${keyword}`,
        },
        taskRef.observer,
        taskRef.abortSignal,
      );

      const successMessage = [
        '🎬 视频搜索完成！',
        `• 搜索关键词：${keyword}`,
        `• 找到视频：${formattedVideos.length} 个`,
        `• 专辑信息：${albumInfo.title || '未知'}`,
        `• 搜索时间：${new Date().toLocaleString('zh-CN')}`,
        '',
      ].join('\n');

      const messageModel = await taskRef.createMessage(successMessage);
      
      // 添加搜索结果内容块
      const searchResultBlock = {
        type: 'videoSearch',
        content: {
          keyword: keyword,
          videos: formattedVideos,
          totalCount: searchData.total_count || 0,
          timestamp: new Date().toLocaleString('zh-CN')
        },
        timestamp: Date.now()
      };
      
      // 将搜索结果块添加到消息内容中
      try {
        const existingContent = JSON.parse(messageModel.content || '[]');
        const updatedContent = Array.isArray(existingContent) ? existingContent : [];
        updatedContent.push(searchResultBlock);
        messageModel.content = JSON.stringify(updatedContent);
      } catch {
        // 如果解析失败，创建新的内容块数组
        messageModel.content = JSON.stringify([{
          type: 'text',
          content: successMessage,
          timestamp: Date.now()
        }, searchResultBlock]);
      }
      
      taskRef.completeMessage(messageModel);
      taskRef.observer.next(messageModel);

      return JSON.stringify({
        success: true,
        keyword: keyword,
        videoCount: formattedVideos.length,
        albumInfo: albumInfo,
        message: '✅ 视频搜索完成',
        instructions: '📊 搜索结果已在Studio面板中显示，可查看视频列表和详细信息',
        previewMode: 'studio'
      }, null, 2);

    } catch (error) {
      throw new Error(`搜索视频失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  private async callIqiyiAPI(keyword: string, page: number, pageSize: number): Promise<any> {
    try {
      // 爱奇艺搜索API的URL和参数
      const url = 'https://mesh.if.iqiyi.com/portal/lw/search/homePageV3';
      
      // 构建请求参数
      const params = new URLSearchParams({
        'key': keyword,
        'current_page': page.toString(),
        'mode': '1',
        'source': 'default',
        'suggest': '1_6007921387195201_0_0_0',
        'pcv': '13.092.23164',
        'version': '13.092.23164',
        'pageNum': page.toString(),
        'pageSize': pageSize.toString(),
        'pu': '',
        'u': '214f40f4191b27b5fdf41feb5059b497',
        'scale': '100',
        'token': '',
        'userVip': '0',
        'conduit': '',
        'vipType': '-1',
        'os': '',
        'osShortName': 'win10',
        'dataType': '',
        'appMode': '',
        'ad': '{"lm":3,"azd":1000000000951,"azt":733,"position":"feed"}',
        'adExt': '{"r":"2.3.5-ares6-pure"}',
      });

      // 构建请求头
      const headers = {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'origin': 'https://www.iqiyi.com',
        'priority': 'u=1, i',
        'referer': 'https://www.iqiyi.com/',
        'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      };

      // 构建cookies
      const cookies = [
        'QC005=214f40f4191b27b5fdf41feb5059b497',
        'T00404=8ae7ca20259184ae78d363401cdb74c7',
        'QC234=84fe6d2d9905ba6d09ab175af0a634d9',
        'QC006=b5d0767cc18b699ee79894a4450ec1f2',
        'PD005=hliiwumxcgsactpfc37tbleyvt93ii2y',
        'QP0042={"v":2,"avc":{"de":2,"wv":1},"hvc":{"de":2,"wv":0},"av1":{"de":1,"wv":1}}',
        'P00004=.1753145933.46b6d3b6d8',
        'QP007=840',
        'QP0035=4',
        '__dfp=a0e9a5640029064069866f4eb730584e64f9413a38f1eb2c858fe776d94c798e21@1754386954332@1753090955332',
        'QC008=Muc61dCJCPP6hUei',
        'QC007=https%3A%2F%2Fwww.baidu.com%2Flink%3Furl%3D3kcsnrS_UyFAqgksOUOed7En0X9Ep-A6bnCeserJ-IO%26wd%3D%26eqid%3D9154ddf50001ab870000000468c3e45c',
        'QP0037=0',
        'IMS=IggQABj_hpHGBiorCiBhOTJkY2EyNmRmZTc0NjQzYWNjNDcwMjc5ZWY4MjUyMxAAIgAo6AIwBXIkCiBhOTJkY2EyNmRmZTc0NjQzYWNjNDcwMjc5ZWY4MjUyMxAAggEEIgIQB4oBJAoiCiBhOTJkY2EyNmRmZTc0NjQzYWNjNDcwMjc5ZWY4MjUyMw',
        'curDeviceState=width%3D528%3BconduitId%3D%3Bscale%3D100%3Bbrightness%3Ddark%3BisLowPerformPC%3D0%3Bos%3Dbrowser%3Bosv%3D10.0.19044'
      ].join('; ');

      // 发送HTTP请求
      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'GET',
        headers: {
          ...headers,
          'cookie': cookies
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // 提取videos信息
      let videos: any[] = [];
      let albumInfo: any = {};
      let totalCount = 0;
      
      if (data.data && data.data.templates) {
        for (const template of data.data.templates.slice(0, 1)) { // 只处理第一个模板
          if (template.albumInfo) {
            albumInfo = template.albumInfo;
            if (template.albumInfo.videos) {
              videos = template.albumInfo.videos;
              totalCount = template.albumInfo.videos.length;
            }
          }
        }
      }

      return {
        success: true,
        data: {
          videos: videos,
          album_info: albumInfo,
          total_count: totalCount,
          raw_response: data
        },
        error: null
      };

    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
