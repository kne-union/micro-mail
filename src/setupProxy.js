const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8060',
      changeOrigin: true
    })
  );
  // 本地独立运行时服务端即 IdP；保留 Host，oidc-provider 据此生成 issuer 一致的跳转地址
  app.use(
    // 前缀匹配会误伤前端路由 /oidc-interaction、/oidc-callback
    createProxyMiddleware(path => path === '/oidc' || path.startsWith('/oidc/'), {
      target: 'http://localhost:8060',
      xfwd: true
    })
  );
};
