import { WithoutCommuneList } from '@/components/clients/without-commune-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('withoutCommune.title');

export default function Page() {
  return <WithoutCommuneList />;
}
