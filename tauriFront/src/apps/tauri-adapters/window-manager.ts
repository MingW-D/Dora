import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export class TauriWindowManager {
  private static instance: TauriWindowManager;
  private mainWindow: Window | null = null;
  
  static getInstance(): TauriWindowManager {
    if (!TauriWindowManager.instance) {
      TauriWindowManager.instance = new TauriWindowManager();
    }
    return TauriWindowManager.instance;
  }

  async initialize(): Promise<Window> {
    if (!this.mainWindow) {
      this.mainWindow = getCurrentWindow();
    }
    return this.mainWindow;
  }

  getMainWindow(): Window | null {
    return this.mainWindow;
  }

  async createWebview(label: string, url: string): Promise<WebviewWindow> {
    return new WebviewWindow(label, {
      url,
      width: 800,
      height: 600,
      resizable: true,
    });
  }

  async sendMessage(message: string, payload: any): Promise<void> {
    if (this.mainWindow) {
      await this.mainWindow.emit(message, payload);
    }
  }

  async onMessage(message: string, handler: (payload: any) => void): Promise<void> {
    if (this.mainWindow) {
      await this.mainWindow.listen(message, (event) => {
        handler(event.payload);
      });
    }
  }
}

export function getMainWindow(): Window | null {
  return TauriWindowManager.getInstance().getMainWindow();
}