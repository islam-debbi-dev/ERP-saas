import { ClosingScreen } from '@/components/tournees/closing-screen';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('tournees.closingTitle');

export default function ClosingPage() {
  return <ClosingScreen />;
}
