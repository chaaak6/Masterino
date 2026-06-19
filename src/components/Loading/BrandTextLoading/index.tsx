import { ProductLogo } from '@/components/Branding/ProductLogo';

import CircleLoading from '../CircleLoading';
import styles from './index.module.css';

interface BrandTextLoadingProps {
  debugId: string;
}

const BrandTextLoading = ({ debugId }: BrandTextLoadingProps) => {
  return (
    <div className={styles.container} data-debug-id={debugId}>
      <div aria-label="Loading" className={styles.brand} role="status">
        <ProductLogo size={40} type="combine" />
      </div>
      <CircleLoading />
    </div>
  );
};

export default BrandTextLoading;
