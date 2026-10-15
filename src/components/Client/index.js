import { createWithRemoteLoader } from '@kne/remote-loader';
import AppChildrenRouter from '@kne/app-children-router';
import withLocale from './withLocale';
import { useIntl } from '@kne/react-intl';
import ClientLayout from './Layout';

const Client = createWithRemoteLoader({
  modules: ['components-core:Global@usePreset']
})(
  withLocale(({ remoteModules, baseUrl }) => {
    const [usePreset] = remoteModules;
    const { apis } = usePreset();
    const { formatMessage } = useIntl();

    return (
      <AppChildrenRouter
        errorPage
        notFoundPage
        baseUrl={baseUrl}
        element={<ClientLayout baseUrl={baseUrl} />}
        list={[
          {
            index: true,
            title: formatMessage({ id: 'ClientAdminHome' }),
            loader: () => import('./Home')
          },
          {
            path: 'sample',
            title: formatMessage({ id: 'ClientAdminSample' }),
            loader: () => import('@components/Sample').then(({ ClientAdminSample }) => ClientAdminSample),
            elementProps: {
              apis: apis.sample,
              baseUrl,
              layoutType: 'system-layout'
            }
          }
        ]}
      />
    );
  })
);

export default Client;
