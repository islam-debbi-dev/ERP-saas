import { RouteEditor } from '@/components/tournees/route-editor';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('tournees.title');

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RouteEditor id={id} />;
}
