const fastify = require('fastify')({
  logger: true,
  querystringParser: str => require('qs').parse(str)
});

const fastifyEnv = require('@fastify/env');
const packageJson = require('./package.json');
const path = require('path');

const version = `v${packageJson.version.split('.')[0]}`;

const options = {
  name: 'project',
  prefix: `/api/${version}`,
  taskCron: '*/1 * * * *',
  getUserModel: () => {
    return fastify.account.models.user;
  }
};

const createServer = () => {
  fastify.register(fastifyEnv, {
    dotenv: true,
    schema: require('./env.schema.json')
  });

  // 须在其它插件之前注册，否则收集不到先定义的路由；文档由 @kne/fastify-app-runtime 的 /open-api.json 输出
  const appPackageJson = require('../package.json');
  fastify.register(require('@fastify/swagger'), {
    openapi: {
      info: { title: appPackageJson.name, version: appPackageJson.version }
    }
  });

  fastify.register(require('fastify-cron'));

  fastify.register(
    require('fastify-plugin')(async fastify => {
      fastify.register(require('@kne/fastify-sequelize'), {
        db: {
          dialect: fastify.config.DB_DIALECT,
          host: fastify.config.DB_HOST,
          port: fastify.config.DB_PORT,
          database: fastify.config.DB_DATABASE,
          username: fastify.config.DB_USERNAME,
          password: fastify.config.DB_PASSWORD
        },
        modelsGlobOptions: {
          syncOptions: {}
        },
        getUserModel: options.getUserModel
      });

      fastify.register(require('@kne/fastify-account'), {
        isTest: fastify.config.IS_TEST === true,
        prefix: `${options.prefix}`,
        getUserAuthenticate: () => fastify.oidc.authenticate.user,
        sendMessage: async ({ name, type, messageType, props }) => {
          if (messageType === 1 && type === 0) {
            await fastify.message.services.sendMessage({
              name,
              type: 0,
              code: 'REGISTERCODE',
              props,
              options: {
                title: '注册验证码'
              }
            });
          }
          if (messageType === 1 && type === 5) {
            await fastify.message.services.sendMessage({
              name,
              type: 0,
              code: 'RESETPASSWORDCODE',
              props: Object.assign({}, props, {
                url: `${fastify.config.ORIGIN}/account/reset-password/${props.token}${props.options?.referer ? `?referer=${props.options?.referer}` : ''}`
              }),
              options: {
                title: '重置密码'
              }
            });
          }
        }
      });

      fastify.register(require('@kne/fastify-message'), {
        isTest: fastify.config.IS_TEST === true,
        prefix: `${options.prefix}/message`,
        emailConfig: {
          host: fastify.config.ALISMTP_ENDPOINT,
          port: 465,
          secure: true,
          user: fastify.config.ALISMTP_USER,
          pass: fastify.config.ALISMTP_PASSWORD
        },
        templateDir: path.join(__dirname, './messageTemplate'),
        senders: {}
      });

      fastify.register(require('@kne/fastify-task'), {
        prefix: `${options.prefix}/task`,
        cronTime: options.taskCron,
        task: {}
      });

      // .env 里的值不一定写入 process.env（@fastify/env 7 起不再写入），fastify-oidc 的环境变量默认值可能读不到，需显式传入
      fastify.register(require('@kne/fastify-oidc'), {
        selfClient: { clientName: 'micro-mail' },
        origin: fastify.config.ORIGIN,
        keyEncryptionSecret: fastify.config.OIDC_KEY_SECRET
      });
    })
  );

  fastify.register(
    require('fastify-plugin')(async fastify => {
      const { OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET } = fastify.config;
      const ossEnabled = !!(OSS_REGION && OSS_BUCKET && OSS_ACCESS_KEY_ID && OSS_ACCESS_KEY_SECRET);

      fastify.register(require('@kne/fastify-file-manager'), {
        prefix: `${options.prefix}/static`,
        root: path.resolve('./static'),
        ossAdapter: () => (ossEnabled ? fastify.aliyun.services.oss : {})
      });

      if (ossEnabled) {
        fastify.register(require('@kne/fastify-aliyun'), {
          prefix: `${options.prefix}/aliyun`,
          oss: {
            baseDir: 'micro-mail',
            region: OSS_REGION,
            accessKeyId: OSS_ACCESS_KEY_ID,
            accessKeySecret: OSS_ACCESS_KEY_SECRET,
            bucket: OSS_BUCKET
          }
        });
      }
    })
  );

  fastify.register(
    require('fastify-plugin')(async fastify => {
      const mailAi = require('./libs/mail-ai')(fastify);
      fastify.register(require('@kne/fastify-mail-gateway'), {
        prefix: `${options.prefix}/mail-gateway`,
        secretKey: fastify.config.MAIL_GATEWAY_SECRET_KEY,
        templateDir: path.join(__dirname, './mailTemplate'),
        defaultLabels: [
          { code: 'important', name: '重要', color: '#f5222d' },
          { code: 'todo', name: '待办', color: '#fa8c16' },
          { code: 'follow-up', name: '待跟进', color: '#1677ff' },
          { code: 'invoice', name: '发票', color: '#13c2c2' },
          { code: 'customer', name: '客户', color: '#2f54eb' },
          { code: 'hr', name: '招聘', color: '#722ed1' },
          { code: 'meeting', name: '会议', color: '#52c41a' },
          { code: 'support', name: '客服', color: '#eb2f96' },
          { code: 'spam', name: '垃圾邮件', color: '#8c8c8c' },
          { code: 'archive', name: '归档', color: '#595959' }
        ],
        getAuthenticate: () => [fastify.account.authenticate.user],
        conditions: mailAi.conditions,
        actions: mailAi.actions
      });
    })
  );

  fastify.register(
    require('fastify-plugin')(async fastify => {
      fastify.register(require('@kne/fastify-namespace'), {
        options,
        name: options.name,
        modules: [
          ['controllers', path.resolve(__dirname, './libs/controllers')],
          [
            'models',
            await fastify.sequelize.addModels(path.resolve(__dirname, './libs/models'), {
              getUserModel: options.getUserModel
            })
          ],
          ['services', path.resolve(__dirname, './libs/services')]
        ]
      });
      await fastify.sequelize.sync();
    })
  );

  fastify.register(
    require('fastify-plugin')(async fastify => {
      await fastify.register(require('@kne/fastify-app-runtime'), {
        root: path.join(__dirname, './build'),
        packageJson: appPackageJson,
        setting: {
          prefix: `${options.prefix}/setting`
        }
      });
    })
  );

  fastify.register(require('@kne/fastify-response-data-format'));
};

module.exports = {
  fastify,
  createServer,
  start: () => {
    createServer();
    return fastify.then(() => {
      fastify.listen({ port: fastify.config.PORT, host: '0.0.0.0' }, (err, address) => {
        if (err) throw err;
        console.log(`Server is now listening on ${address}`);
      });
    });
  }
};
