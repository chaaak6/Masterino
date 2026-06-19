import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';

const AihubProviderDetail = dynamic(() => import('./newapi'), {
  loading: () => <Loading debugId="Provider > Aihub" />,
  ssr: false,
});
const ProviderGrid = dynamic(() => import('../(list)/ProviderGrid'), {
  loading: () => <Loading debugId="Provider > Grid" />,
  ssr: false,
});

type ProviderDetailPageProps = {
  id?: string | null;
  onProviderSelect: (provider: string) => void;
};

const ProviderDetailPage = (props: ProviderDetailPageProps) => {
  const { id, onProviderSelect } = props;

  switch (id) {
    case 'all': {
      return <ProviderGrid onProviderSelect={onProviderSelect} />;
    }
    case 'newapi': {
      return <AihubProviderDetail />;
    }
    default: {
      return <AihubProviderDetail />;
    }
  }
};

export default ProviderDetailPage;
