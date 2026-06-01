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

// Org identity for the masthead/footer + CTA host is env-driven (the same
// GARDEN_* / NEXT_PUBLIC_GARDEN_NAME_EN / NEXT_PUBLIC_WEB_URL the rest of the
// app uses) so a new instance never edits template code. Read at seed time;
// each template stays admin-editable afterwards.
const BRAND = (process.env.NEXT_PUBLIC_GARDEN_NAME_EN ?? 'BloomOulu').split('—')[0]!.trim();
const ORG_NAME = process.env.GARDEN_ORG_NAME ?? 'Oulun yliopiston kasvitieteellinen puutarha';
const ORG_EMAIL = process.env.GARDEN_CONTACT_EMAIL ?? 'garden@bloomoulu.fi';
const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

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
        <mj-text font-size="22px" font-weight="700" color="#2D5440">${BRAND}</mj-text>
        <mj-text font-size="11px" color="#777">${ORG_NAME}</mj-text>
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
        <mj-text font-size="11px" color="#777">© ${BRAND} · ${ORG_EMAIL}</mj-text>
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
  // ── Recurring-benefit emails ─────────────────────────────────────────
  // Triggered by the recurring-benefits worker every cadenceMonths. Each
  // benefit type has its own template so the donor sees a thoughtful,
  // contextually relevant note rather than a generic "your perk is here".
  {
    slug: 'quarterly-notes',
    subjectEn: 'Quarterly grower’s notes from BloomOulu',
    subjectFi: 'Kasvattajan vuosineljänneskuulumiset',
    subjectSv: 'Kvartalsbrev från trädgården',
    mjmlEn: wrap(
      'Quarterly notes · {{plantName}}',
      '<mj-text>Hello {{donorName}},<br/><br/>Your adopted plant, <em>{{plantName}}</em>, is doing well. Our curator has put together a short seasonal note covering what we’ve observed this quarter, including bloom progress, repotting news, and how the broader collection is faring under current conditions.<br/><br/>This quarterly mailing is one of the perks of your {{tierName}} adoption. Thank you for the continued support — every adoption keeps the Garden running.</mj-text>',
      { label: 'Open your plant page', href: WEB_URL + '/en/plants/{{plantSlug}}' },
    ),
    mjmlFi: wrap(
      'Vuosineljänneksen tiedote · {{plantName}}',
      '<mj-text>Hei {{donorName}},<br/><br/>Adoptoimasi kasvi <em>{{plantName}}</em> voi hyvin. Kuraattorimme on koonnut lyhyen kausitiedotteen tämän vuosineljänneksen havainnoista, mukaan lukien kukinnan eteneminen ja uudet havainnot kokoelmassamme.<br/><br/>Tämä vuosineljänneskirje on osa {{tierName}}-tason etujasi. Kiitos jatkuvasta tuestasi.</mj-text>',
      { label: 'Avaa kasvisivu', href: WEB_URL + '/fi/plants/{{plantSlug}}' },
    ),
    mjmlSv: wrap(
      'Kvartalsanteckningar · {{plantName}}',
      '<mj-text>Hej {{donorName}},<br/><br/>Din adopterade växt <em>{{plantName}}</em> mår bra. Vår kurator har sammanställt ett kort säsongsbrev med observationer från detta kvartal.<br/><br/>Detta kvartalsbrev är en av förmånerna i din {{tierName}}-adoption.</mj-text>',
      { label: 'Öppna växtsidan', href: WEB_URL + '/sv/plants/{{plantSlug}}' },
    ),
  },
  {
    slug: 'seasonal-photos',
    subjectEn: 'Seasonal photos of {{plantName}}',
    subjectFi: 'Vuodenaikakuvia kasvistasi {{plantName}}',
    subjectSv: 'Säsongsbilder av {{plantName}}',
    mjmlEn: wrap(
      'Seasonal photos · {{plantName}}',
      '<mj-text>Hello {{donorName}},<br/><br/>A small album of <em>{{plantName}}</em> from this season is now on its story page. Bloom timing, new growth, the angle of the leaves under low winter light — captured at the Garden so you can see what your adoption supports, no matter where you are.<br/><br/>This is a Rooted+ tier perk; the photographs are taken by our curatorial team.</mj-text>',
      { label: 'View the album', href: WEB_URL + '/en/plants/{{plantSlug}}' },
    ),
    mjmlFi: wrap(
      'Vuodenaikakuvia · {{plantName}}',
      '<mj-text>Hei {{donorName}},<br/><br/>Olemme lisänneet kasvisivulle pienen kuva-albumin kasvista <em>{{plantName}}</em> tältä kaudelta. Kukinta, uusi kasvu, lehtien asento talven matalassa valossa.<br/><br/>Tämä on Rooted+-tason etu.</mj-text>',
      { label: 'Avaa albumi', href: WEB_URL + '/fi/plants/{{plantSlug}}' },
    ),
    mjmlSv: wrap(
      'Säsongsbilder · {{plantName}}',
      '<mj-text>Hej {{donorName}},<br/><br/>Vi har lagt till ett litet bildalbum av <em>{{plantName}}</em> från denna säsong på växtsidan.</mj-text>',
      { label: 'Öppna albumet', href: WEB_URL + '/sv/plants/{{plantSlug}}' },
    ),
  },
  {
    slug: 'annual-seed-packet',
    subjectEn: 'Your annual seed packet is on the way',
    subjectFi: 'Vuosittainen siemenpussisi on lähdössä',
    subjectSv: 'Din årliga fröpåse är på väg',
    mjmlEn: wrap(
      'Annual seed packet · {{plantName}}',
      '<mj-text>Hello {{donorName}},<br/><br/>As part of your Endangered-tier adoption, we’re preparing your annual seed packet — a small hand-collected batch from the Garden’s own propagation programme. We’ll dispatch via Posti within the next two weeks; expect delivery 7-10 days after that.<br/><br/>If your shipping address has changed, please update it under My Garden → Profile so we don’t send it to the wrong place.<br/><br/>Next year’s packet will arrive around {{nextDate}}.</mj-text>',
      { label: 'My Garden', href: WEB_URL + '/en/garden' },
    ),
    mjmlFi: wrap(
      'Vuosittainen siemenpussi · {{plantName}}',
      '<mj-text>Hei {{donorName}},<br/><br/>Endangered-tason adoptiosi osana valmistelemme vuosittaista siemenpussiasi. Lähetämme Postin kautta kahden viikon kuluessa.<br/><br/>Jos toimitusosoitteesi on muuttunut, päivitä se kohdassa Oma puutarha → Profiili.<br/><br/>Seuraava pussi saapuu noin {{nextDate}}.</mj-text>',
      { label: 'Oma puutarha', href: WEB_URL + '/fi/garden' },
    ),
    mjmlSv: wrap(
      'Årlig fröpåse · {{plantName}}',
      '<mj-text>Hej {{donorName}},<br/><br/>Som en del av din Endangered-adoption förbereder vi din årliga fröpåse. Vi skickar via Posti inom två veckor.<br/><br/>Nästa påse anländer cirka {{nextDate}}.</mj-text>',
      { label: 'Min trädgård', href: WEB_URL + '/sv/garden' },
    ),
  },
  {
    slug: 'csr-quarterly-report',
    subjectEn: 'Your quarterly CSR impact report',
    subjectFi: 'Yritysadoptiosi neljännesvuosiraportti',
    subjectSv: 'Er kvartalsvis CSR-rapport',
    mjmlEn: wrap(
      'Quarterly impact · {{plantName}}',
      '<mj-text>Hello {{donorName}},<br/><br/>Your quarterly CSR impact report covering {{quarterLabel}} is attached. You funded <strong>€{{amount}}</strong> in conservation activity this quarter, allocated across direct ex-situ work, seed-bank deposits, garden operations, and platform infrastructure per the published funds-flow policy.<br/><br/>The PDF is CSRD-formatted so you can attach it directly to your sustainability reporting.</mj-text>',
      { label: 'Download report', href: '{{url}}' },
    ),
    mjmlFi: wrap(
      'Neljännesvuoden vaikuttavuusraportti',
      '<mj-text>Hei {{donorName}},<br/><br/>Liitteenä on yrityksenne CSR-vaikuttavuusraportti jaksolta {{quarterLabel}}. Tukenne tällä neljänneksellä oli <strong>{{amount}} €</strong>.</mj-text>',
      { label: 'Lataa raportti', href: '{{url}}' },
    ),
    mjmlSv: wrap(
      'Kvartalsvis effektrapport',
      '<mj-text>Hej {{donorName}},<br/><br/>Er kvartalsvis CSR-effektrapport för {{quarterLabel}} är bifogad. Ert bidrag detta kvartal var <strong>{{amount}} €</strong>.</mj-text>',
      { label: 'Ladda ner rapport', href: '{{url}}' },
    ),
  },
];
