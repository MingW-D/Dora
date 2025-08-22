import { TauriWindowManager } from './window-manager';
import { isExternalWebUrl } from '../../utils/urlGuards';


type ActionCallback = (action: string) => Promise<void> | void;

type RunParams = {
  instruction: string;
  webUrl: string;
  webTitle?: string;
  actionCallback?: ActionCallback;
  abortSignal?: AbortSignal;
};

type RunResult = {
  history: Array<{ action: string; information?: string }>
};

export interface BrowserUseLike {
  webContentsView: { setVisible: (visible: boolean) => void };
  loadWebPage: (url: string) => Promise<void>;
  run: (params: RunParams) => Promise<RunResult>;
}

export class TauriBrowserUse implements BrowserUseLike {
  // 仅用于维持与 Electron 版本一致的调用点
  webContentsView = {
    setVisible: (visible: boolean) => {
      // 将可见性状态通知到前端渲染层，由前端决定是否展示浏览器面板
      TauriWindowManager.getInstance().sendMessage('studio', {
        type: 'browserVisible',
        description: 'toggle browser preview visibility',
        payload: { visible },
      });
    },
  };

  async loadWebPage(url: string): Promise<void> {
    // 源头治理：仅在是外部网页时才发送 openUrl
    if (!isExternalWebUrl(url)) {
      await TauriWindowManager.getInstance().sendMessage('studio', {
        type: 'editor',
        description: 'Blocked internal app URL',
        payload: `Blocked opening app URL in Studio: ${url}`,
      });
      return;
    }
    // 将打开 URL 的意图发给前端（由前端决定使用 iframe/WebviewWindow 等方式显示）
    await TauriWindowManager.getInstance().sendMessage('studio', {
      type: 'openUrl',
      description: url,
      payload: { url },
    });
  }

  async run(params: RunParams): Promise<RunResult> {
    const { instruction, webUrl, actionCallback, abortSignal } = params;
    const history: RunResult['history'] = [];

    // 简化实现：通知前端显示目标 URL，并回调动作日志
    if (isExternalWebUrl(webUrl)) {
      await this.loadWebPage(webUrl);
      this.webContentsView.setVisible(true);
    } else {
      // 拦截应用自身地址，避免 Studio 中出现应用套娃
      await TauriWindowManager.getInstance().sendMessage('studio', {
        type: 'editor',
        description: 'Blocked internal app URL',
        payload: `Blocked opening app URL in Studio: ${webUrl}`,
      });
    }

    const announce = async (text: string) => {
      history.push({ action: text });
      try {
        await actionCallback?.(text);
      } catch {}
    };

    await announce(`Navigate to: ${webUrl}`);
    await announce(`Instruction: ${instruction}`);

    if (abortSignal?.aborted) {
      await announce('Abort requested by user');
      return { history };
    }

    // 这里不做真实的自动化操作，仅做占位，保持与上层协议兼容
    await announce('Ready for manual interaction in preview window');
    return { history };
  }
}

