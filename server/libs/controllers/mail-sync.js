const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify.mailGateway;

  fastify.post(
    `${options.prefix}/mail-sync/login`,
    {
      onRequest: [fastify.account.authenticate.user],
      schema: {
        summary: '登录后同步当前用户的邮箱',
        description: '在后台依次同步当前用户名下所有已启用的邮箱，立即返回待同步的邮箱数量；正在同步的邮箱会被跳过'
      }
    },
    async request => {
      const userId = request.userInfo.id;
      const accounts = await models.account.findAll({ where: { userId, status: 'enabled' }, attributes: ['id'] });
      (async () => {
        for (const { id } of accounts) {
          try {
            await services.sync.syncAccount({ id, userId });
          } catch (e) {
            fastify.log.error(e, `[mail-sync] 邮箱 ${id} 登录同步失败`);
          }
        }
      })();
      return { count: accounts.length };
    }
  );
});
