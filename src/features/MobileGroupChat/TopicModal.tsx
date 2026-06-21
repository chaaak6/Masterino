'use client';

import { Modal } from '@lobehub/ui';
import { type PropsWithChildren, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { OverlayContainerContext } from '@/features/NavPanel/OverlayContainer';
import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const TopicModal = memo(({ children }: PropsWithChildren) => {
  const [showTopic, toggleTopic] = useGlobalStore((s) => [
    systemStatusSelectors.mobileShowTopic(s),
    s.toggleMobileTopic,
  ]);
  const [open, setOpen] = useWorkspaceModal(showTopic, toggleTopic);
  const { t } = useTranslation('topic');
  const [overlayContainer, setOverlayContainer] = useState<HTMLDivElement | null>(null);

  return (
    <OverlayContainerContext value={overlayContainer}>
      <Modal
        allowFullscreen
        footer={null}
        open={open}
        title={t('title')}
        styles={{
          body: { padding: 0 },
        }}
        onCancel={() => setOpen(false)}
      >
        <div ref={setOverlayContainer} style={{ height: '100%' }}>
          {children}
        </div>
      </Modal>
    </OverlayContainerContext>
  );
});

TopicModal.displayName = 'MobileGroupChatTopicModal';

export default TopicModal;
