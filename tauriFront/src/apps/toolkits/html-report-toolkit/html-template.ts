export function generateHtmlTemplate(data: {
  title: string;
  summary: string;
  conversationId: string;
  timestamp: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp?: string;
    toolCalls?: Array<{
      name: string;
      args: any;
      result: any;
    }>;
  }>;
  tasks: Array<{
    type: string;
    description: string;
    payload: any;
    status: string;
  }>;
}): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.title}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 2rem;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            color: white;
            padding: 2.5rem;
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }
        
        .subtitle {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .meta-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            padding: 1.5rem 2rem;
            background: #f8fafc;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .meta-row {
            display: flex;
            gap: 0.5rem;
            align-items: center;
        }
        
        .meta-label {
            font-weight: 600;
            color: #6b7280;
            min-width: 90px;
        }
        
        .meta-value { color: #111827; }
        
        .content-section {
            padding: 2rem;
            border-top: 1px solid #e5e7eb;
        }
        
        .section-title {
            font-size: 1.5rem;
            color: #1f2937;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .summary-box {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 1rem;
        }
        
        .message {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 1rem;
            margin-bottom: 1rem;
        }
        
        .message-role {
            font-weight: 600;
            color: #374151;
            margin-bottom: 0.5rem;
        }
        
        .message-content { color: #111827; white-space: pre-wrap; }
        
        .tool-calls {
            margin-top: 0.75rem;
            padding: 0.75rem;
            background: #f3f4f6;
            border-radius: 8px;
            border: 1px solid #e5e7eb;
        }
        
        .tool-call-item { margin-bottom: 0.5rem; }
        .tool-call-item:last-child { margin-bottom: 0; }
        .tool-call-name { font-weight: 600; }
        .tool-call-args, .tool-call-result { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.9rem; white-space: pre-wrap; }
        
        .tasks-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
            gap: 1rem;
        }
        
        .task-card {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 1rem;
        }
        
        .task-type { font-weight: 600; color: #2563eb; margin-bottom: 0.25rem; }
        .task-description { color: #111827; margin-bottom: 0.5rem; }
        .task-status { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 9999px; font-size: 0.85rem; }
        .task-status.completed { background: #dcfce7; color: #166534; }
        .task-status.pending { background: #fef9c3; color: #92400e; }
        .task-status.failed { background: #fee2e2; color: #991b1b; }
        
        /* 图片画廊 */
        .images-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 16px;
        }
        .image-card {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        .image-card img { width: 100%; height: auto; display: block; }
        .image-card .image-url {
            font-size: 0.8rem;
            padding: 8px 10px;
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            word-break: break-all;
            background: #f9fafb;
        }
        
        .footer {
            background: #1f2937;
            color: white;
            text-align: center;
            padding: 2rem;
            font-size: 0.9rem;
        }
        
        .emoji {
            font-size: 1.2rem;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 1rem;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .content-section {
                padding: 1.5rem;
            }
            
            .tasks-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><span class="emoji">📊</span> ${data.title}</h1>
            <p class="subtitle">AI对话与任务执行报告</p>
        </div>
        
        <div class="meta-info">
            <div class="meta-row">
                <span class="meta-label">对话ID:</span>
                <span class="meta-value">${data.conversationId}</span>
            </div>
            <div class="meta-row">
                <span class="meta-label">生成时间:</span>
                <span class="meta-value">${data.timestamp}</span>
            </div>
            <div class="meta-row">
                <span class="meta-label">消息数量:</span>
                <span class="meta-value">${data.messages.length}</span>
            </div>
            <div class="meta-row">
                <span class="meta-label">任务数量:</span>
                <span class="meta-value">${data.tasks.length}</span>
            </div>
        </div>
        
        ${data.summary ? `
        <div class="content-section">
            <h2 class="section-title"><span class="emoji">📝</span> 摘要</h2>
            <div class="summary-box">${escapeHtml(data.summary)}</div>
        </div>
        ` : ''}
        
        <div class="content-section">
            <h2 class="section-title"><span class="emoji">💬</span> 对话记录</h2>
            ${data.messages.map(msg => `
                <div class="message">
                    <div class="message-role">${getRoleDisplayName(msg.role)}</div>
                    <div class="message-content">${escapeHtml(msg.content)}</div>
                    ${msg.toolCalls && msg.toolCalls.length ? `
                        <div class="tool-calls">
                            ${msg.toolCalls.map(tool => `
                                <div class="tool-call-item">
                                    <div class="tool-call-name">🔧 ${escapeHtml(tool.name)}</div>
                                    <div class="tool-call-args"><strong>参数:</strong> ${escapeHtml(JSON.stringify(tool.args, null, 2))}</div>
                                    <div class="tool-call-result"><strong>结果:</strong> ${escapeHtml(typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2))}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
        
        ${(data as any).images && (data as any).images.length > 0 ? `
        <div class="content-section">
            <h2 class="section-title"><span class="emoji">🖼️</span> 图片集</h2>
            <div class="images-grid">
                ${(data as any).images.map((url: string) => `
                    <div class="image-card">
                        <img src="${url}" alt="image" />
                        <div class="image-url">${escapeHtml(url)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        ${data.tasks.length > 0 ? `
        <div class="content-section">
            <h2 class="section-title"><span class="emoji">⚙️</span> 执行任务</h2>
            <div class="tasks-grid">
                ${data.tasks.map(task => `
                    <div class="task-card">
                        <div class="task-type">${task.type}</div>
                        <div class="task-description">${escapeHtml(task.description)}</div>
                        <div class="task-status ${task.status.toLowerCase()}">${getStatusDisplayName(task.status)}</div>
                        ${task.payload ? `<div class="task-payload">${escapeHtml(typeof task.payload === 'string' ? task.payload : JSON.stringify(task.payload, null, 2))}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        <div class="footer">
            <p>📋 报告由 Dora.AI 自动生成 | ${data.timestamp}</p>
        </div>
    </div>
    
    <script>
        function getRoleDisplayName(role) {
            const roleNames = {
                'user': '👤 用户',
                'assistant': '🤖 助手', 
                'system': '⚙️ 系统',
                'tool': '🔧 工具'
            };
            return roleNames[role] || role;
        }
        
        function getStatusDisplayName(status) {
            const statusNames = {
                'COMPLETED': '✅ 已完成',
                'PENDING': '⏳ 进行中',
                'FAILED': '❌ 失败',
                'CANCELLED': '⚠️ 已取消'
            };
            return statusNames[status] || status;
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getRoleDisplayName(role: string): string {
  const roleNames: Record<string, string> = {
    'user': '👤 用户',
    'assistant': '🤖 助手', 
    'system': '⚙️ 系统',
    'tool': '🔧 工具'
  };
  return roleNames[role] || role;
}

function getStatusDisplayName(status: string): string {
  const statusNames: Record<string, string> = {
    'COMPLETED': '✅ 已完成',
    'PENDING': '⏳ 进行中',
    'FAILED': '❌ 失败',
    'CANCELLED': '⚠️ 已取消'
  };
  return statusNames[status] || status;
}