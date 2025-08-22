const filterPatterns = [
  /<assistant>/,
  /<user>/,
  /<task>/,
  /<expected_result>/,
  /<context>/,
  /<TASK_DONE>/,
  /Instructions:/,
  /Expected Result:/,
  /Solution:/,
  // 添加过滤重复的工具调用描述
  /使用.*?工具查询.*?使用.*?工具查询/g,
  /I will use.*?I will use/g,
];

export function removeFilterPatterns(stream: string) {
  let result = filterPatterns.reduce((acc, pattern) => {
    const filtered = acc.replace(pattern, '');
    return filtered ? filtered : acc;
  }, stream);
  
  // 额外处理重复的句子或短语
  result = removeDuplicateContent(result);
  
  return result;
}

function removeDuplicateContent(text: string): string {
  // 移除重复的句子（以句号、问号、感叹号结尾的句子）
  const sentences = text.split(/([。！？.!?])/);
  const uniqueSentences: string[] = [];
  const seenSentences = new Set<string>();
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i]?.trim();
    const punctuation = sentences[i + 1] || '';
    
    if (sentence && !seenSentences.has(sentence)) {
      seenSentences.add(sentence);
      uniqueSentences.push(sentence + punctuation);
    } else if (!sentence) {
      uniqueSentences.push(punctuation);
    }
  }
  
  return uniqueSentences.join('');
}
