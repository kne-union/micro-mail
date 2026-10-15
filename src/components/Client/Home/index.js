
import { Page } from '@kne/system-layout';
import { Typography } from 'antd';
import withLocale from '../withLocale';
import { useIntl } from '@kne/react-intl';

const { Paragraph } = Typography;

const Home = withLocale(() => {
  const { formatMessage } = useIntl();

  return (
    <Page title={formatMessage({ id: 'ClientAdminHomeTitle' })}>
      <Paragraph>{formatMessage({ id: 'ClientAdminHomeDescription' })}</Paragraph>
    </Page>
  );
});

export default Home;

