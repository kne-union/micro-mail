import { Page as SystemPage } from '@kne/system-layout';
import { createWithRemoteLoader } from '@kne/remote-loader';
import withLocale from './withLocale';
import { useIntl } from '@kne/react-intl';
import getColumns from './getColumns';
import FormInner from './FormInner';

const PortalSample = createWithRemoteLoader({
  modules: ['components-admin:BizUnit', 'components-core:Table@TablePage', 'components-core:Layout@Page']
})(
  withLocale(({ remoteModules, apis, layoutType = 'system-layout' }) => {
    const [BizUnit, TablePage, CorePage] = remoteModules;
    const { formatMessage } = useIntl();
    const Page = layoutType === 'layout' ? CorePage : SystemPage;

    return (
      <BizUnit
        isNext
        name="portal-sample-list"
        apis={apis}
        getColumns={() => getColumns({ formatMessage })}
        getFormInner={({ action }) => <FormInner action={action} />}
        options={{
          bizName: formatMessage({ id: 'SampleBizName' }),
          keywordFilterName: 'name',
          keywordFilterLabel: formatMessage({ id: 'SampleKeywordLabel' }),
          createButtonProps: { children: formatMessage({ id: 'SampleCreate' }), type: 'primary' },
          editButtonProps: { children: formatMessage({ id: 'SampleEdit' }) },
          removeButtonProps: { children: formatMessage({ id: 'SampleRemove' }) },
          removeMessage: formatMessage({ id: 'SampleRemoveMessage' })
        }}
      >
        {({ titleExtra, tableOptions }) => (
          <Page title={formatMessage({ id: 'SampleTitle' })} extra={titleExtra}>
            <TablePage {...tableOptions} />
          </Page>
        )}
      </BizUnit>
    );
  })
);

export default PortalSample;
