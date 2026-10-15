import { createWithRemoteLoader } from '@kne/remote-loader';
import { Outlet } from 'react-router-dom';

import SystemLayout from '@kne/system-layout';
import '@kne/system-layout/dist/index.css';

import withLocale from '../withLocale';
import { useIntl } from '@kne/react-intl';

const Layout = createWithRemoteLoader({
  modules: [
    'components-admin:Authenticate@AfterUserLoginLayout',
    'components-core:Global@GlobalValue'
  ]
})(
  withLocale(({ remoteModules, baseUrl, children }) => {
    const [AfterUserLoginLayout, GlobalValue] = remoteModules;
    const { formatMessage } = useIntl();

    return (
      <AfterUserLoginLayout>
        <GlobalValue globalKey="userInfo">
          {({ value }) => {
            const userInfo = value?.value;
            return (

              <SystemLayout
                userInfo={userInfo}
                background={'linear-gradient(180deg, #E8DCDF, #E1D1E3, #DED7EF, #D5E0F1)'}
                menu={{
                  base: baseUrl,
                  items: [
                    {
                      path: '/',
                      label: formatMessage({ id: 'ClientAdminHome' }),
                      toolbar: true,
                      icon: 'home'
                    },
                    {
                      path: '/sample',
                      label: formatMessage({ id: 'ClientAdminSample' }),
                      toolbar: true,
                      icon: 'assignment'
                    }
                  ]
                }}
              >
                {children || <Outlet />}
              </SystemLayout>

            );
          }}
        </GlobalValue>
      </AfterUserLoginLayout>
    );
  })
);

export default Layout;
