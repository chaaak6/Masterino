import { createStaticStyles } from 'antd-style';
import { CircleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAiInfraStore } from '@/store/aiInfra';

const styles = createStaticStyles(({ css, cssVar }) => ({
  warning: css`
    display: inline-flex;
    flex-shrink: 0;
    color: ${cssVar.colorWarning};
  `,
}));

export default function ModelAvailabilityWarning({
  model,
  provider,
}: {
  model?: string;
  provider?: string;
}) {
  const { t } = useTranslation('components');
  const unavailable = useAiInfraStore(
    (s) =>
      provider === 'newapi' &&
      !!model &&
      !!s.silentModelCatalog &&
      !s.silentModelCatalog.models.some((item) => item.id === model),
  );
  if (!unavailable) return null;
  const label = t('ModelSwitchPanel.detail.managed.unavailable');
  return (
    <span aria-label={label} className={styles.warning} role="status" title={label}>
      <CircleAlertIcon size={12} />
    </span>
  );
}
