// 窗口控制服务
// 使用 Tauri 的 Window API 控制应用窗口

// 初始化窗口控制
export function initWindowControls() {
  // 使用 dynamic import 避免在非 Tauri 环境中出错
  import('@tauri-apps/api/window').then(({ Window }) => {
    const appWindow = new Window('main');

    // 最小化按钮
    document
      .getElementById('titlebar-minimize')
      ?.addEventListener('click', () => appWindow.minimize());

    // 最大化/还原按钮
    document
      .getElementById('titlebar-maximize')
      ?.addEventListener('click', () => appWindow.toggleMaximize());

    // 关闭按钮
    document
      .getElementById('titlebar-close')
      ?.addEventListener('click', () => {
        // 关闭窗口
        appWindow.close();
      });
  }).catch(err => {
    console.error('无法加载 Tauri Window API:', err);
    
    // 回退机制：如果无法加载 Tauri API，提供简单的视觉反馈
    document
      .getElementById('titlebar-minimize')
      ?.addEventListener('click', () => {
        document.body.style.opacity = '0.5';
        setTimeout(() => { document.body.style.opacity = '1'; }, 200);
      });
      
    document
      .getElementById('titlebar-maximize')
      ?.addEventListener('click', () => {
        document.documentElement.classList.toggle('maximized');
      });
      
    document
      .getElementById('titlebar-close')
      ?.addEventListener('click', () => {
        document.body.style.opacity = '0';
        setTimeout(() => { 
          document.body.style.opacity = '1';
          console.log('窗口关闭功能在非 Tauri 环境中不可用');
        }, 300);
      });
  });
} 