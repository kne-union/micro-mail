import React from 'react';
import { preset as fetchPreset } from '@kne/react-fetch';
import { Spin, Empty, message } from 'antd';
import { cache as remoteModuleCache, loadModule, preset as remoteLoaderPreset } from '@kne/remote-loader';
import { themeToken as themeTokenPreset } from '@kne/system-layout';
import createAjax from '@kne/axios-fetch';
import transform from 'lodash/transform';
import merge from 'lodash/merge';
import { getApis } from '@components/Apis';
import { setOidcClient } from './commons/oidcClient';
import { getPublicBasePath } from './commons/publicUrl';

window.PUBLIC_URL = window.runtimePublicUrl || process.env.PUBLIC_URL;

const publicBase = getPublicBasePath();
if (publicBase && typeof document !== 'undefined') {
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/') && !href.startsWith(`${publicBase}/`)) {
      link.setAttribute('href', `${publicBase}${href}`);
    }
  });
}

const ensureBootMask = () => {
  if (typeof document === 'undefined') {
    return;
  }
  if (!document.getElementById('app-boot-style')) {
    const style = document.createElement('style');
    style.id = 'app-boot-style';
    style.textContent =
      '#app-boot{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#f6f7f9}#app-boot img{width:72px;height:72px}#app-boot-name{font-size:16px;line-height:24px;font-weight:500;color:rgba(0,0,0,.88)}';
    document.head.appendChild(style);
  }
  let mask = document.getElementById('app-boot');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'app-boot';
    const img = document.createElement('img');
    img.id = 'app-boot-logo';
    img.alt = '';
    img.src = `${publicBase}/favicon.svg`;
    mask.appendChild(img);
    document.body.prepend(mask);
  }
  let name = document.getElementById('app-boot-name');
  if (!name) {
    name = document.createElement('div');
    name.id = 'app-boot-name';
    mask.appendChild(name);
  }
  name.textContent = document.title;
};

ensureBootMask();

const baseApiUrl = window.runtimeApiUrl || '';

const loadOidcConfig = async () => {
  try {
    const response = await fetch(`${baseApiUrl.replace(/\/+$/, '')}/api/oidc/config`);
    const body = await response.json();
    return body && Object.prototype.hasOwnProperty.call(body, 'code') && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  } catch (e) {
    console.error(e);
    return null;
  }
};

const globalInit = async () => {
  const registry = {
    url: 'https://cdn.leapin-ai.com',
    tpl: '{{url}}/components/@kne-components/{{remote}}/{{version}}/build'
  };

  const componentsCoreRemote = {
    ...registry,
    remote: 'components-core',
    defaultVersion: '0.6.13'
  };

  remoteLoaderPreset({
    remotes: {
      default: componentsCoreRemote,
      'components-core': componentsCoreRemote,
      'components-iconfont': {
        ...registry,
        remote: 'components-iconfont',
        defaultVersion: '0.2.1'
      },
      'components-file-manager': {
        ...registry,
        remote: 'components-file-manager',
        defaultVersion: '0.1.9'
      },
      'components-admin': {
        ...registry,
        remote: 'components-admin',
        defaultVersion: '1.1.126'
      },
      'components-thirdparty': {
        ...registry,
        remote: 'components-thirdparty',
        defaultVersion: '0.1.50'
      },
      'fastify-app':
        process.env.NODE_ENV === 'development'
          ? {
              remote: 'fastify-app',
              url: '/',
              tpl: '{{url}}'
            }
          : {
              ...registry,
              remote: 'fastify-app',
              defaultVersion: process.env.DEFAULT_VERSION
            }
    }
  });

  const { default: createOidcClient } = await loadModule('components-admin:Oidc@createOidcClient');
  // 部署在应用中心时以 central 模式运行，issuer / clientId / audience 由宿主注入到服务端环境变量，只能从服务端配置接口读取
  const oidcConfig = await loadOidcConfig();
  const oidcClient = createOidcClient({
    issuer: oidcConfig?.issuer || window.runtimeOidcIssuer || `${window.location.origin}/oidc`,
    clientId: oidcConfig?.clientId || window.runtimeOidcClientId || 'oidc-spa',
    resource: oidcConfig?.audience || window.runtimeOidcResource || `${window.location.origin}/api`
  });
  setOidcClient(oidcClient);

  const ajax = createAjax({
    baseURL: baseApiUrl,
    errorHandler: error => message.error(error),
    registerInterceptors: interceptors => oidcClient.registerInterceptors(interceptors)
  });

  fetchPreset({
    ajax,
    loading: (
      <Spin
        delay={500}
        style={{
          position: 'absolute',
          left: '50%',
          padding: '10px',
          transform: 'translateX(-50%)'
        }}
      />
    ),
    error: null,
    empty: <Empty />,
    transformResponse: response => {
      const { data } = response;
      response.data = {
        code: data.code === 0 ? 200 : data.code,
        msg: data.msg,
        results: data.data
      };
      return response;
    }
  });

  const safeLoadApis = async name => {
    try {
      return await loadModule(name).then(({ default: defaultModule }) => defaultModule);
    } catch (e) {
      console.error(e);
      return () => ({});
    }
  };

  const remoteApis = await (async () => {
    const input = {
      fileManager: 'components-file-manager:Apis@getApis'
    };

    const remoteApiKeys = Object.keys(input);
    return transform(
      await Promise.all(remoteApiKeys.map(name => safeLoadApis(Array.isArray(input[name]) ? input[name][0] : input[name]))),
      (result, value, index) => {
        const name = remoteApiKeys[index];
        result[name] = value(input[name][1]);
      },
      {}
    );
  })();

  const getAccountApis = await safeLoadApis('components-admin:Apis@getApis');

  await Promise.all(
    [
      'components-core:Global',
      'components-admin:Authenticate@AfterUserLoginLayout',
      'components-admin:Authenticate@AfterAdminUserLoginLayout',
      'components-admin:Oidc@OidcAuthenticate',
      'components-admin:Oidc@Interaction',
      'components-admin:Authenticate@AfterUserLogin',
      'components-core:Global@GlobalValue',
      'components-admin:MailGateway@getMenuItems',
      'components-admin:Account@useLogout',
      'components-admin:Account@Language',
      'components-admin:MailGateway'
    ].map(async token => {
      try {
        const { default: component } = await loadModule(token);
        if (component && typeof component.moduleMounted === 'function') {
          await component.moduleMounted({ token, module: component });
        }
        if (component) {
          remoteModuleCache.set(`${token}::{}`, component);
        }
      } catch (e) {
        console.error(e);
      }
    })
  );

  return {
    ajax,
    oidc: oidcClient,
    oidcMode: oidcConfig?.mode,
    staticUrl: baseApiUrl,
    enums: Object.assign({}, await safeLoadApis('components-admin:Task@enums'), await safeLoadApis('components-admin:MessageManger@enums'), await safeLoadApis('components-admin:MailGateway@enums')),
    apis: Object.assign(
      {},
      getAccountApis(),
      remoteApis,
      {
        file: {
          contentWindowUrl: 'https://cdn.leapin-ai.com/components/@kne/iframe-resizer/0.1.3/dist/contentWindow.js',
          pdfjsUrl: 'https://cdn.leapin-ai.com/components/pdfjs-dist/5.4.296',
          getUrl: {
            url: `/api/v1/static/file-url/{id}`,
            paramsType: 'urlParams',
            ignoreSuccessState: true
          },
          upload: ({ file }) => {
            return ajax.postForm({
              url: `/api/v1/static/upload`,
              data: { file }
            });
          }
        }
      },
      getApis()
    ),
    themeToken: merge({}, themeTokenPreset, {
      colorPrimary: '#4183F0'
    })
  };
};

const hideBootMask = () => {
  if (typeof document === 'undefined') {
    return;
  }
  document.getElementById('app-boot')?.remove();
};

const globalInitWithBootMask = async () => {
  const preset = await globalInit();
  hideBootMask();
  return preset;
};

export { globalInitWithBootMask as globalInit };
