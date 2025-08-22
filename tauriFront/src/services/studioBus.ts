import { TauriWindowManager } from '../apps/tauri-adapters/window-manager';

export type StudioActionType = string;
export type StudioAction = {
  type: StudioActionType;
  description: string;
  payload: any;
};

type Observer<T> = {
  next?: (value: T) => void;
  error?: (err: any) => void;
  complete?: () => void;
};

class MiniSubject<T> {
  private observers: Observer<T>[] = [];
  private isCompleted = false;
  next(value: T) {
    if (this.isCompleted) return;
    for (const o of this.observers) o.next && o.next(value);
  }
  error(err: any) {
    if (this.isCompleted) return;
    for (const o of this.observers) o.error && o.error(err);
    this.isCompleted = true;
  }
  complete() {
    if (this.isCompleted) return;
    for (const o of this.observers) o.complete && o.complete();
    this.isCompleted = true;
  }
  subscribe(observer: Observer<T>) {
    this.observers.push(observer);
    return {
      unsubscribe: () => {
        this.observers = this.observers.filter((o) => o !== observer);
      },
    };
  }
}

const subject = new MiniSubject<StudioAction>();

export const studioBus = {
  preview(action: StudioAction) {
    subject.next(action);
  },
  subscribe(observer: Observer<StudioAction>) {
    return subject.subscribe(observer);
  },
};

let bridgeInitialized = false;
export async function initStudioBusBridge() {
  if (bridgeInitialized) return;
  bridgeInitialized = true;
  try {
    await TauriWindowManager.getInstance().initialize();
    await TauriWindowManager.getInstance().onMessage('studio', (payload: any) => {
      try {
        subject.next(payload as StudioAction);
      } catch {}
    });
  } catch {}
}

