import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';

const AihubProviderDetail = dynamic(() => import('./newapi'), {
  loading: () => <Loading debugId="Provider > Aihub" />,
  ssr: false,
});

type ProviderDetailPageProps = {
  id?: string | null;
  onProviderSelect: (provider: string) => void;
};

const ProviderDetailPage = (_props: ProviderDetailPageProps) => {
  return <AihubProviderDetail />;
};

export default ProviderDetailPage;
