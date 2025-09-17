import requests
import json
from typing import List, Dict, Optional, Any

# 默认配置
DEFAULT_COOKIES = {
    'QC005': '214f40f4191b27b5fdf41feb5059b497',
    'T00404': '8ae7ca20259184ae78d363401cdb74c7',
    'QC234': '84fe6d2d9905ba6d09ab175af0a634d9',
    'QC006': 'b5d0767cc18b699ee79894a4450ec1f2',
    'PD005': 'hliiwumxcgsactpfc37tbleyvt93ii2y',
    'QP0042': '{"v":2,"avc":{"de":2,"wv":1},"hvc":{"de":2,"wv":0},"av1":{"de":1,"wv":1}}',
    'P00004': '.1753145933.46b6d3b6d8',
    'QP007': '840',
    'QP0035': '4',
    '__dfp': 'a0e9a5640029064069866f4eb730584e64f9413a38f1eb2c858fe776d94c798e21@1754386954332@1753090955332',
    'QC008': 'Muc61dCJCPP6hUei',
    'QC007': 'https%3A%2F%2Fwww.baidu.com%2Flink%3Furl%3D3kcsnrS_UyFAqgksOUOed7En0X9Ep-A6bnCeserJ-IO%26wd%3D%26eqid%3D9154ddf50001ab870000000468c3e45c',
    'QP0037': '0',
    'IMS': 'IggQABj_hpHGBiorCiBhOTJkY2EyNmRmZTc0NjQzYWNjNDcwMjc5ZWY4MjUyMxAAIgAo6AIwBXIkCiBhOTJkY2EyNmRmZTc0NjQzYWNjNDcwMjc5ZWY4MjUyMxAAggEEIgIQB4oBJAoiCiBhOTJkY2EyNmRmZTc0NjQzYWNjNDcwMjc5ZWY4MjUyMw',
    'curDeviceState': 'width%3D528%3BconduitId%3D%3Bscale%3D100%3Bbrightness%3Ddark%3BisLowPerformPC%3D0%3Bos%3Dbrowser%3Bosv%3D10.0.19044',
}

DEFAULT_HEADERS = {
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
}

DEFAULT_BASE_PARAMS = {
    'mode': '1',
    'source': 'default',
    'pcv': '13.092.23164',
    'version': '13.092.23164',
    'pageSize': '25',
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
}


def search_iqiyi_videos(
    keyword: str,
    page: int = 1,
    page_size: int = 25,
    cookies: Optional[Dict[str, str]] = None,
    headers: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    搜索爱奇艺视频并提取videos信息
    
    Args:
        keyword (str): 搜索关键词
        page (int): 页码，默认为1
        page_size (int): 每页数量，默认为25
        cookies (Optional[Dict[str, str]]): 自定义cookies，默认使用内置配置
        headers (Optional[Dict[str, str]]): 自定义headers，默认使用内置配置
    
    Returns:
        Dict[str, Any]: 包含搜索结果的字典，格式如下：
        {
            "success": bool,
            "data": {
                "album_info": dict,  # 专辑信息
                "videos": list,      # 视频列表
                "total_count": int   # 总数量
            },
            "error": str  # 错误信息（如果有）
        }
    """
    try:
        # 使用默认配置或自定义配置
        search_cookies = cookies or DEFAULT_COOKIES
        search_headers = headers or DEFAULT_HEADERS
        
        # 构建请求参数
        params = DEFAULT_BASE_PARAMS.copy()
        params.update({
            'key': keyword,
            'current_page': str(page),
            'pageNum': str(page),
            'pageSize': str(page_size),
            'suggest': f'1_6007921387195201_0_0_0',  # 这个可能需要根据实际搜索动态调整
        })
        
        # 发送请求
        response = requests.get(
            'https://mesh.if.iqiyi.com/portal/lw/search/homePageV3',
            params=params,
            cookies=search_cookies,
            headers=search_headers,
            timeout=10
        )
        
        # 检查响应状态
        response.raise_for_status()
        
        # 解析JSON响应
        data = response.json()
        
        # 提取videos信息
        videos = []
        album_info = {}
        total_count = 0
        
        if 'data' in data and 'templates' in data['data']:
            for template in data['data']['templates'][:1]:
                if 'albumInfo' in template:
                    album_info = template['albumInfo']
                    if 'videos' in album_info:
                        videos.extend(album_info['videos'])
                        total_count = len(album_info['videos'])
        
        return {
            "success": True,
            "data": {
                "album_info": album_info,
                "videos": videos,
                "total_count": total_count,
                "raw_response": data  # 保留原始响应数据
            },
            "error": None
        }
        
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "data": None,
            "error": f"请求错误: {str(e)}"
        }
    except json.JSONDecodeError as e:
        return {
            "success": False,
            "data": None,
            "error": f"JSON解析错误: {str(e)}"
        }
    except Exception as e:
        return {
            "success": False,
            "data": None,
            "error": f"未知错误: {str(e)}"
        }


def extract_video_info(video_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    从单个视频数据中提取关键信息
    
    Args:
        video_data (Dict[str, Any]): 视频数据字典
    
    Returns:
        Dict[str, Any]: 提取的关键信息
    """
    return {
        "title": video_data.get("title", ""),
        "number": video_data.get("number", ""),
        "qipu_id": video_data.get("qipuId", ""),
        "play_url": video_data.get("playUrl", ""),
        "page_url": video_data.get("pageUrl", ""),
        "subtitle": video_data.get("subtitle", ""),
        "duration": video_data.get("duration", 0),
        "subscript_content": video_data.get("subscriptContent", ""),
        "img": video_data.get("img", ""),
        "year": video_data.get("year", ""),
        "pay_mark_url": video_data.get("payMarkUrl", "")
    }


# 示例使用
if __name__ == "__main__":
    import sys
    
    # 检查命令行参数
    if len(sys.argv) >= 2:
        keyword = sys.argv[1]
        page = int(sys.argv[2]) if len(sys.argv) > 2 else 1
        page_size = int(sys.argv[3]) if len(sys.argv) > 3 else 25
        
        # 执行搜索
        result = search_iqiyi_videos(keyword, page, page_size)
        
        # 输出JSON格式结果
        import json
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        # 默认搜索示例
        result = search_iqiyi_videos("王牌对王牌第9季")
        
        if result["success"]:
            print("搜索成功!")
            print(f"找到 {result['data']['total_count']} 个视频")
            
            # 显示前3个视频的详细信息
            for i, video in enumerate(result['data']['videos'][:3]):
                print(f"\n视频 {i+1}:")
                video_info = extract_video_info(video)
                for key, value in video_info.items():
                    print(f"  {key}: {value}")
        else:
            print(f"搜索失败: {result['error']}")