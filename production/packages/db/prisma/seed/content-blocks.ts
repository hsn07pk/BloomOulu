import type { PrismaClient } from '@prisma/client';

/**
 * CMS-style content blocks rendered by /privacy, /terms,
 * /accessibility-statement, the homepage hero, and the "Where your money
 * goes" modal. All editable from /admin/resources/ContentBlock.
 *
 * Legal content (privacy/terms/accessibility) ships as DRAFT, with the
 * banner "REVIEW BY UNIVERSITY DPO BEFORE LAUNCH" baked into the admin
 * edit UI. The University DPO + legal counsel must approve before
 * isPublished is left at true on a production database.
 */
interface Block {
  slug: string;
  kind: 'hero' | 'callout' | 'modal' | 'policy' | 'raw_md';
  bodyEn: string;
  bodyFi: string;
  bodySv: string;
  ctaText?: { en: string; fi: string; sv: string };
  ctaHref?: string;
  isPublished?: boolean;
  sortOrder?: number;
}

const draftBanner = {
  en: '> ⚠ DRAFT — REVIEW BY UNIVERSITY OF OULU DPO + LEGAL COUNSEL BEFORE LAUNCH. The University Y-tunnus, DPO email, and supervisory-authority contact below are placeholders.',
  fi: '> ⚠ LUONNOS — TARKISTUTETTAVA YLIOPISTON TIETOSUOJAVASTAAVALLA + JURISTILLA ENNEN JULKAISUA. Yliopiston Y-tunnus, tietosuojavastaavan sähköposti ja valvontaviranomaisen yhteystiedot ovat alustavia.',
  sv: '> ⚠ UTKAST — GRANSKAS AV UNIVERSITETETS DATASKYDDSOMBUD + JURIST FÖRE LANSERING. Y-organisationsnummer, DPO-e-post och tillsynsmyndighetens kontakt är platshållare.',
};

const PRIVACY_EN = `${draftBanner.en}

# Privacy policy

**Last updated:** 2026-05-14 (draft)

## 1. Controller

University of Oulu Botanical Garden, part of the University of Oulu (Y-tunnus 0245259-2). Postal address: Linnanmaa, 90014 Oulun yliopisto, Finland. Inquiries: garden@bloomoulu.fi.

**Data Protection Officer (DPO):** dpo@oulu.fi (placeholder — confirm with University DPO office before launch).

## 2. What we collect and why

We process personal data under GDPR Article 6(1)(b) (contract performance — your adoption + receipt) and 6(1)(f) (legitimate interest — site security + audit).

| Category | Purpose | Legal basis | Retention |
|---|---|---|---|
| Email, name, postal address | Adoption fulfilment, receipt + tax certificate | Art. 6(1)(b) contract | 6 years from last donation (Finnish Kirjanpitolaki 2:5 §) |
| Payment provider tokens, transaction IDs | Reconciliation, refunds, fraud prevention | Art. 6(1)(b) + 6(1)(c) tax law | 6 years |
| AskTheGarden chat transcripts | Provide the AI grounded answer; quarterly RAG evaluation | Art. 6(1)(f) legitimate interest | 12 months, then pseudonymised |
| Audit log (who changed what, when, IP) | Security + compliance | Art. 6(1)(f) | 6 years |
| Kiosk analytics (anonymous: heartbeat, QR scan counts) | Operational health | Art. 6(1)(f) | 90 days |
| Cookies | Auth session only (no tracking) | Art. 6(1)(b) contract | Session-scoped |

## 3. Recipients of your data

- **Paytrail Oyj** (Jyväskylä, FI) — payment processor for cards + FI online banking + Apple/Google Pay. Data processing agreement under Art. 28.
- **Vipps MobilePay AS** (Oslo, NO; EEA) — MobilePay recurring agreements only. Activated only after the donor selects MobilePay.
- **Postal SMTP host** (self-hosted on University-controlled infrastructure) — transactional email delivery.
- **MinIO object storage** (self-hosted on University-controlled infrastructure) — receipt + tax-certificate PDFs.

No transfers outside the European Economic Area.

## 4. Your rights

- **Art. 15 Right of access:** Request a JSON copy of your data — *My Garden → Privacy & GDPR → Request a copy*. Delivered within ~5 minutes; download link valid 24 hours.
- **Art. 17 Right to erasure:** *My Garden → Erase my data*. We pseudonymise PII (email → hash, name + address → null) but RETAIN financial records (Payment, Receipt, TaxCertificate) for 6 years per Finnish Accounting Act (Kirjanpitolaki 2:5 §). An admin reviews each request within 30 days (Art. 12(3)).
- **Art. 18 Restriction**, **Art. 20 Portability** (covered by export), **Art. 21 Objection** — write to dpo@oulu.fi.
- **Complaint right:** Tietosuojavaltuutetun toimisto (Office of the Data Protection Ombudsman) — tietosuoja.fi.

## 5. Cookies

We use only **essential** cookies (Auth.js session). No tracking, no third-party analytics, no advertising pixels. The cookie banner on your first visit confirms this.

## 6. Updates

We will notify donors by email of any material change to this policy at least 30 days before it takes effect.
`;

const PRIVACY_FI = `${draftBanner.fi}

# Tietosuojaseloste

**Viimeksi päivitetty:** 14.5.2026 (luonnos)

## 1. Rekisterinpitäjä

Oulun yliopiston kasvitieteellinen puutarha, osa Oulun yliopistoa (Y-tunnus 0245259-2). Postiosoite: Linnanmaa, 90014 Oulun yliopisto. Yhteydenotot: garden@bloomoulu.fi.

**Tietosuojavastaava:** dpo@oulu.fi (alustava — vahvistettava yliopiston tietosuojayksiköltä ennen julkaisua).

## 2. Mitä keräämme ja miksi

Käsittelemme henkilötietoja GDPR 6(1)(b) artiklan (sopimuksen täyttäminen — adoptiosi ja kuitti) ja 6(1)(f) artiklan (oikeutettu etu — tietoturva ja audit) nojalla.

| Tieto | Käyttötarkoitus | Oikeusperuste | Säilytysaika |
|---|---|---|---|
| Sähköposti, nimi, postiosoite | Adoption toteutus, kuitti + verotodistus | Art. 6(1)(b) | 6 v viimeisestä lahjoituksesta (Kirjanpitolaki 2:5 §) |
| Maksupalveluntarjoajan tokenit, tapahtumatunnisteet | Täsmäytys, palautukset, väärinkäyttöjen ehkäisy | Art. 6(1)(b) + 6(1)(c) | 6 v |
| AskTheGarden-keskustelut | Lähteistettyjen vastausten antaminen; neljännesvuosittainen RAG-arviointi | Art. 6(1)(f) | 12 kk, sitten pseudonymisointi |
| Audit-loki (kuka muutti mitä, milloin, IP) | Tietoturva + säädöstenmukaisuus | Art. 6(1)(f) | 6 v |
| Kioskin analytiikka (anonyymi: heartbeat, QR-skannit) | Toiminnan terveys | Art. 6(1)(f) | 90 vrk |
| Evästeet | Vain kirjautumisistunto (ei seurantaa) | Art. 6(1)(b) | Istuntokohtainen |

## 3. Tietojen vastaanottajat

- **Paytrail Oyj** (Jyväskylä, FI) — maksunvälitys: kortit + FI-verkkopankki + Apple/Google Pay. Tietojenkäsittelysopimus GDPR Art. 28 mukaisesti.
- **Vipps MobilePay AS** (Oslo, NO; ETA) — MobilePay-tilaussopimukset vain. Aktivoituu vain jos lahjoittaja valitsee MobilePayn.
- **Postal-SMTP-palvelin** (itse hostattu yliopiston laitteistossa) — tapahtumasähköpostit.
- **MinIO-objektivarasto** (itse hostattu yliopiston laitteistossa) — kuitit + verotodistukset.

Tietoja ei siirretä Euroopan talousalueen ulkopuolelle.

## 4. Oikeutesi

- **Art. 15 Oikeus saada pääsy tietoihinsa:** Lataa JSON-kopio — *Oma puutarhani → Yksityisyys & GDPR → Pyydä kopio*. Toimitus ~5 min; latauslinkki voimassa 24 h.
- **Art. 17 Oikeus tietojen poistamiseen:** *Oma puutarhani → Poista tietoni*. Pseudonymisoimme PII-tiedot (sähköposti → hash, nimi + osoite → null) mutta SÄILYTÄMME taloustiedot (Payment, Receipt, TaxCertificate) 6 v Kirjanpitolain 2:5 § mukaisesti. Ylläpitäjä käsittelee jokaisen pyynnön 30 vrk kuluessa (Art. 12(3)).
- **Art. 18 Rajoittaminen**, **Art. 20 Siirrettävyys** (kattaa export), **Art. 21 Vastustaminen** — kirjoita dpo@oulu.fi.
- **Valitusoikeus:** Tietosuojavaltuutetun toimisto — tietosuoja.fi.

## 5. Evästeet

Käytämme vain **välttämättömiä** evästeitä (Auth.js-istunto). Ei seurantaa, ei kolmannen osapuolen analytiikkaa, ei mainospikseleitä. Ensimmäisellä käynnillä näkyvä evästeilmoitus vahvistaa tämän.

## 6. Päivitykset

Ilmoitamme lahjoittajille sähköpostilla jokaisesta olennaisesta muutoksesta vähintään 30 vrk ennen sen voimaantuloa.
`;

const PRIVACY_SV = `${draftBanner.sv}

# Integritetspolicy

**Senast uppdaterad:** 2026-05-14 (utkast)

## 1. Personuppgiftsansvarig

Uleåborgs universitets botaniska trädgård, del av Uleåborgs universitet (Y-org.nr 0245259-2). Postadress: Linnanmaa, 90014 Uleåborgs universitet, Finland. Förfrågningar: garden@bloomoulu.fi.

**Dataskyddsombud:** dpo@oulu.fi (platshållare — bekräftas av universitetets DPO före lansering).

## 2. Vad vi samlar och varför

Vi behandlar personuppgifter enligt GDPR Art. 6(1)(b) (fullgörande av avtal) och 6(1)(f) (berättigat intresse — säkerhet + revision).

Detaljerade kategorier matchar den finska versionen ovan.

## 3. Mottagare av uppgifterna

Paytrail Oyj (FI), Vipps MobilePay AS (NO, EES), egen Postal SMTP, egen MinIO. Inga överföringar utanför EES.

## 4. Dina rättigheter

Art. 15 åtkomst, Art. 17 radering (med 6-årig finansiell retention), Art. 18, Art. 20, Art. 21. Klagomål: Tietosuojavaltuutetun toimisto.

## 5. Cookies

Endast nödvändiga (Auth.js-session). Ingen spårning.

## 6. Uppdateringar

E-postavisering 30 dagar innan väsentliga ändringar träder i kraft.
`;

const TERMS_EN = `${draftBanner.en}

# Terms of service

**Last updated:** 2026-05-14 (draft)

## 1. Service

BloomOulu is operated by the University of Oulu Botanical Garden ("the Garden"). The adoption service is **symbolic**: no property in the plant transfers to the donor. The donation supports plant conservation, the seed bank, and the Garden's operations.

## 2. Donor obligations

You confirm that information you provide (name, postal address, billing details) is truthful, and that you are authorised to make the donation on the account you specify.

## 3. Garden obligations

The Garden uses donor funds for plant conservation, the seed bank, and operations, and publishes an annual audit report each March.

## 4. Refund + cooling-off

Per Finnish consumer law (Kuluttajansuojalaki 6 luku 14 §), donations made online have a 14-day cooling-off period. To exercise: email garden@bloomoulu.fi within 14 days of your donation; we refund via the original method within 14 days of receiving your notice.

## 5. Recurring adoptions

You can cancel any recurring adoption from *My Garden → Manage payment → Cancel*. Cancellation takes effect at the end of the current billing period; no further charges are made. Already-completed periods are not refunded outside the cooling-off above.

## 6. Liability

The Garden's liability is limited to the amount of the donation. The Garden is not responsible for losses arising from your use of the platform beyond that.

## 7. Governing law + venue

Finnish law. Disputes are heard in the Oulu District Court (Oulun käräjäoikeus) unless mandatory consumer-protection law specifies otherwise.
`;

const TERMS_FI = `${draftBanner.fi}

# Käyttöehdot

**Viimeksi päivitetty:** 14.5.2026 (luonnos)

## 1. Palvelu

BloomOulu on Oulun yliopiston kasvitieteellisen puutarhan ("Puutarha") ylläpitämä palvelu. Adoptio on **symbolinen**: omistusoikeus kasviin ei siirry lahjoittajalle. Lahjoitus tukee kasvien suojelua, siemenpankkia ja puutarhan toimintaa.

## 2. Lahjoittajan velvollisuudet

Vahvistat, että antamasi tiedot (nimi, postiosoite, maksutiedot) ovat totuudenmukaisia ja että sinulla on oikeus tehdä lahjoitus ilmoittamaltasi tililtä.

## 3. Puutarhan velvollisuudet

Puutarha käyttää lahjoitusvarat kasvien suojeluun, siemenpankkiin ja puutarhan toimintaan, ja julkaisee tilintarkastuskertomuksen vuosittain maaliskuussa.

## 4. Palautus + peruuttamisoikeus

Suomen kuluttajansuojalain 6 luvun 14 § mukaisesti verkossa tehdyillä lahjoituksilla on 14 päivän peruuttamisoikeus. Toteutus: lähetä sähköposti osoitteeseen garden@bloomoulu.fi 14 vrk kuluessa lahjoituksesta; palautamme varat alkuperäisellä maksutavalla 14 vrk kuluessa ilmoituksesi vastaanottamisesta.

## 5. Toistuvat adoptiot

Voit peruuttaa toistuvan adoption *Oma puutarhani → Hallinnoi maksutapaa → Peru*. Peruutus astuu voimaan nykyisen laskutuskauden lopussa. Jo toteutuneita kausia ei palauteta yllä mainitun peruuttamisoikeuden ulkopuolella.

## 6. Vastuu

Puutarhan vastuu rajoittuu lahjoituksen määrään. Puutarha ei vastaa muista palvelun käytöstä aiheutuvista vahingoista.

## 7. Sovellettava laki + tuomioistuin

Suomen laki. Riidat ratkaistaan Oulun käräjäoikeudessa, ellei pakottava kuluttajansuojalainsäädäntö muuta määrää.
`;

const TERMS_SV = `${draftBanner.sv}

# Användarvillkor

**Senast uppdaterad:** 2026-05-14 (utkast)

## 1. Tjänsten

BloomOulu drivs av Uleåborgs universitets botaniska trädgård. Adoption är **symbolisk** — ingen äganderätt övergår.

## 2. Donatorns skyldigheter

Sanna uppgifter och behörighet att donera.

## 3. Trädgårdens skyldigheter

Användning för bevarande, fröbank och drift, samt årlig revisionsrapport.

## 4. Återbetalning + ångerrätt

14 dagars ångerrätt enligt finsk konsumentskyddslag.

## 5. Återkommande adoptioner

Avbrottsbart från Min trädgård.

## 6. Ansvar

Begränsat till donationens belopp.

## 7. Tillämplig lag + forum

Finsk lag. Tvister i Uleåborgs tingsrätt.
`;

const A11Y_EN = `${draftBanner.en}

# Accessibility statement

**Last updated:** 2026-05-14 (draft)

The University of Oulu Botanical Garden is committed to making BloomOulu accessible in line with the **European Accessibility Act 2025** and **WCAG 2.2 level AA**. This statement covers the public site (bloomoulu.fi), the donor area (*My Garden*), the AskTheGarden chat, and the lobby kiosks.

## Conformance level

**Partial conformance with WCAG 2.2 AA** as of the most recent automated audit (axe-core via Playwright on every PR). Known limitations are listed below.

## Date of last assessment

2026-05-14 — automated axe scan on every page. External audit by TPGi or Siteimprove scheduled for 2026-Q3.

## Known limitations

The following are tracked and prioritised for fix:

- [ ] Plant-page kiosk-mode QR code has alt-text-only fallback; on-screen captions for the audio narration are present but not yet timed (WebVTT pending Phase 3 polish).
- [ ] AskTheGarden chat citation chips do not yet announce "n of m citations" to screen readers when arriving mid-stream.
- [ ] Date / number formatting matches the donor's selected locale, but error messages on the adopt form currently default to English when next-intl falls back.

If you encounter an accessibility barrier not listed here, please email **accessibility@bloomoulu.fi** (placeholder; redirects to garden@bloomoulu.fi). We aim to respond within 5 working days.

## Enforcement

If you are not satisfied with the response, you can file an enforcement complaint with **Etelä-Suomen aluehallintovirasto** (Regional State Administrative Agency for Southern Finland) at saavutettavuusvaatimukset.fi.
`;

const A11Y_FI = `${draftBanner.fi}

# Saavutettavuusseloste

**Viimeksi päivitetty:** 14.5.2026 (luonnos)

Oulun yliopiston kasvitieteellinen puutarha sitoutuu tekemään BloomOulu-palvelusta saavutettavan **Euroopan saavutettavuusdirektiivin (EAA 2025)** ja **WCAG 2.2 taso AA** mukaisesti. Tämä seloste kattaa julkisen sivuston, oman puutarhan, AskTheGarden-keskustelun ja kioskinäytöt.

## Vaatimustenmukaisuus

**Osittain vaatimustenmukainen WCAG 2.2 AA -tasolla** automaattisen auditoinnin perusteella (axe-core Playwrightissä jokaisessa PR:ssä). Tunnetut rajoitteet alla.

## Viimeinen arviointi

14.5.2026 — automaattinen axe-skannaus jokaisella sivulla. Ulkopuolinen auditointi (TPGi tai Siteimprove) suoritetaan Q3/2026.

## Tunnetut rajoitteet

- [ ] Kasvisivun kiosk-tilan QR-koodissa on vain alt-teksti varatekstinä; äänikerrontaan on tekstitykset, mutta aikamerkit (WebVTT) odottavat vielä vaiheen 3 viimeistelyä.
- [ ] AskTheGarden-keskustelun lähde-chipit eivät vielä ilmoita "n / m lähdettä" ruudunlukijalle, kun ne saapuvat striimin keskellä.
- [ ] Lahjoituslomakkeen virheilmoitukset näytetään tällä hetkellä englanniksi, jos next-intl ei löydä käännöstä.

Jos kohtaat saavutettavuusesteen, joka ei ole listattuna, kirjoita **accessibility@bloomoulu.fi**. Tavoitteenamme on vastata 5 arkipäivän kuluessa.

## Valvonta

Jos et ole tyytyväinen vastaukseen, voit tehdä ilmoituksen **Etelä-Suomen aluehallintovirastolle** osoitteessa saavutettavuusvaatimukset.fi.
`;

const A11Y_SV = `${draftBanner.sv}

# Tillgänglighetsutlåtande

**Senast uppdaterad:** 2026-05-14 (utkast)

Trädgården åtar sig att följa EAA 2025 och WCAG 2.2 nivå AA. Detta utlåtande täcker den offentliga webbplatsen, donatorområdet, AskTheGarden och kioskerna.

**Status:** Delvis överensstämmande med WCAG 2.2 AA enligt senaste automatiska revision (axe-core på varje PR). Extern revision schemalagd till Q3/2026.

**Kända begränsningar** matchar den finska/engelska versionen.

**Kontakt:** accessibility@bloomoulu.fi (svar inom 5 arbetsdagar).

**Tillsynsmyndighet:** Regionförvaltningsverket i Södra Finland — saavutettavuusvaatimukset.fi.
`;

const BLOCKS: Block[] = [
  {
    slug: 'home.hero',
    kind: 'hero',
    bodyEn: 'Turning every plant into a story, a supporter, and a step toward saving Finnish flora.',
    bodyFi: 'Jokaisesta kasvista tarina, tukija ja askel suomalaisen lajiston suojelemiseksi.',
    bodySv: 'Varje växt en berättelse, en stödjare, ett steg för att rädda den finska floran.',
    ctaText: { en: 'Adopt a plant', fi: 'Adoptoi kasvi', sv: 'Adoptera en växt' },
    ctaHref: '/adopt',
    isPublished: true,
    sortOrder: 0,
  },
  {
    slug: 'legal.privacy',
    kind: 'raw_md',
    bodyEn: PRIVACY_EN,
    bodyFi: PRIVACY_FI,
    bodySv: PRIVACY_SV,
    isPublished: true,
    sortOrder: 100,
  },
  {
    slug: 'legal.terms',
    kind: 'raw_md',
    bodyEn: TERMS_EN,
    bodyFi: TERMS_FI,
    bodySv: TERMS_SV,
    isPublished: true,
    sortOrder: 110,
  },
  {
    slug: 'legal.accessibility',
    kind: 'raw_md',
    bodyEn: A11Y_EN,
    bodyFi: A11Y_FI,
    bodySv: A11Y_SV,
    isPublished: true,
    sortOrder: 120,
  },
];

export async function seedContentBlocks(prisma: PrismaClient) {
  for (const b of BLOCKS) {
    await prisma.contentBlock.upsert({
      where: { slug: b.slug },
      // Only set the body on first insert; never overwrite operator edits.
      create: {
        slug: b.slug,
        kind: b.kind,
        bodyEn: b.bodyEn,
        bodyFi: b.bodyFi,
        bodySv: b.bodySv,
        ctaText: (b.ctaText as any) ?? undefined,
        ctaHref: b.ctaHref ?? null,
        isPublished: b.isPublished ?? true,
        sortOrder: b.sortOrder ?? 0,
      },
      update: {},
    });
  }
}
