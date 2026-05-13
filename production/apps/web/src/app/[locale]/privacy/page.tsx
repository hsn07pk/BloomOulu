import { LegalPage } from '../_legal/legal-page';

export const revalidate = 300;

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LegalPage slug="legal.privacy" locale={locale} />;
}
