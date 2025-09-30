import requests
from typing import Any, List, Dict, Optional
import asyncio
import json
import os
from datetime import datetime

import requests
from xhs_api import XhsApi
import logging
from urllib.parse import urlparse, parse_qs
import argparse

# Initialize logger and xhs_api instance
logger = logging.getLogger(__name__)
xhs_cookie = 'abRequestId=c57fe682-d2fc-5f58-8ce2-0c8b42ff20a3; a1=1970fd420e08csfwx62vnn688m1bgvahhuhlacu7y50000302545; webId=44ab99e10509af6d75c0887343fb4d28; gid=yjW8if4qiWxSyjW8if4J87S7d8YSMiECKJhIxWvIKYY6y128Dkh0x0888q8J2428f4DSi0yd; webBuild=4.79.0; xsecappid=xhs-pc-web; web_session=0400698d369e974828e10de98a3a4b942f34d2; acw_tc=0a5085c517573997204463137e2d5ba030f87c7afb9b969b5ae532b84589e0; loadts=1757399891064; unread={%22ub%22:%2268ba6574000000001b01e410%22%2C%22ue%22:%2268ba9113000000001c0121db%22%2C%22uc%22:32}; websectiga=6169c1e84f393779a5f7de7303038f3b47a78e47be716e7bec57ccce17d45f99; sec_poison_id=5c09b5be-7b4c-46be-b75e-e61afd1eedc7'

xhs_api = XhsApi(cookie=xhs_cookie) 

async def check_cookie():
    """检查cookie是否有效"""
    try:
        result = await xhs_api.get_me()
        if result and 'data' in result:
            return "Cookie有效"
        else:
            return "Cookie无效或已过期"
    except Exception as e:
        return f"Cookie检查失败: {str(e)}"

def get_nodeid_token(url=None, note_ids=None):
    if note_ids is not None:
        note_id = note_ids[0:24]
        xsec_token = note_ids[24:]
        return {"note_id": note_id, "xsec_token": xsec_token}
    parsed_url = urlparse(url)
    query_params = parse_qs(parsed_url.query)

    note_id = parsed_url.path.split('/')[-1]
    xsec_token = None
    xsec_token_list = query_params.get('xsec_token', [None])
    if len(xsec_token_list) > 0:
        xsec_token = xsec_token_list[0]
    return {"note_id": note_id, "xsec_token": xsec_token}

async def search_notes(keywords: str) -> str:
    """根据关键词搜索笔记

        Args:
            keywords: 搜索关键词
    """

    data = await xhs_api.search_notes(keywords)
    logger.info(f'keywords:{keywords},data:{data}')
    res_list = []
    result = "搜索结果：\n\n"
    # print(data)
    if 'data' in data and 'items' in data['data'] and len(data['data']['items']) > 0:
        for i in range(0, len(data['data']['items'])):
            item = data['data']['items'][i]
            note_id = item['id']
            if 'note_card' in item and 'display_title' in item['note_card']:
                title = item['note_card']['display_title']
                liked_count = item['note_card']['interact_info']['liked_count']
                # cover=item['note_card']['cover']['url_default']
                url = f'https://www.xiaohongshu.com/explore/{item["id"]}?xsec_token={item["xsec_token"]}'
                result += f"{i}. {title}  \n 点赞数:{liked_count} \n   链接: {url}  \n id:{note_id}\n\n"
                res_list.append({
                    'title': title,
                    'liked_count': liked_count,
                    'url': url,
                    'note_id': note_id
                })
    else:
        result = await check_cookie()
        if "有效" in result:
            result = f"未找到与\"{keywords}\"相关的笔记"
    # print(result)
    return res_list

async def get_note_content(url: str) -> str:
    """获取笔记内容,参数url要带上xsec_token

    Args:
        url: 笔记 url
    """
    params = get_nodeid_token(url=url)
    data = await xhs_api.get_note_content(**params)
    logger.info(f'url:{url},data:{data}')
    content_list = []
    result = ""
    if 'data' in data and 'items' in data['data'] and len(data['data']['items']) > 0:
        for i in range(0, len(data['data']['items'])):
            item = data['data']['items'][i]

            if 'note_card' in item and 'user' in item['note_card']:
                note_card = item['note_card']
                cover = ''
                if 'image_list' in note_card and len(note_card['image_list']) > 0 and note_card['image_list'][0][
                    'url_pre']:
                    cover = note_card['image_list'][0]['url_pre']
                # print(note_card['image_list'])
                data_format = datetime.fromtimestamp(note_card.get('time', 0) / 1000)
                liked_count = item['note_card']['interact_info']['liked_count']
                comment_count = item['note_card']['interact_info']['comment_count']
                collected_count = item['note_card']['interact_info']['collected_count']

                url = f'https://www.xiaohongshu.com/explore/{params["note_id"]}?xsec_token={params["xsec_token"]}'
                # result = f"标题: {note_card.get('title', '')}\n"
                # result += f"作者: {note_card['user'].get('nickname', '')}\n"
                # result += f"发布时间: {data_format}\n"
                # result += f"点赞数: {liked_count}\n"
                # result += f"评论数: {comment_count}\n"
                # result += f"收藏数: {collected_count}\n"
                # result += f"链接: {url}\n\n"
                # result += f"内容:\n{note_card.get('desc', '')}\n"
                # result += f"封面:\n{cover}"
                # print(note_card.get('info_list', []))
                content_list.append({
                    'author': note_card['user'].get('nickname', ''),
                    'publish_time': data_format.isoformat(),
                    'content': note_card.get('desc', ''),
                    'images': [img_info['url'] for img_info in note_card['image_list'][0].get('info_list', []) if 'url' in img_info],
                })
            break
    else:
        result = await check_cookie()
        if "有效" in result:
            result = "获取失败"
    return content_list


async def get_note_comments(url: str) -> str:
    """获取笔记评论,参数url要带上xsec_token

    Args:
        url: 笔记 url
    

    """
    params = get_nodeid_token(url=url)

    data = await xhs_api.get_note_comments(**params)
    logger.info(f'url:{url},data:{data}')

    comment_list = []
    result = ""
    if 'data' in data and 'comments' in data['data'] and len(data['data']['comments']) > 0:
        for i in range(0, len(data['data']['comments'])):
            item = data['data']['comments'][i]
            data_format = datetime.fromtimestamp(item['create_time'] / 1000)

            result += f"{i}. {item['user_info']['nickname']}（{data_format}）: {item['content']}\n\n"
            comment_list.append({
                'author': item['user_info']['nickname'],
                'content': item['content'],
                'create_time': data_format.isoformat()
            })
    else:
        result = await check_cookie()
        if "有效" in result:
            result = "暂无评论"

    return comment_list


async def get_all_notes_details(keywords: str) -> str:
    """根据关键词搜索笔记，并获取所有链接内容和评论

    Args:
        keywords: 搜索关键词
    """
    all_notes_details = []
    notes_list = await search_notes(keywords)

    if notes_list:
        for note in notes_list:
            url = note['url']
            note_content = await get_note_content(url)
            note_comments = await get_note_comments(url)
            all_notes_details.append({
                'title': note['title'],
                'url': url,
                'content': note_content,
                'comments': note_comments
            })
    return json.dumps(all_notes_details, ensure_ascii=False, indent=4)


if __name__ == "__main__":
    import sys
    import io
    
    # 设置标准输出和错误输出为UTF-8编码（解决Windows下GBK编码问题）
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    
    # 解析命令行参数
    parser = argparse.ArgumentParser(description='小红书内容搜索工具')
    parser.add_argument('--action', type=str, required=True, choices=['search', 'details'], 
                        help='操作类型：search-搜索笔记，details-获取详情')
    parser.add_argument('--keywords', type=str, required=True, help='搜索关键词')
    parser.add_argument('--limit', type=int, default=10, help='搜索结果数量限制')
    
    args = parser.parse_args()
    
    try:
        if args.action == 'search':
            # 仅搜索笔记
            result = asyncio.run(search_notes(args.keywords))
            print(json.dumps(result, ensure_ascii=False))
        elif args.action == 'details':
            # 搜索并获取详情
            result = asyncio.run(get_all_notes_details(args.keywords))
            print(result)  # get_all_notes_details已经返回JSON字符串
        
        sys.exit(0)  # 成功退出
    except Exception as e:
        # 输出错误信息到stderr
        error_result = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(error_result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)  # 错误退出

