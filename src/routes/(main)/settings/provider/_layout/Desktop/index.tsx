import { Flexbox } from '@lobehub/ui';
import { type PropsWithChildren } from 'react';

import Container from './Container';
import { styles } from './style';

const Layout = ({
  children,
  onProviderSelect: _onProviderSelect,
}: PropsWithChildren & {
  onProviderSelect: (providerKey: string) => void;
}) => {
  return (
    <Flexbox className={styles.mainContainer} width={'100%'}>
      <Container>{children}</Container>
    </Flexbox>
  );
};
export default Layout;
