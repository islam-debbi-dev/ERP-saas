import { ImportFilesList } from '@/components/import-files/import-files-list';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.importFiles');

export default function ImportFilesPage() {
  return <ImportFilesList />;
}
