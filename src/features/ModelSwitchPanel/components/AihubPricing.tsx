import { AccordionItem, Flexbox } from '@lobehub/ui';
import type { AihubDisplayPricing, AihubPriceUnit } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const keys: AihubPriceUnit[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'request'];
const money = (amount: number) => {
  if (amount > 0 && amount < 0.01) return '< ¥0.01';
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
};

const AihubPricing = memo<{ pricing?: AihubDisplayPricing }>(({ pricing }) => {
  const { t } = useTranslation('components');
  const label = (key: string) => t(`ModelSwitchPanel.aihubPricing.${key}` as any);
  const rates = pricing?.displayRates;
  return (
    <AccordionItem
      alwaysShowAction
      itemKey="pricing"
      paddingBlock={6}
      paddingInline={8}
      title={t('ModelSwitchPanel.detail.pricing')}
      action={
        <span style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
          {label('currency')}
        </span>
      }
    >
      <Flexbox gap={8} style={{ padding: '0 8px', fontSize: 12 }}>
        {!pricing || pricing.stale || pricing.status !== 'available' ? (
          <span>{label('unavailable')}</span>
        ) : !rates || !Object.keys(rates).length ? (
          <span>{label('unavailable')}</span>
        ) : (
          keys
            .filter((key) => rates[key] !== undefined)
            .map((key) => {
              const rate = rates[key]!;
              const minimum = money(rate.min);
              const maximum = money(rate.max);
              return (
                <Flexbox horizontal gap={12} justify="space-between" key={key}>
                  <span>{label(key)}</span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {minimum}
                    {minimum !== maximum && `–${maximum}`}{' '}
                    {label(key === 'request' ? 'perRequest' : 'perMillion')}
                  </span>
                </Flexbox>
              );
            })
        )}
      </Flexbox>
    </AccordionItem>
  );
});

export default AihubPricing;
