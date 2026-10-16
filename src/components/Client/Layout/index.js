import { createWithRemoteLoader } from '@kne/remote-loader';
import { Outlet } from 'react-router-dom';
import { LogoutOutlined } from '@ant-design/icons';

import SystemLayout from '@kne/system-layout';
import '@kne/system-layout/dist/index.css';

import withLocale from '../withLocale';
import { useIntl } from '@kne/react-intl';

const Layout = createWithRemoteLoader({
  modules: ['components-admin:Authenticate@AfterUserLogin', 'components-core:Global@GlobalValue', 'components-admin:MailGateway@getMenuItems', 'components-admin:Account@useLogout', 'components-admin:Account@Language']
})(
  withLocale(({ remoteModules, baseUrl, children }) => {
    const [AfterUserLogin, GlobalValue, getMenuItems, useLogout, Language] = remoteModules;
    const { locale, formatMessage } = useIntl();
    const logout = useLogout();

    return (
      <AfterUserLogin>
        <GlobalValue globalKey="userInfo">
          {({ value }) => {
            const userInfo = value?.value;
            return (
              <SystemLayout
                userInfo={Object.assign({}, userInfo, { extra: <Language /> })}
                background={'linear-gradient(180deg, #E8DCDF, #E1D1E3, #DED7EF, #D5E0F1)'}
                menu={{
                  base: baseUrl,
                  items: [
                    ...getMenuItems({ locale }),
                    {
                      group: 'account',
                      groupLabel: formatMessage({ id: 'ClientMenuAccount' }),
                      label: formatMessage({ id: 'ClientMenuLogout' }),
                      icon: <LogoutOutlined />,
                      onClick: logout
                    }
                  ]
                }}
              >
                {children || <Outlet />}
              </SystemLayout>
            );
          }}
        </GlobalValue>
      </AfterUserLogin>
    );
  })
);

export default Layout;
