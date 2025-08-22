// Shared URL guard utilities for Studio preview
// Only allow http/https external pages, and block current app origin and common root index paths
export function isExternalWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return false;

    const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    if (currentOrigin) {
      try {
        const current = new URL(currentOrigin);
        // Block same-origin
        if (u.origin === current.origin) return false;
        // Block same host root or index.html (common dev app entry)
        if (u.host === current.host && (u.pathname === '/' || u.pathname.endsWith('/index.html'))) return false;
      } catch {}
    }

    return true;
  } catch {
    return false;
  }
}