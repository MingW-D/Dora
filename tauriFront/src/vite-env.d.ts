/// <reference types="vite/client" />
declare module 'openai' {
  export const OpenAI: any;
  const _default: any;
  export default _default;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

// 添加 Tauri API 类型声明
declare module '@tauri-apps/api/tauri' {
  export function invoke<T>(command: string, args?: unknown): Promise<T>;
}
