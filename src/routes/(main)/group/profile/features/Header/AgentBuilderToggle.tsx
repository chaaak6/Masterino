import { ActionIcon } from '@lobehub/ui';
import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGroupProfileStore } from '@/store/groupProfile';

const AgentBuilderToggle = memo(() => {
  const { t } = useTranslation('components');
  const chatPanelExpanded = useGroupProfileStore((s) => s.chatPanelExpanded);
  const setChatPanelExpanded = useGroupProfileStore((s) => s.setChatPanelExpanded);

  return (
    <ActionIcon
      active={chatPanelExpanded}
      aria-label={t('agentBuilder', { ns: 'components' })}
      icon={BotMessageSquareIcon}
      size={DESKTOP_HEADER_ICON_SIZE}
      title={t('agentBuilder', { ns: 'components' })}
      onClick={() => setChatPanelExpanded((prev) => !prev)}
    />
  );
});

export default AgentBuilderToggle;
