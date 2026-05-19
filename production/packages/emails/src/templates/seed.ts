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
    slug: 'dunning-retry',
    subjectEn: 'Your BloomOulu donation needs your attention',
    subjectFi: 'BloomOulu-lahjoituksesi tarvitsee huomiotasi',
    subjectSv: 'Din BloomOulu-donation behöver din uppmärksamhet',
    mjmlEn: wrap('Your last payment did not go through', "<mj-text>We weren't able to charge your €{{amount}} donation for <strong>{{plantName}}</strong> (attempt {{attempt}} of 3). We'll try again on {{nextRetryAt}}. To update your payment method now, tap below.</mj-text>", { label: 'Update payment', href: '{{managePaymentUrl}}' }),
    mjmlFi: wrap('Edellistä maksua ei voitu vahvistaa', "<mj-text>Emme voineet veloittaa {{amount}} € lahjoitustasi kasvista <strong>{{plantName}}</strong> (yritys {{attempt}}/3). Yritämme uudelleen {{nextRetryAt}}. Voit päivittää maksutapasi nyt alta.</mj-text>", { label: 'Päivitä maksutapa', href: '{{managePaymentUrl}}' }),
    mjmlSv: wrap('Senaste betalningen gick inte igenom', "<mj-text>Vi kunde inte ta betalt för din donation på {{amount}} € för <strong>{{plantName}}</strong> (försök {{attempt}}/3). Vi försöker igen {{nextRetryAt}}. Uppdatera betalsätt nedan.</mj-text>", { label: 'Uppdatera betalsätt', href: '{{managePaymentUrl}}' }),
  },
  {
    slug: 'dunning-paused',
    subjectEn: 'Your BloomOulu adoption is paused',
    subjectFi: 'BloomOulu-adoptiosi on tauolla',
    subjectSv: 'Din BloomOulu-adoption är pausad',
    mjmlEn: wrap('Adoption paused', "<mj-text>After three attempts we still couldn't process your renewal for <strong>{{plantName}}</strong>. Your adoption is paused for 21 days — update your payment method any time from My Garden and we'll resume immediately. After {{cancelsAt}} the adoption will be cancelled.</mj-text>", { label: 'Update payment', href: '{{managePaymentUrl}}' }),
    mjmlFi: wrap('Adoptio tauolla', "<mj-text>Kolmen yrityksen jälkeen emme edelleenkään saaneet vahvistettua uusimista kasvista <strong>{{plantName}}</strong>. Adoptio on tauolla 21 päivää — päivitä maksutapasi oman puutarhasi kautta ja jatkamme heti. {{cancelsAt}} jälkeen adoptio päättyy.</mj-text>", { label: 'Päivitä maksutapa', href: '{{managePaymentUrl}}' }),
    mjmlSv: wrap('Adoption pausad', "<mj-text>Efter tre försök kunde vi fortfarande inte förnya din adoption av <strong>{{plantName}}</strong>. Den är pausad i 21 dagar — uppdatera betalsätt från Min trädgård när som helst så återupptar vi direkt. Efter {{cancelsAt}} avbryts adoptionen.</mj-text>", { label: 'Uppdatera betalsätt', href: '{{managePaymentUrl}}' }),
  },
  {
    slug: 'dunning-cancelled',
    subjectEn: 'Your BloomOulu adoption has ended',
    subjectFi: 'BloomOulu-adoptiosi on päättynyt',
    subjectSv: 'Din BloomOulu-adoption har avslutats',
    mjmlEn: wrap('Adoption cancelled', "<mj-text>Your adoption of <strong>{{plantName}}</strong> has been cancelled after 21 days without a successful payment. Your previous donations are still recognised. Thank you for the support — you can start a new adoption any time.</mj-text>", { label: 'Adopt again', href: '{{adoptUrl}}' }),
    mjmlFi: wrap('Adoptio päättyi', "<mj-text>Adoptiosi kasvista <strong>{{plantName}}</strong> on päättynyt 21 päivän jälkeen ilman onnistunutta maksua. Aiemmat lahjoituksesi ovat edelleen voimassa. Kiitos tuestasi — voit aloittaa uuden adoption milloin tahansa.</mj-text>", { label: 'Adoptoi uudelleen', href: '{{adoptUrl}}' }),
    mjmlSv: wrap('Adoption avslutad', "<mj-text>Din adoption av <strong>{{plantName}}</strong> har avslutats efter 21 dagar utan lyckad betalning. Tidigare donationer kvarstår. Tack för stödet — du kan starta en ny adoption när som helst.</mj-text>", { label: 'Adoptera igen', href: '{{adoptUrl}}' }),
  },
  {
    slug: 'curator-escalation',
    subjectEn: 'AskTheGarden — a visitor is asking for you',
    subjectFi: 'AskTheGarden — vierailija kysyy sinulta',
    subjectSv: 'AskTheGarden — en besökare frågar efter dig',
    mjmlEn: wrap(
      'A visitor needs a curator',
      `<mj-text>{{curatorName}}, AskTheGarden could not answer this question with the corpus we have. A reply within {{slaDays}} working days would be great.</mj-text>
       <mj-text><strong>Question:</strong> {{question}}</mj-text>
       <mj-text><strong>What the bot said:</strong> {{answerText}}</mj-text>
       <mj-text class="muted">Visitor email: {{replyToEmail}} · message id: {{messageId}}</mj-text>`,
    ),
    mjmlFi: wrap(
      'Vierailija pyytää puutarhuria',
      `<mj-text>{{curatorName}}, AskTheGarden ei löytänyt vastausta nykyisestä korpuksestamme. Vastauksesi {{slaDays}} työpäivän kuluessa olisi loistavaa.</mj-text>
       <mj-text><strong>Kysymys:</strong> {{question}}</mj-text>
       <mj-text><strong>Boterin vastaus:</strong> {{answerText}}</mj-text>
       <mj-text class="muted">Vierailijan sähköposti: {{replyToEmail}} · viestin id: {{messageId}}</mj-text>`,
    ),
    mjmlSv: wrap(
      'En besökare behöver trädgårdsmästaren',
      `<mj-text>{{curatorName}}, AskTheGarden hittade inte ett svar i vår korpus. Ett svar inom {{slaDays}} arbetsdagar vore toppen.</mj-text>
       <mj-text><strong>Fråga:</strong> {{question}}</mj-text>
       <mj-text><strong>Botens svar:</strong> {{answerText}}</mj-text>
       <mj-text class="muted">Besökarens e-post: {{replyToEmail}} · meddelande-id: {{messageId}}</mj-text>`,
    ),
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
