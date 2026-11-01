import { ImportFileDetail } from '@/components/import-files/import-file-detail';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.importFiles');

export default async function ImportFileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ImportFileDetail id={id} />;
}
