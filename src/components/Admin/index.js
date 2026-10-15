import AppChildrenRouter from '@kne/app-children-router';
import { createWithRemoteLoader } from '@kne/remote-loader';

const Admin = createWithRemoteLoader({
  modules: ['components-core:Global@usePreset']
})(({ remoteModules, baseUrl, ...props }) => {
  const [usePreset] = remoteModules;
  const { apis } = usePreset();

  return (
    <AppChildrenRouter
      {...props}
      baseUrl={baseUrl}
      list={[
        {
          path: 'sample',
          title: '示例模块',
          loader: () => import('@components/Sample').then(({ AdminSample }) => AdminSample),
          elementProps: {
            apis: apis.sample,
            baseUrl
          }
        }
      ]}
    />
  );
});

export default Admin;
