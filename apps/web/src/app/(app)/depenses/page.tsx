import { ExpensesPage } from '@/components/expenses/expenses-page';
import { titled } from '@/lib/page-metadata';

export const generateMetadata = titled('nav.expenses');

export default function Page() {
  return <ExpensesPage />;
}
