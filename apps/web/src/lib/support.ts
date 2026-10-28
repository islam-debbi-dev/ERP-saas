/**
 * Support links (phase 13), set per deployment. Each link is hidden while its
 * variable is empty, so nothing broken ever shows. NEXT_PUBLIC_* values are inlined at
 * build time, hence one literal `process.env.X` per variable.
 */
const whatsappNumber = (process.env['NEXT_PUBLIC_SUPPORT_WHATSAPP'] ?? '').replace(/\D/g, '');

/** wa.me link, with an optional pre-filled message. Null when no number is configured. */
export function whatsappLink(message?: string): string | null {
  if (!whatsappNumber) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${whatsappNumber}${text}`;
}

export type TutorialKey =
  'tutorialFirstSteps' | 'tutorialImport' | 'tutorialSale' | 'tutorialVersement';

const TUTORIALS: { key: TutorialKey; url: string | undefined }[] = [
  { key: 'tutorialFirstSteps', url: process.env['NEXT_PUBLIC_TUTORIAL_FIRST_STEPS_URL'] },
  { key: 'tutorialImport', url: process.env['NEXT_PUBLIC_TUTORIAL_IMPORT_URL'] },
  { key: 'tutorialSale', url: process.env['NEXT_PUBLIC_TUTORIAL_SALE_URL'] },
  { key: 'tutorialVersement', url: process.env['NEXT_PUBLIC_TUTORIAL_VERSEMENT_URL'] },
];

/** The tutorials that have a URL. */
export function tutorials(): { key: TutorialKey; url: string }[] {
  return TUTORIALS.filter((t): t is { key: TutorialKey; url: string } => Boolean(t.url));
}
