import { Button, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MOBILE_CREATE_COMING_SOON_KEY,
  MobileCreateComingSoonLabel,
} from '@/features/MobileHome/mobileCreate';
import { useServerConfigStore } from '@/store/serverConfig';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    width: 100%;
  `,
}));

const AddButton = memo<{ groupId?: string }>(() => {
  const { t } = useTranslation('chat');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const comingSoon = t(MOBILE_CREATE_COMING_SOON_KEY);

  return (
    <Flexbox flex={1} padding={mobile ? 16 : 0}>
      <Button
        block
        disabled
        icon={Plus}
        variant={'filled'}
        style={{
          marginTop: 8,
        }}
      >
        <div className={styles.label}>
          <MobileCreateComingSoonLabel comingSoon={comingSoon} label={t('newAgent')} />
        </div>
      </Button>
    </Flexbox>
  );
});

export default AddButton;
