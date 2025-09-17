# 重复内容问题修复说明

## 🐛 问题描述

在流式AI对话生成过程中，会产生多个相似的文本内容块，导致用户看到重复的信息。具体表现为：

```json
[
  {"type":"text","content":"天气报告的前半部分...","id":"text_1756955787972_0plahazo2"},
  {"type":"text","content":"天气报告的前半部分+更多内容...","id":"text_1756955789103_e37r94gua"},
  {"type":"text","content":"完整的天气报告...","id":"text_1756955793562_yvfyhfl0w"}
]
```

## 🔍 问题根因

1. **流式生成特性**：AI在生成过程中会产生增量更新的内容块
2. **时间窗口限制**：原有的1秒时间窗口太短，无法捕获数秒级的更新
3. **独立ID问题**：每个内容块都有独立的ID，被认为是不同的内容
4. **缓存层面**：去重主要在流式处理中进行，显示时缺少最终去重

## ✅ 解决方案

### 1. 显示层去重 (新增)
在 `getBlocksForMessage()` 函数中添加 `deduplicateTextBlocks()` 函数：

```javascript
function deduplicateTextBlocks(blocks: MessageContentBlock[]): MessageContentBlock[] {
  // 智能去重逻辑：
  // - 完全相同的内容跳过
  // - 子串内容被更完整的内容替换
  // - 选择最长（最完整）的文本块
}
```

### 2. 时间窗口扩展
将去重时间窗口从 **1秒** 扩展到 **10秒**：

```javascript
// 修改前
if (trimmedContent.includes(existingContent) && timeDiff < 1000)

// 修改后  
if (trimmedContent.includes(existingContent) && timeDiff < 10000)
```

### 3. 时间戳更新
在更新内容块时，同时更新时间戳：

```javascript
block.content = trimmedContent;
block.timestamp = Date.now(); // 新增
```

## 🎯 效果对比

### 修复前
```
用户看到：
- 天气报告前半部分...
- 天气报告前半部分+更多内容...
- 完整的天气报告...
```

### 修复后  
```
用户看到：
- 完整的天气报告...
```

## 🔧 技术实现

### 去重策略
1. **内容包含检查**：如果A包含B，保留A，丢弃B
2. **长度比较**：优先保留内容更完整的块
3. **时间戳维护**：保持最新的时间戳
4. **非破坏性**：不影响非文本类型的内容块

### 兼容性
- ✅ 兼容现有的消息格式
- ✅ 不影响工具调用、图片等其他内容块
- ✅ 保持时间顺序
- ✅ 向后兼容旧的消息数据

## 📝 使用建议

现在可以放心使用HTML报告工具，不会再出现重复内容问题：

```
使用HtmlReportTool生成本次对话的报告
```

生成的报告将自动过滤重复内容，只显示最完整的信息。