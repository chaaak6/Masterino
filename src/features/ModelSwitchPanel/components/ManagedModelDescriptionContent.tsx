import { ManagedModelDescriptionSchema } from '@lobechat/types';
import { Accordion, AccordionItem, Flexbox, Tag } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
}));
export default function ManagedModelDescriptionContent({ description }: { description: unknown }) {
  const { t } = useTranslation('components');
  const parsed = ManagedModelDescriptionSchema.safeParse(description);
  if (!parsed.success) return null;
  const value = parsed.data;
  return (
    <Accordion>
      <AccordionItem
        itemKey="managedDescription"
        title={t('ModelSwitchPanel.detail.managed.title')}
      >
        <Flexbox className={styles.content} gap={8}>
          {value.organization && <span>{value.organization}</span>}
          {value.description && <span>{value.description}</span>}
          <span>
            {t('ModelSwitchPanel.detail.context')}：
            {value.contextWindowTokens?.toLocaleString() ??
              t('ModelSwitchPanel.detail.managed.unknown')}{' '}
            tokens
          </span>
          <span>
            {t('ModelSwitchPanel.detail.managed.maxOutput')}：
            {value.maxOutput?.toLocaleString() ?? t('ModelSwitchPanel.detail.managed.unknown')}
          </span>
          {value.limitations && (
            <span>
              {t('ModelSwitchPanel.detail.managed.limitations')}：{value.limitations}
            </span>
          )}
          <Flexbox horizontal gap={4} wrap={'wrap'}>
            {(['text', 'image'] as const).map((key) => (
              <Tag key={`input-${key}`}>
                {t(`ModelSwitchPanel.detail.managed.${key}Input` as any)}：
                {t(`ModelSwitchPanel.detail.managed.${value.inputModalities[key]}` as any)}
              </Tag>
            ))}
            <Tag>
              {t('ModelSwitchPanel.detail.managed.functionCall')}：
              {t(`ModelSwitchPanel.detail.managed.${value.capabilities.functionCall}` as any)}
            </Tag>
          </Flexbox>
          {value.referencePricing && (
            <span>
              {t('ModelSwitchPanel.detail.managed.referencePrice')} ·{' '}
              {value.referencePricing.currency} /{' '}
              {t('ModelSwitchPanel.detail.managed.millionTokens')}
              <br />
              {t('ModelSwitchPanel.detail.managed.input')}：{value.referencePricing.input ?? '—'} ·{' '}
              {t('ModelSwitchPanel.detail.managed.output')}：{value.referencePricing.output ?? '—'}
              <br />
              {t('ModelSwitchPanel.detail.managed.source')}：{value.referencePricing.source}
            </span>
          )}
          {value.sourceUrl && (
            <a href={value.sourceUrl} rel="noreferrer" target="_blank">
              {t('ModelSwitchPanel.detail.managed.source')}
            </a>
          )}
        </Flexbox>
      </AccordionItem>
    </Accordion>
  );
}
