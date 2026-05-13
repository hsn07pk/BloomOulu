import type { PrismaClient } from '@prisma/client';

/**
 * Seed UI translations. The web app's static i18n bundles are the canonical
 * default, but every key is also editable from the admin panel via this table.
 * On boot the API checks for runtime overrides and merges them into the
 * bundle response.
 */

const KEYS: Array<{ key: string; en: string; fi: string; sv: string; context?: string }> = [
  { key: 'Home.heroTitle', en: 'Turning every plant into a story, a supporter, and a step toward saving Finnish flora.', fi: 'Jokaisesta kasvista tarina, tukija ja askel suomalaisen lajiston suojelemiseksi.', sv: 'Varje växt en berättelse, en stödjare, ett steg för att rädda den finska floran.', context: 'Hero headline on the homepage' },
  { key: 'Home.heroLead', en: 'Adopt a plant. Save a species.', fi: 'Adoptoi kasvi. Pelasta laji.', sv: 'Adoptera en växt. Rädda en art.', context: 'Sub-headline on the homepage' },
  { key: 'Home.featured', en: 'Featured plants', fi: 'Kuukauden kasvit', sv: 'Månadens växter' },
  { key: 'Plant.story', en: 'Story', fi: 'Tarina', sv: 'Berättelse' },
  { key: 'Plant.adoptCta', en: 'Adopt this plant', fi: 'Adoptoi tämä kasvi', sv: 'Adoptera den här växten' },
  { key: 'Adopt.title', en: 'Adopt a plant', fi: 'Adoptoi kasvi', sv: 'Adoptera en växt' },
  { key: 'Adopt.tier', en: 'Tier', fi: 'Tukitasot', sv: 'Nivå' },
  { key: 'Adopt.tier_seedling', en: 'Seedling · €25', fi: 'Siemen · 25 €', sv: 'Frö · 25 €' },
  { key: 'Adopt.tier_rooted', en: 'Rooted · €75', fi: 'Juurtunut · 75 €', sv: 'Rotad · 75 €' },
  { key: 'Adopt.tier_vulnerable', en: 'Vulnerable · €250', fi: 'Vaarantunut · 250 €', sv: 'Sårbar · 250 €' },
  { key: 'Adopt.tier_endangered', en: 'Endangered · €750', fi: 'Erittäin uhanalainen · 750 €', sv: 'Starkt hotad · 750 €' },
  { key: 'Adopt.billing', en: 'Billing interval', fi: 'Laskutusväli', sv: 'Faktureringsintervall' },
  { key: 'Adopt.annual', en: 'Annual', fi: 'Vuosittain', sv: 'Årligen' },
  { key: 'Adopt.monthly', en: 'Monthly', fi: 'Kuukausittain', sv: 'Månadsvis' },
  { key: 'Adopt.paymentMethod', en: 'Payment method', fi: 'Maksutapa', sv: 'Betalningssätt' },
  { key: 'Adopt.card', en: 'Card / bank (Paytrail)', fi: 'Kortti / pankki (Paytrail)', sv: 'Kort / bank (Paytrail)' },
  { key: 'Adopt.bankTransfer', en: 'Bank transfer (RF reference, zero fees)', fi: 'Tilisiirto (RF-viite, ei kuluja)', sv: 'Bankgiro (RF-referens, inga avgifter)' },
  { key: 'Adopt.donor', en: 'Your details', fi: 'Tiedot', sv: 'Dina uppgifter' },
  { key: 'Adopt.email', en: 'Email', fi: 'Sähköposti', sv: 'E-post' },
  { key: 'Adopt.name', en: 'Name (optional)', fi: 'Nimi (vapaaehtoinen)', sv: 'Namn (valfritt)' },
  { key: 'Adopt.submit', en: 'Continue to payment', fi: 'Jatka maksuun', sv: 'Fortsätt till betalning' },
  { key: 'Garden.title', en: 'My Garden', fi: 'Oma puutarhani', sv: 'Min trädgård' },
  { key: 'Garden.adoptions', en: 'My adoptions', fi: 'Adoptioni', sv: 'Mina adoptioner' },
  { key: 'Garden.receipts', en: 'Receipts', fi: 'Kuitit', sv: 'Kvitton' },
  { key: 'Garden.taxCertificates', en: 'Tax certificates', fi: 'Verotodistukset', sv: 'Skatteintyg' },
  { key: 'Ask.title', en: 'Ask the Garden', fi: 'Kysy puutarhalta', sv: 'Fråga trädgården' },
  { key: 'Ask.placeholder', en: 'Ask in any language…', fi: 'Kysy millä kielellä tahansa…', sv: 'Fråga på vilket språk som helst…' },
  { key: 'Ask.send', en: 'Send', fi: 'Lähetä', sv: 'Skicka' },
  { key: 'A11y.skipLink', en: 'Skip to main content', fi: 'Hyppää sisältöön', sv: 'Hoppa till innehållet' },
  { key: 'A11y.largerText', en: 'Larger text', fi: 'Suurempi teksti', sv: 'Större text' },
  { key: 'A11y.highContrast', en: 'High contrast', fi: 'Suuri kontrasti', sv: 'Hög kontrast' },
  { key: 'A11y.reducedMotion', en: 'Reduce motion', fi: 'Vähemmän liikettä', sv: 'Mindre rörelse' },
  { key: 'Pay.bankInstructions.title', en: 'Pay by bank transfer', fi: 'Maksa tilisiirrolla', sv: 'Betala via bankgiro' },
  { key: 'Pay.bankInstructions.openBankApp', en: 'Open your banking app and use this RF reference exactly as shown.', fi: 'Avaa pankkisi sovellus ja käytä tätä RF-viitettä juuri tällaisena.', sv: 'Öppna din bankapp och använd denna RF-referens exakt som visad.' },
  { key: 'Pay.bankInstructions.iban', en: 'IBAN', fi: 'IBAN', sv: 'IBAN' },
  { key: 'Pay.bankInstructions.bic', en: 'BIC', fi: 'BIC', sv: 'BIC' },
  { key: 'Pay.bankInstructions.reference', en: 'Reference', fi: 'Viite', sv: 'Referens' },
  { key: 'Pay.bankInstructions.amount', en: 'Amount', fi: 'Summa', sv: 'Belopp' },
  { key: 'Footer.dpo', en: 'Data Protection Officer', fi: 'Tietosuojavastaava', sv: 'Dataskyddsombud' },
  { key: 'Footer.accessibilityStatement', en: 'Accessibility statement', fi: 'Saavutettavuusseloste', sv: 'Tillgänglighetsutlåtande' },
  { key: 'Footer.privacy', en: 'Privacy', fi: 'Tietosuoja', sv: 'Integritet' },
  { key: 'Footer.cookies', en: 'Cookies', fi: 'Evästeet', sv: 'Kakor' },
];

export async function seedTranslations(prisma: PrismaClient) {
  for (const t of KEYS) {
    await prisma.translation.upsert({
      where: { i18nKey: t.key },
      create: { i18nKey: t.key, en: t.en, fi: t.fi, sv: t.sv, context: t.context ?? null },
      update: { en: t.en, fi: t.fi, sv: t.sv, context: t.context ?? null },
    });
  }
}
