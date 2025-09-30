import { BaseAgent } from '../../agent/base-agent';
import type { AgentTaskRef } from '../../agent/type';
import type { SpecializedToolAgent } from '../types';
import { smartHttpRequest } from '../../../utils/tauriHttp';
import { lastValueFrom, defaultIfEmpty } from 'rxjs';

export class VideoAgent extends BaseAgent implements SpecializedToolAgent {
  override name = 'VideoSearchTool';

  description = '专业的视频搜索工具，支持从多个平台（包括爱奇艺、腾讯视频和优酷）搜索视频内容。当您需要查找视频、电影、电视剧、综艺节目等时，请优先使用此工具。该工具可从上述三个平台获取播放链接。';

  parameters = {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: '视频搜索关键词，可以是电影名称、电视剧名称、综艺节目名称、演员名称等。'
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
      let allVideos: any[] = [];
      let totalCount = 0;
      let pojieUrls = ['https://jx.xymp4.cc/?url=', 'https://jx.xmflv.com/?url=', 'https://www.8090g.cn/?url='];
      // 搜索所有平台
      const iqiyiResult = await this.callIqiyiAPI(keyword, page, pageSize);
      if (iqiyiResult.success) {
        const iqiyiVideos = iqiyiResult.data.videos || [];
        const formattedIqiyiVideos = iqiyiVideos.map((video: any, index: number) => ({
          index: allVideos.length + index + 1,
          title: video.title || '未知标题',
          number: video.number || '',
          duration: video.subscriptContent || '未知时长',
          playUrl: video.pageUrl || '',
          qipuId: video.qipuId || '',
          year: video.year || '',
          platform: '爱奇艺'
        }));
        allVideos = allVideos.concat(formattedIqiyiVideos);
        totalCount += iqiyiResult.data.total_count || 0;
      }

      const tengxunResult = await this.callTengxunAPI(keyword, page, pageSize);
      if (tengxunResult.success) {
        const tengxunVideos = tengxunResult.data.videos || [];
        const formattedTengxunVideos = tengxunVideos.map((video: any, index: number) => ({
          index: allVideos.length + index + 1,
          title: video.title || '未知标题',
          number: '',
          playUrl: video.url || '',
          qipuId: video.id || '',
          year: '',
          platform: '腾讯视频',
          checkUpTime: video.checkUpTime || '',
          payStatus: video.payStatus || ''
        }));
        allVideos = allVideos.concat(formattedTengxunVideos);
        totalCount += tengxunResult.data.total_count || 0;
      }

      const youkuResult = await this.callYoukuAPI(keyword, page, pageSize);
      if (youkuResult.success) {
        const youkuVideos = youkuResult.data.videos || [];
        const formattedYoukuVideos = youkuVideos.map((video: any, index: number) => ({
          index: allVideos.length + index + 1,
          title: video.title || '未知标题',
          number: video.order_id || '',
          playUrl: video.complete_url || video.url || '',
          qipuId: video.video_id || '',
          year: '',
          platform: '优酷',
          showVideoStage: video.show_video_stage || '',
          vid: video.vid || ''
        }));
        allVideos = allVideos.concat(formattedYoukuVideos);
        totalCount += youkuResult.data.total_count || 0;
      }

      // 在Studio中显示搜索结果（即使没有结果也要显示）
      await taskRef.studio.start(
        {
          type: 'videoSearch',
          payload: {
            keyword: keyword,
            videos: allVideos
          },
          description: `视频搜索结果 - ${keyword}`,
        },
        taskRef.observer,
        taskRef.abortSignal,
      );
      
      console.log('视频搜索结果:', allVideos);

      // 如果没有找到任何视频，返回友好的提示信息而不是抛出错误
      if (allVideos.length === 0) {
        return JSON.stringify({
          success: false,
          keyword: keyword,
          videos: [],
          videoCount: 0,
          message: `抱歉，没有找到与"${keyword}"相关的视频内容。建议：1) 尝试使用不同的关键词；2) 检查关键词拼写；3) 尝试搜索更通用的词汇。`,
        }, null, 2);
      }

      const completedMessage = await taskRef.createMessage('Video Search Tool');
      
      // 创建破解链接数组
      const pojieVideos = allVideos.map((video: any) => {
        const playUrl = video.playUrl || '暂无播放链接';
        const pojieLinks: string[] = [];
        
        // 为每个视频生成破解链接
        if (playUrl !== '暂无播放链接' && pojieUrls.length > 0) {
          pojieUrls.forEach((pojieUrl: string) => {
            pojieLinks.push(`${pojieUrl}${playUrl}`);
          });
        }
        
        return pojieLinks;
      });
      
      
      // 创建消息内容，直接包含 subtaskId
      const completedContent: any = {
        type: 'video_search',
        toolName: this.name,
        status: 'completed',
        result: {allVideos, pojieVideos},
        timestamp: Date.now()
      };
      
      // 直接添加 subtaskId 到消息内容中
      if (taskRef.subtaskId !== undefined) {
        completedContent.subtaskId = taskRef.subtaskId;
      }
      
      completedMessage.content = JSON.stringify(completedContent);
      taskRef.observer.next(completedMessage);
      // 调用AI生成搜索结果总结
      const aiSummary = await this.generateBasicSummary({
        keyword: keyword,
        videos: allVideos,
        pojieUrls: pojieUrls
      });

      return JSON.stringify({
        success: true,
        keyword: keyword,
        summary: aiSummary,
        message: `视频搜索完成！找到 ${allVideos.length} 个视频结果！\n\n${aiSummary}`,
      }, null, 2);

    } catch (error) {
      throw new Error(`搜索视频失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  private async callTengxunAPI(keyword: string, page: number, pageSize: number): Promise<any> {
    try {
      // 腾讯视频搜索API的URL
      const url = 'https://pbaccess.video.qq.com/trpc.videosearch.mobile_search.MultiTerminalSearch/MbSearch';
      
      // 构建请求参数
      const params = new URLSearchParams({
        'vversion_platform': '2'
      });

      // 构建请求头
      const headers = {
        'accept': 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9',
        'content-type': 'application/json',
        'h38': 'fded77a30a973d5ede684f1b0200000b718b15',
        'h42': '18b150d2632100aa0a973d5ede684f1bf0fe668265',
        'origin': 'https://v.qq.com',
        'priority': 'u=1, i',
        'referer': 'https://v.qq.com/',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'trpc-trans-info': '{"trpc-env":""}',
        'uk': 'DCAxFeb05pDmvvCtOP3B8IOqDrUH5%2F8iba2rGpMQCKc1fiNs1bNqc1%2B25lCq2WNwYweR85Vp52Gy%0Az%2FekG7RB%2FIP9X6VZ5dQlbb%2B0NTLADfOmdXb1gdK3exw%2F4xQ3sXJ1HwkA%2BP%2Fq4pDwudOpN8OQywRr%0ASr1Ym%2BzqJLusRlJWGNPmVsLj%2F%2Bf1D1hojxEiy3bmbT7E5kfh%2F1Dpud73OyRZ8qinA%2FSL5dG3eo2y%0AGl%2FTWN85LCLs1%2BTjeBo%2B4TQ7jWNoYwsB5kf05hyI8bjuXHRTzwGwV%2BKR8MGxfLV2PArGT%2F8lORJt%0AlrTnYI%2Bz%2BSY0tWN7YwsLkkxl5wZyvdY1POFRnwCzWrpK4bc2M%2BvsOl2FD%2FeldsMp1MBjdpw45AYn%0A03BxYweR5nJ05qR7zfepKcPQ7UOqCvwf4%2BziZL%2F4GlTHQ%2FtsORJwlfTnYJwl8xY003r1bT7D8G%2Fy%0A7U8rufmpP7RB%2FIO%2FJ%2BKN5NF5fMI6c1aBALY3Nt%2Fhl%2BJtdI%2Bl8xY803r2bT7D%2BZ%2Fy4p47rMWpN7DP%0A4JHyEfoPos%3D%3D',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      };

      // 构建cookies
      const cookies = [
        'pac_uid=0_FYf11CdRkYC0i',
        '_qimei_uuid42=18b150d2632100aa0a973d5ede684f1bf0fe668265',
        '_qimei_fingerprint=28f4654e9e63a130f9b66b703fbf0aa0',
        '_qimei_h38=fded77a30a973d5ede684f1b0200000b718b15',
        'RK=EwGI0QMXFL',
        'ptcz=a5c07be3f59e698fe029994708bf653e760ce71ac55ccfed9fa630ba0919f1a7',
        '_qimei_q32=688c3e14e68f459ec380c82f9c7aaad5',
        '_qimei_q36=32c1f79ff976d6e3c0b1b77e300014b18c03',
        'Qs_lvt_323937=1747707782',
        'Qs_pv_323937=1942556717155176000',
        'qq_domain_video_guid_verify=ebe18e106c1cdc48',
        'video_platform=2',
        'video_guid=ebe18e106c1cdc48',
        'pgv_pvid=5700513295',
        '_qimei_i_3=6cf16f82935c53d8c792f9655fd670e2f1b8f6a4410e0080e78b7b0e7497256a686761943989e2ad9eb2',
        'pgv_info=ssid=s9274326425',
        'QIMEI32=688c3e14e68f459ec380c82f9c7aaad5',
        'QIMEI36=32c1f79ff976d6e3c0b1b77e300014b18c03',
        'vdevice_qimei36=32c1f79ff976d6e3c0b1b77e300014b18c03',
        '_qimei_i_2=2dfd49819709518dc69ea866528375b4f1bba7a2120902d0b3887d5b2693206d6531369d6b89e1aab588',
        '_qimei_i_1=7cd369d4c10f04dcc6c6fd300a8d74e3a3ebf1a5475d0b86e28e7a582493206c616365923981b0ddd3a6e3df'
      ].join('; ');

      // 构建请求体
      const requestBody = {
        'version': '25082501',
        'clientType': 1,
        'filterValue': '',
        'uuid': 'A2EA4A36-2552-48A1-83F0-7FE260FA5925',
        'retry': 0,
        'query': keyword,
        'pagenum': page - 1, // 腾讯视频的页码从0开始
        'isPrefetch': true,
        'pagesize': pageSize,
        'queryFrom': 110,
        'searchDatakey': '',
        'transInfo': '',
        'isneedQc': true,
        'preQid': '',
        'adClientInfo': '',
        'extraInfo': {
          'isNewMarkLabel': '1',
          'multi_terminal_pc': '1',
          'themeType': '1',
          'sugRelatedIds': '{}',
          'appVersion': ''
        }
      };

      // 发送HTTP请求
      const response = await smartHttpRequest({
        url: `${url}?${params.toString()}`,
        method: 'POST',
        headers: {
          ...headers,
          'cookie': cookies
        },
        body: JSON.stringify(requestBody)
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP请求失败: ${response.status}`);
      }

      const data = JSON.parse(response.body);
      
      // 提取视频信息
      let videos: any[] = [];
      let totalCount = 0;
      
      if (data.data && data.data.areaBoxList && data.data.areaBoxList.length > 0) {
        const firstArea = data.data.areaBoxList[0];
        if (firstArea.itemList && firstArea.itemList.length > 0) {
          const firstItem = firstArea.itemList[0];
          // console.log('firstItem', firstItem);
          if (firstItem.videoInfo && firstItem.videoInfo.episodeSites && firstItem.videoInfo.episodeSites.length > 0) {
            const episodeList = firstItem.videoInfo.episodeSites[0].episodeInfoList || [];
            
              videos = episodeList.map((episode: any) => ({
                title: (keyword + ' ' + (episode.title || '未知标题')).trim(),
                url: episode.url || '',
                img: episode.imgUrl || '',
              duration: episode.duration || '未知时长',
              id: episode.id || '',
              checkUpTime: episode.checkUpTime || '',
              videoAspectRatio: episode.videoAspectRatio || '',
              payStatus: episode.payStatus || ''
            }));
            
            totalCount = videos.length;
          }

          if (firstItem.videoInfo && firstItem.videoInfo.playSites && firstItem.videoInfo.playSites.length > 0) {
            const episodeList = firstItem.videoInfo.playSites[0].episodeInfoList || [];
            
              videos = episodeList.map((episode: any) => ({
                title: (keyword + ' ' + (episode.title || '未知标题')).trim(),
                url: episode.url || '',
                img: episode.imgUrl || '',
              duration: episode.duration || '未知时长',
              id: episode.id || '',
              checkUpTime: episode.checkUpTime || '',
              videoAspectRatio: episode.videoAspectRatio || '',
              payStatus: episode.payStatus || ''
            }));
            
            totalCount = videos.length;
          }
          

          
        }
        
      }
      if(data.data && data.data.normalList){
        const firstAreaNomalList = data.data.normalList;
        if (firstAreaNomalList.itemList && firstAreaNomalList.itemList.length > 0) {
          const firstItem = firstAreaNomalList.itemList[0];
          if (firstItem.videoInfo && firstItem.videoInfo.playSites && firstItem.videoInfo.playSites.length > 0) {
            const episodeList = firstItem.videoInfo.playSites[0].episodeInfoList || [];
              console.log('episodeList', episodeList);
              videos = episodeList.map((episode: any) => ({
                title: (keyword + ' ' + (episode.title || '未知标题')).trim(),
                url: episode.url || '',
                img: episode.imgUrl || '',
              duration: episode.duration || '未知时长',
              id: episode.id || '',
              checkUpTime: episode.checkUpTime || '',
              videoAspectRatio: episode.videoAspectRatio || '',
              payStatus: episode.payStatus || ''
            }));
            
            totalCount = videos.length;
          }
        }
      }

      return {
        success: true,
        data: {
          videos: videos,
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

  private async callYoukuAPI(keyword: string, page: number, pageSize: number): Promise<any> {
    try {
      // 优酷搜索API的URL (目前优酷搜索不支持分页，但保留参数以备将来使用)
      const url = 'https://so.youku.com/search/q_' + encodeURIComponent(keyword);
      
      // 构建请求头
      const headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9',
        'cache-control': 'max-age=0',
        'priority': 'u=0, i',
        'referer': 'https://so.youku.com/',
        'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      };

      // 构建cookies
      const cookies = [
        'cna=RmBMIOf6qTECAbeBVdIDOot8',
        'isI18n=false',
        '__ysuid=1758098107431aix',
        '__ayft=1758098107432',
        '__aysid=1758098107432QJZ',
        '__ayscnt=1',
        'xlly_s=1',
        'ctoken=cMaNC8cMjroLawsEOBB1ih3F',
        'HISTORY_KEY=%5B%22%E7%81%BC%E7%81%BC%E9%9F%B5%E5%8D%8E%22%2C%22%E6%B2%A7%E5%85%83%E5%9B%BE%22%5D',
        'login_index=3_1758102152763',
        '__arpvid=1758102184710OGvBBs-1758102184723',
        '__aypstp=12',
        '__ayspstp=12',
        'mtop_partitioned_detect=1',
        '_m_h5_tk=8fad4e62d455a2f3b4ee754851795ec5_1758107310488',
        '_m_h5_tk_enc=30d45649ae66f8dfc4b193eab54a0819',
        'isg=BNvb7z1mN6haw0vcz4WZVQjWaj9FsO-yCc3O5M0Yt1rxrPuOVYB_AvlvQgwijEeq',
        'tfstk=gypo0_cHAQ5SsIe7ZDXSwC1ocqcxgT6CbeedJ9QEgZ7b96PReJuHXZpRy3BzTEKezaURUQIHkQ9vvg_eVXXfYKqpy6-5hKSAkeep2eEWGFKaeLh5pJX5d9utWAHTV36CLgl25D_W0nsEDgPqoI9Gd9utkSeFNAXBzh90F6-qmMIC8W8ULx-VlMFP8e7PgrSGf97e8e7V3GshYyPPYi5VlMWF8eWEmn7fx97e89oD0bnuLNvehKueHacoHn09Kgfl737y23pV4PQw4Z2ULajlZl-PoJyenBVB6x7r1oQCeatPqeM_FT5H1HIHrY2y-h9Xoi8ZKRQychdONLk_O1XPl6vPIkkymTbl_LC44J8wmHROiKnZCTXPzBBWvl0JmLYJVKxLYSWleIfMEOk_zwdvjpjHd2MDSh9Xoi8ZK4SPvSPZH3eC0Dp4OW1Pcib9iCRvsl4QHFnmm5G5ais-Wmm0OW1PcibtmmV_R_Sf2VC..',
        '__ayvstp=45',
        '__aysvstp=45'
      ].join('; ');

      // 发送HTTP请求
      const response = await smartHttpRequest({
        url: url,
        method: 'GET',
        headers: {
          ...headers,
          'cookie': cookies
        }
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP请求失败: ${response.status}`);
      }

      const htmlContent = response.body;
      
      // 从HTML中提取window.__INITIAL_DATA__
      const initialDataMatch = htmlContent.match(/window\.__INITIAL_DATA__\s*=\s*({.*?});/s);
      if (!initialDataMatch) {
        throw new Error('无法从HTML中提取初始数据');
      }

      let initialData;
      try {
        initialData = JSON.parse(initialDataMatch[1]);
      } catch (parseError) {
        throw new Error(`解析初始数据失败: ${parseError}`);
      }

      // 提取视频信息
      let videos: any[] = [];
      let totalCount = 0;
      
      if (initialData.data && initialData.data.nodes) {
        videos = this.extractVideosFromNodes(initialData.data.nodes);
        totalCount = videos.length;
        
        // 应用分页逻辑 (虽然优酷搜索本身不支持分页，但我们可以在这里实现)
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        videos = videos.slice(startIndex, endIndex);
      }

      return {
        success: true,
        data: {
          videos: videos,
          total_count: totalCount,
          raw_response: initialData
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

  private extractVideosFromNodes(nodes: any[]): any[] {
    const videos: any[] = [];
    
    const traverseNodes = (nodeList: any[]) => {
      if (!Array.isArray(nodeList)) return;
      
      for (const node of nodeList) {
        if (node && typeof node === 'object') {
          // 检查是否有视频数据
          if (node.data && typeof node.data === 'object') {
            const nodeData = node.data;
            
            // 查找videoId和title
            if (nodeData.videoId && nodeData.title) {
              const videoId = nodeData.videoId;
              const title = nodeData.title;
              
              // 解码base64视频ID
              let decodedId = videoId;
              try {
                const buffer = Buffer.from(videoId, 'base64');
                decodedId = buffer.toString('utf-8');
              } catch (e) {
                // 如果解码失败，使用原始ID
                decodedId = videoId;
              }
              
              // 构建完整URL
              const completeUrl = `https://v.youku.com/v_show/id_${decodedId}`;
              
              videos.push({
                title: title,
                video_id: videoId,
                decoded_id: decodedId,
                complete_url: completeUrl,
                thumb_url: nodeData.thumbUrl || '',
                duration_seconds: nodeData.seconds || '',
                order_id: nodeData.orderId || '',
                show_video_stage: nodeData.showVideoStage || '',
                vid: nodeData.vid || ''
              });
            }
          }
          
          // 递归检查嵌套节点
          if (node.nodes) {
            traverseNodes(node.nodes);
          }
        }
      }
    };
    
    traverseNodes(nodes);
    return videos;
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
      const response = await smartHttpRequest({
        url: `${url}?${params.toString()}`,
        method: 'GET',
        headers: {
          ...headers,
          'cookie': cookies
        }
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP请求失败: ${response.status}`);
      }

      const data = JSON.parse(response.body);
      
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

  /**
   * 使用AI生成视频搜索结果的智能总结
   * @param searchData 搜索结果数据
   * @param taskRef 任务引用
   * @returns 生成的总结内容
   */
  private async generateWithAI(searchData: any, taskRef: AgentTaskRef): Promise<string> {
    // 设置系统消息
    this.initialSystemMessage(`你是一个专业的视频内容分析师和播放链接整理专家。你需要根据提供的视频搜索结果，生成一个完整且实用的总结分析。

核心要求：
1. 必须返回所有视频的完整播放链接列表，格式如下：
   序号. 标题 - 平台
   观看链接：原始链接
   破解链接1：破解前缀1 + 原始链接
   破解链接2：破解前缀2 + 原始链接
   破解链接3：破解前缀3 + 原始链接
   
   每个视频都要显示原始观看链接和所有可用的破解链接
2. 对搜索结果进行智能分类整理（电影、电视剧、综艺、纪录片等）
3. 分析平台分布情况，突出推荐优质内容
4. 如果有多个平台的相同内容，进行对比说明
5. 提供观看建议和注意事项
6. 语言简洁明了，重点突出
7. 返回格式要包含：总结分析 + 完整播放链接清单
8. 所有破解链接都可以直接观看
9. 链接格式要简洁，直接显示URL，不要使用Markdown链接格式`);

    try {
      // 构建详细的视频列表，包含完整播放链接和破解链接
      const videoListWithLinks = searchData.videos.map((video: any, index: number) => {
        const playUrl = video.playUrl || '暂无播放链接';
        const pojieUrls = searchData.pojieUrls || [];
        
        let linkInfo = `${index + 1}. 【${video.platform}】${video.title}
   - 时长: ${video.duration || '未知'}
   - 年份: ${video.year || '未知'}
   - 观看链接: ${playUrl}`;
        
        if (playUrl !== '暂无播放链接' && pojieUrls.length > 0) {
          linkInfo += '\n   - 破解链接:';
          pojieUrls.forEach((pojieUrl: string, linkIndex: number) => {
            linkInfo += `\n     ${linkIndex + 1}. ${pojieUrl}${playUrl}`;
          });
        }
        
        return linkInfo;
      }).join('\n\n');

      const prompt = `请分析以下视频搜索结果并生成完整的总结分析：

搜索关键词: "${searchData.keyword}"
搜索平台: 全平台（爱奇艺、腾讯视频、优酷）
找到视频总数: ${searchData.videos.length}

详细视频信息及播放链接:
${videoListWithLinks}

请按要求生成专业的总结分析，务必包含所有播放链接的完整清单！`;

      // 调用AI生成总结
      const completion = await this.run(prompt, taskRef);
      if (!completion) {
        throw new Error('AI生成失败');
      }

      // 获取生成的内容
      const summary = await lastValueFrom(
        completion.contentStream.pipe(defaultIfEmpty(''))
      );

      if (!summary.trim()) {
        throw new Error('AI生成的总结内容为空');
      }

      return summary.trim();
    } catch (error) {
      console.error('AI生成搜索总结失败:', error);
      // 如果AI生成失败，返回基本的统计信息
      return this.generateBasicSummary(searchData);
    }
  }

  /**
   * 生成基本的搜索结果总结（AI失败时的备用方案）
   * @param searchData 搜索结果数据
   * @returns 基本总结内容
   */
  private generateBasicSummary(searchData: any): string {
    const { keyword, videos } = searchData;
    
    let summary = `🔍 搜索"${keyword}"共找到 ${videos.length} 个视频结果\n\n`;
    
    // 平台分布统计
    const platformStats: { [key: string]: number } = {};
    videos.forEach((video: any) => {
      platformStats[video.platform] = (platformStats[video.platform] || 0) + 1;
    });
    
    if (Object.keys(platformStats).length > 1) {
      summary += '📊 平台分布：\n';
      Object.entries(platformStats).forEach(([platform, count]) => {
        summary += `• ${platform}: ${count} 个视频\n`;
      });
      summary += '\n';
    }
    
    // 完整播放链接列表
    if (videos.length > 0) {
      summary += '🎬 完整播放链接列表：\n\n';
      videos.forEach((video: any, index: number) => {
        const playUrl = video.playUrl || '暂无播放链接';
        summary += `${index + 1}. ${video.title} - ${video.platform}\n`;
        summary += `   观看链接：${playUrl}\n`;
        
        // 添加破解链接
        if (playUrl !== '暂无播放链接' && searchData.pojieUrls && searchData.pojieUrls.length > 0) {
          summary += `   破解链接：\n`;
          searchData.pojieUrls.forEach((pojieUrl: string, linkIndex: number) => {
            summary += `     ${linkIndex + 1}. ${pojieUrl}${playUrl}\n`;
          });
        }
        
        if (video.duration) {
          summary += `   时长：${video.duration}\n`;
        }
        summary += '\n';
      });
    }
    
    summary += '💡 提示：已完成爱奇艺、腾讯视频、优酷的搜索,已经全部展示所有视频。所有的破解链接已经过破解处理，可以直接点击观看。';
    
    return summary;
  }
}
