import { useEffect } from 'react';
import RemoteLoader, { createWithRemoteLoader } from '@kne/remote-loader';
import AppChildrenRouter from '@kne/app-children-router';
import { Navigate } from 'react-router-dom';
import Admin from '@components/Admin';

import Client from '@components/Client';

import { getOidcClient } from './commons/oidcClient';
import { clearLoginMailSync } from './commons/loginMailSync';
import './index.scss';

const Protected = ({ children }) => <RemoteLoader module="components-admin:Oidc@OidcAuthenticate">{children}</RemoteLoader>;

/** 远程组件内置的退出（useLogout）会跳到 /account/login，统一转为 OIDC 退出 */
const AccountLoginRedirect = () => {
  useEffect(() => {
    clearLoginMailSync();
    getOidcClient().logout();
  }, []);
  return null;
};

const App = createWithRemoteLoader({
  modules: ['components-core:Global', 'components-admin:Authenticate@AfterUserLoginLayout', 'components-admin:Authenticate@AfterAdminUserLoginLayout']
})(({ remoteModules, globalPreset }) => {
  const [Global, AfterUserLoginLayout, AfterAdminUserLoginLayout] = remoteModules;
  const baseUrl = '';
  const systemName = 'micro-mail';
  const isOidcClient = globalPreset.oidcMode === 'central';

  const adminNavigation = {
    base: `${baseUrl}/admin`,
    showIndex: false,
    defaultTitle: systemName,
    list: [
      {
        key: 'task',
        title: '任务管理',
        path: `${baseUrl}/admin/task`
      },
      {
        key: 'tenant',
        title: '租户管理',
        path: `${baseUrl}/admin/tenant`
      },
      {
        key: 'sample',
        title: '示例模块',
        path: `${baseUrl}/admin/sample`
      },
      {
        key: 'user',
        title: '用户管理',
        path: '/admin/user'
      },
      {
        key: 'file',
        title: '文件管理',
        path: `${baseUrl}/admin/file`
      },
      {
        key: 'intl-admin',
        title: '国际化',
        path: `${baseUrl}/admin/intl-admin`
      },
      !isOidcClient && {
        key: 'oidc',
        title: '统一认证',
        path: `${baseUrl}/admin/oidc`
      },
      {
        key: 'message',
        title: '消息管理',
        path: `${baseUrl}/admin/message`
      }
    ].filter(Boolean)
  };

  const routes = [
    {
      path: 'oidc-interaction',
      title: 'Login',
      element: <RemoteLoader module="components-admin:Oidc@Interaction" systemName={systemName} registerUrl={`${baseUrl}/account/register`} forgetUrl={`${baseUrl}/account/forget`} />
    },
    {
      path: 'oidc-callback',
      title: 'Login',
      element: <RemoteLoader module="components-admin:Oidc@Callback" systemName={systemName} />
    },
    {
      path: 'account/login',
      title: 'Login',
      element: <AccountLoginRedirect />
    },
    {
      path: 'account/*',
      title: 'Account',
      element: <RemoteLoader module="components-admin:Account" baseUrl={baseUrl + '/account'} systemName={systemName} />
    },
    {
      path: 'admin/initAdmin',
      title: 'Init Admin',
      element: (
        <Protected>
          <AppChildrenRouter
            element={<AfterUserLoginLayout />}
            list={[
              {
                index: true,
                element: <RemoteLoader module="components-admin:Admin@InitAdmin" />
              }
            ]}
          />
        </Protected>
      )
    },
    {
      path: 'admin/*',
      title: 'Admin',
      element: (
        <Protected>
          <AppChildrenRouter
            errorPage
            notFoundPage
            baseUrl={baseUrl + '/admin'}
            element={<AfterAdminUserLoginLayout navigation={adminNavigation} />}
            list={[
              {
                index: true,
                element: <Navigate to={`${baseUrl}/admin/sample`} replace />
              },
              {
                path: 'tenant/*',
                title: '租户管理',
                element: <RemoteLoader module="components-admin:TenantAdmin" baseUrl={baseUrl + '/admin'} />
              },
              {
                path: 'task/*',
                title: '任务管理',
                element: <RemoteLoader module="components-admin:Task" baseUrl={baseUrl + '/admin'} />
              },
              {
                path: 'file',
                title: '文件管理',
                element: <RemoteLoader module="components-file-manager:FileListPage" />
              },
              {
                path: 'intl-admin/*',
                title: '国际化',
                element: <RemoteLoader module="components-admin:IntlAdmin" baseUrl={baseUrl + '/admin/intl-admin'} />
              },
              !isOidcClient && {
                path: 'oidc/*',
                title: '统一认证',
                element: <RemoteLoader module="components-admin:OidcAdmin" baseUrl={`${baseUrl}/admin/oidc`} />
              },
              {
                path: 'message/*',
                title: '消息管理',
                element: <RemoteLoader module="components-admin:MessageManger" baseUrl={`${baseUrl}/admin/message`} />
              }
            ].filter(Boolean)}
          >
            <Admin baseUrl={baseUrl + '/admin'}>
              <RemoteLoader module="components-admin:Admin" baseUrl={baseUrl + '/admin'} />
            </Admin>
          </AppChildrenRouter>
        </Protected>
      )
    }
  ];

  routes.push({
    path: '*',
    element: <Client baseUrl={baseUrl} />
  });

  return (
    <Global preset={globalPreset} themeToken={globalPreset.themeToken}>
      <AppChildrenRouter errorPage notFoundPage baseUrl={baseUrl} list={routes} />
    </Global>
  );
});

export default App;
