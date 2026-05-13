/**
 * Email template seed — populated into the EmailTemplate table by the
 * db seed script. Each template is admin-editable from /admin afterwards.
 *
 * MJML is used because it compiles to email-client-safe HTML (Outlook!) and
 * MJML's syntax is friendly to non-technical editors.
 *
 * Interpolation: {{donorName}}, {{amount}}, {{plantName}}, etc.
 */

export interface SeedTemplate {
  slug: string;
  subjectEn: string;
  subjectFi: string;
  subjectSv: string;
  preheaderEn?: string;
  preheaderFi?: string;
  preheaderSv?: string;
  mjmlEn: string;
  mjmlFi: string;
  mjmlSv: string;
}

const wrap = (heading: string, body: string, cta?: { label: string; href: string }) => `<mjml>
  <mj-head>
    <mj-title>${heading}</mj-title>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" color="#1F3C2D" />
    </mj-attributes>
    <mj-style>
      .preheader { display:none !important; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#F4F7EF">
    <mj-section padding="32px 24px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" color="#2D5440">BloomOulu</mj-text>
        <mj-text font-size="11px" color="#777">Oulun yliopiston kasvitieteellinen puutarha · Linnanmaa</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#FFFFFF" padding="32px 24px">
      <mj-column>
        <mj-text font-size="20px" font-weight="700">${heading}</mj-text>
        ${body}
        ${cta ? `<mj-button background-color="#2D5440" color="#FFFFFF" href="${cta.href}" padding-top="20px">${cta.label}</mj-button>` : ''}
      </mj-column>
    </mj-section>
    <mj-section padding="16px 24px">
      <mj-column>
        <mj-text font-size="11px" color="#777">© BloomOulu · 65.0617°N · garden@bloomoulu.fi</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

export const EMAIL_TEMPLATES: ReadonlyArray<SeedTemplate> = [
  {
    slug: 'magic-link',
    subjectEn: 'Your BloomOulu sign-in link',
    subjectFi: 'BloomOulu-kirjautumislinkkisi',
    subjectSv: 'Din inloggningslänk till BloomOulu',
    preheaderEn: 'Open within 15 minutes to sign in.',
    preheaderFi: 'Avaa 15 minuutin sisällä.',
    preheaderSv: 'Öppna inom 15 minuter.',
    mjmlEn: wrap('Sign in to BloomOulu', '<mj-text>Tap the button to sign in. The link expires in 15 minutes.</mj-text>', { label: 'Sign in', href: '{{magicLinkUrl}}' }),
    mjmlFi: wrap('Kirjaudu BloomOulu-palveluun', '<mj-text>Kirjaudu painikkeen kautta. Linkki vanhenee 15 minuutissa.</mj-text>', { label: 'Kirjaudu', href: '{{magicLinkUrl}}' }),
    mjmlSv: wrap('Logga in på BloomOulu', '<mj-text>Logga in via knappen. Länken går ut om 15 minuter.</mj-text>', { label: 'Logga in', href: '{{magicLinkUrl}}' }),
  },
  {
    slug: 'receipt',
    subjectEn: 'Your BloomOulu donation receipt {{receiptNumber}}',
    subjectFi: 'BloomOulu-lahjoituskuittisi {{receiptNumber}}',
    subjectSv: 'Ditt BloomOulu-donationskvitto {{receiptNumber}}',
    mjmlEn: wrap('Thank you, {{donorName}}', '<mj-text>You adopted <strong>{{plantName}}</strong> with a donation of €{{amount}}. Your receipt is attached and stored in your account.</mj-text>', { label: 'View receipt', href: '{{receiptUrl}}' }),
    mjmlFi: wrap('Kiitos, {{donorName}}', '<mj-text>Olet adoptoinut kasvin <strong>{{plantName}}</strong> {{amount}} € lahjoituksella. Kuitti on liitteenä ja tallennettu tilillesi.</mj-text>', { label: 'Avaa kuitti', href: '{{receiptUrl}}' }),
    mjmlSv: wrap('Tack, {{donorName}}', '<mj-text>Du har adopterat <strong>{{plantName}}</strong> med en donation på {{amount}} €. Kvittot bifogas och sparas på ditt konto.</mj-text>', { label: 'Öppna kvitto', href: '{{receiptUrl}}' }),
  },
  {
    slug: 'gift-code',
    subjectEn: 'A plant has been adopted in your name',
    subjectFi: 'Sinulle on adoptoitu kasvi',
    subjectSv: 'En växt har adopterats i ditt namn',
    mjmlEn: wrap('Someone adopted a plant for you', '<mj-text>{{giverName}} adopted <strong>{{plantName}}</strong> in your name. Redeem your gift code <strong>{{giftCode}}</strong> to claim it.</mj-text>', { label: 'Redeem', href: '{{redeemUrl}}' }),
    mjmlFi: wrap('Saat lahjaksi adoptiokasvin', '<mj-text>{{giverName}} adoptoi sinulle kasvin <strong>{{plantName}}</strong>. Lunasta lahjakoodi <strong>{{giftCode}}</strong>.</mj-text>', { label: 'Lunasta', href: '{{redeemUrl}}' }),
    mjmlSv: wrap('Du har fått en adopterad växt i present', '<mj-text>{{giverName}} har adopterat <strong>{{plantName}}</strong> till dig. Lös in din presentkod <strong>{{giftCode}}</strong>.</mj-text>', { label: 'Lös in', href: '{{redeemUrl}}' }),
  },
  {
    slug: 'plaque-ready',
    subjectEn: 'Your plaque is installed',
    subjectFi: 'Laattasi on asennettu',
    subjectSv: 'Din plakett är installerad',
    mjmlEn: wrap('Your plaque is up', '<mj-text>The plaque you sponsored is installed next to <strong>{{plantName}}</strong>. Come visit any time during opening hours.</mj-text>'),
    mjmlFi: wrap('Laattasi on paikallaan', '<mj-text>Tukemasi laatta on asennettu kasvin <strong>{{plantName}}</strong> viereen.</mj-text>'),
    mjmlSv: wrap('Din plakett är på plats', '<mj-text>Din plakett står nu bredvid <strong>{{plantName}}</strong>.</mj-text>'),
  },
  {
    slug: 'payment-not-received',
    subjectEn: 'Could not confirm your BloomOulu donation',
    subjectFi: 'Lahjoitustasi ei voitu varmistaa',
    subjectSv: 'Vi kunde inte bekräfta din donation',
    mjmlEn: wrap('Almost there', '<mj-text>We could not confirm your €{{amount}} donation. Tap below to try again — no charge has been taken.</mj-text>', { label: 'Try again', href: '{{retryUrl}}' }),
    mjmlFi: wrap('Lähes valmis', '<mj-text>Emme voineet vahvistaa {{amount}} € lahjoitusta. Yritä uudelleen — sinulta ei ole veloitettu mitään.</mj-text>', { label: 'Yritä uudelleen', href: '{{retryUrl}}' }),
    mjmlSv: wrap('Nästan klart', '<mj-text>Vi kunde inte bekräfta din donation på {{amount}} €. Försök igen — ingen avgift har dragits.</mj-text>', { label: 'Försök igen', href: '{{retryUrl}}' }),
  },
  {
    slug: 'renewal-reminder',
    subjectEn: 'Your adoption renews in 7 days',
    subjectFi: 'Adoptiosi uusiutuu 7 päivän kuluttua',
    subjectSv: 'Din adoption förnyas om 7 dagar',
    mjmlEn: wrap('Renewal coming up', '<mj-text>Your adoption of <strong>{{plantName}}</strong> renews on {{renewsAt}} for €{{amount}}. If you want to change tier or cancel, do so any time from My Garden.</mj-text>', { label: 'Manage', href: '{{gardenUrl}}' }),
    mjmlFi: wrap('Adoptiosi uusiutuu', '<mj-text>Adoptiosi <strong>{{plantName}}</strong> uusiutuu {{renewsAt}} hintaan {{amount}} €. Voit muuttaa tasoa tai perua oman puutarhasi kautta.</mj-text>', { label: 'Hallinnoi', href: '{{gardenUrl}}' }),
    mjmlSv: wrap('Förnyelse på gång', '<mj-text>Din adoption av <strong>{{plantName}}</strong> förnyas {{renewsAt}} för {{amount}} €. Du kan ändra eller avbryta från Min trädgård.</mj-text>', { label: 'Hantera', href: '{{gardenUrl}}' }),
  },
  {
    slug: 'gdpr-export-ready',
    subjectEn: 'Your data export is ready',
    subjectFi: 'Tietoluovutuksesi on valmis',
    subjectSv: 'Din dataexport är klar',
    mjmlEn: wrap('Your GDPR data export', '<mj-text>You requested a copy of your data. The download link is valid for {{expiresInHours}} hours.</mj-text>', { label: 'Download', href: '{{url}}' }),
    mjmlFi: wrap('GDPR-tietoluovutuksesi', '<mj-text>Pyysit kopion tiedoistasi. Latauslinkki on voimassa {{expiresInHours}} tuntia.</mj-text>', { label: 'Lataa', href: '{{url}}' }),
    mjmlSv: wrap('Din GDPR-export', '<mj-text>Du begärde en kopia av dina uppgifter. Länken är giltig i {{expiresInHours}} timmar.</mj-text>', { label: 'Ladda ned', href: '{{url}}' }),
  },
  {
    slug: 'annual-tax-cert',
    subjectEn: 'Your annual donation tax certificate',
    subjectFi: 'Vuosittainen verotodistuksesi',
    subjectSv: 'Din årliga skatteintyg',
    mjmlEn: wrap('Your {{taxYear}} tax certificate', '<mj-text>Your total donations of €{{total}} for {{taxYear}} are summarised in the attached certificate (TVL §57 / 2026 individual donor scheme).</mj-text>', { label: 'Open', href: '{{url}}' }),
    mjmlFi: wrap('Verotodistus vuodelta {{taxYear}}', '<mj-text>Lahjoituksesi yhteensä {{total}} € vuonna {{taxYear}} on koottu liitteenä olevaan todistukseen (TVL §57 / vuoden 2026 yksityishenkilön vähennysjärjestelmä).</mj-text>', { label: 'Avaa', href: '{{url}}' }),
    mjmlSv: wrap('Skatteintyg för {{taxYear}}', '<mj-text>Din totala donation på {{total}} € för {{taxYear}} sammanfattas i det bifogade intyget.</mj-text>', { label: 'Öppna', href: '{{url}}' }),
  },
];
