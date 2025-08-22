import { createApp } from "vue";
import { createPinia } from 'pinia';
import "./style.css";
import App from "./App.vue";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { studioBus, type StudioAction } from './services/studioBus';

// 创建 Vue 应用实例
const app = createApp(App);

// 添加 Pinia 状态管理
const pinia = createPinia();
app.use(pinia);

// 挂载应用
app.mount("#app");

// 监听来自主窗口的 studio 事件，并转发到 studioBus
getCurrentWindow().listen('studio', (event) => {
  const action = event.payload as any;
  const mapped: StudioAction = (() => {
    switch (action?.type) {
      case 'editor':
        return { type: 'editor', description: action.description, payload: action.payload };
      case 'searchResults':
        return { type: 'list', description: action.description, payload: action.payload };
      case 'openFolder':
        return { type: 'folder', description: action.description, payload: action.payload };
      case 'openFile':
        return { type: 'editor', description: action.description, payload: action.payload };
      case 'openUrl':
        // 仅 openUrl 承载 URL，交由 StudioPane 赋值 iframe.src
        return { type: 'openUrl', description: action.description, payload: action.payload };
      case 'browserVisible':
        // 独立的可见性事件，不再映射为 html
        return { type: 'visibility', description: action.description, payload: action.payload };
      default:
        return { type: 'editor', description: action?.description ?? '', payload: action?.payload } as StudioAction;
    }
  })();
  studioBus.preview(mapped);
});
