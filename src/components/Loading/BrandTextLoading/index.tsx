import { useTranslation } from 'react-i18next';

import styles from './index.module.css';

interface BrandTextLoadingProps {
  debugId: string;
}

const BrandTextLoading = ({ debugId }: BrandTextLoadingProps) => {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || '').toLowerCase();
  const isChinese = language.startsWith('zh');
  const loadingSrc = isChinese
    ? '/brand/masterlion/loading-masterlion-zh.svg'
    : '/brand/masterlion/loading-masterlion-en.svg';

  return (
    <div className={styles.container} data-debug-id={debugId}>
      <div aria-label="Loading" className={styles.brand} role="status">
        <img
          alt={isChinese ? '小宗狮 loading' : 'MasterLion loading'}
          className={styles.brandLoading}
          src={loadingSrc}
        />
      </div>
    </div>
  );
};

export default BrandTextLoading;
