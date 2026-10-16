import { createWithRemoteLoader } from '@kne/remote-loader';
import AppChildrenRouter from '@kne/app-children-router';
import { Page } from '@kne/system-layout';
import ClientLayout from './Layout';

const renderPage = ({ title, children }) => <Page title={title}>{children}</Page>;

const Client = createWithRemoteLoader({
  modules: ['components-admin:MailGateway']
})(({ remoteModules, baseUrl }) => {
  const [MailGateway] = remoteModules;

  return (
    <AppChildrenRouter errorPage baseUrl={baseUrl} element={<ClientLayout baseUrl={baseUrl} />}>
      <MailGateway baseUrl={baseUrl} renderPage={renderPage} />
    </AppChildrenRouter>
  );
});

export default Client;
