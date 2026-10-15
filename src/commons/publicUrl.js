/**
 * App Manager 子应用挂在 /app/{name} 下时注入 window.runtimePublicUrl（无尾斜杠），独立部署时为空或 '/'。
 * 不读 window.PUBLIC_URL：它可能是 CDN 地址，不是页面挂载前缀。
 */
export const getPublicBasePath = () => {
  const raw = window.runtimePublicUrl || '';
  if (!raw || raw === '/') {
    return '';
  }
  return String(raw).replace(/\/+$/, '');
};

export const withPublicUrl = pathname => {
  const path = String(pathname || '');
  const base = getPublicBasePath();
  if (!base || !path.startsWith('/') || path === base || path.startsWith(`${base}/`)) {
    return path;
  }
  return `${base}${path}`;
};

export const getRouterBasename = () => getPublicBasePath() || undefined;
