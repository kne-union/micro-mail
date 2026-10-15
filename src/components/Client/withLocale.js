import { createWithIntlProvider } from '@kne/react-intl';
import zhCN from './locale/zh-CN';
import enUS from './locale/en-US';

export default createWithIntlProvider({
  defaultLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, 'en-US': enUS }
});
