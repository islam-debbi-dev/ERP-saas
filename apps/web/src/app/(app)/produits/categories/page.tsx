import { titled } from '@/lib/page-metadata';
import { CategoriesManager } from '@/components/products/categories-manager';

export const generateMetadata = titled('categories.title');

export default function CategoriesPage() {
  return <CategoriesManager />;
}
