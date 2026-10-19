import { ImportPage } from '@/components/imports/import-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('imports.title');

export default function Page() {
  return <ImportPage />;
}
