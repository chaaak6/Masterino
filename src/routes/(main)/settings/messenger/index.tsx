import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import { isProductFeatureEnabled } from '@/config/productFeatures';
import MessengerSettings from '@/features/Messenger';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = () => {
  const { t } = useTranslation('setting');
  if (!isProductFeatureEnabled('externalMessaging'))
    return <Navigate replace to={'/settings/provider/newapi'} />;
  return (
    <>
      <SettingHeader title={t('tab.messenger')} />
      <MessengerSettings />
    </>
  );
};

export default Page;
