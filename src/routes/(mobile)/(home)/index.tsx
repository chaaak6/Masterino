import { memo, Suspense } from 'react';

import MobileHome from '@/features/MobileHome';

import MobileLayout from './_layout/MobileLayout';
import SessionHydration from './_layout/SessionHydration';
import SkeletonList from './features/SkeletonList';

const Home = memo(() => {
  return (
    <>
      <MobileLayout>
        <Suspense fallback={<SkeletonList />}>
          <MobileHome />
        </Suspense>
      </MobileLayout>
      <SessionHydration />
    </>
  );
});

Home.displayName = 'MobileHome';

export default Home;
