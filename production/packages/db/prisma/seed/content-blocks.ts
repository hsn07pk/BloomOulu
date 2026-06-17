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

**Last updated:** 2026-06-17 (draft)

## 1. Controller

University of Oulu Botanical Garden, part of the University of Oulu (Y-tunnus 0245259-2). Postal address: Linnanmaa, 90014 Oulun yliopisto, Finland. Inquiries: garden@bloomoulu.fi.

Donations are processed through the **University of Oulu's own donation channel**; the University is the recipient of the funds and the controller for the payment transaction.

**Data Protection Officer (DPO):** dpo@oulu.fi (placeholder — confirm with the University DPO office before launch).

## 2. What we collect and why

We process personal data under GDPR Article 6(1)(b) (contract performance — your donation + receipt), 6(1)(c) (legal obligation — accounting law), and 6(1)(f) (legitimate interest — site security, audit, and the favourites leaderboard).

| Category | Purpose | Legal basis | Retention |
|---|---|---|---|
| Email, name, postal address | Donation fulfilment, receipt + tax certificate, and posting any physical thank-you reward you choose | Art. 6(1)(b) contract; 6(1)(c) accounting | 6 years from the donation (Finnish Kirjanpitolaki 2:5 §) |
| Donation record + payment reference (the payment itself is handled by the University donation channel) | Reconciliation, refunds, receipts | Art. 6(1)(b) + 6(1)(c) | 6 years |
| Public donor-wall entry — your chosen display name + optional dedication (only when you choose to appear) | Publicly thank supporters on the donor wall | Art. 6(1)(f) legitimate interest, with an opt-out | Until you opt out or request erasure |
| Favourite ("♥") votes — a one-way hash of your IP address + browser (visitorHash); the raw IP is **not** stored | Rank the "most-loved plants" leaderboard and prevent duplicate votes | Art. 6(1)(f) legitimate interest | Hash retained for the leaderboard; cannot be linked back to your account |
| AskTheGarden chat text | Provide the AI-grounded answer; quality review | Art. 6(1)(f) legitimate interest | 12 months, then pseudonymised |
| Audit log (who changed what, when, IP) | Security + compliance | Art. 6(1)(f) | 6 years |
| Kiosk analytics (anonymous: heartbeat, QR scan counts) | Operational health | Art. 6(1)(f) | 90 days |
| Cookies + local storage | Sign-in session (cookie); remembering the plants you favourited on this device (local storage) | Art. 6(1)(b) / functional | Session / device-local |

## 3. Recipients of your data (processors + sub-processors)

We share personal data only with the processors below, each under a data-processing agreement (GDPR Art. 28), or — where the recipient is an independent open-data source — only the minimum needed for the feature.

| Recipient | Location | What they receive | Why |
|---|---|---|---|
| **University of Oulu donation channel** (and the payment processor it uses) | EEA | Name, email, amount, transaction metadata | Process the donation and issue the receipt. The specific payment processor is configured by the University — *to be confirmed before launch*. |
| **Lehmus AI** (University of Oulu / CSC) | EEA | The text of the question you type into AskTheGarden | Generate the AI answer (LLM inference) on University-controlled infrastructure |
| **SMTP / email provider** | EEA (University-controlled infrastructure) | Email address + message contents | Transactional email (magic links, receipts) |
| **MinIO object storage** | EEA (University-controlled infrastructure) | Receipt + tax-certificate PDFs | Document storage |
| **GBIF, Wikidata / Wikimedia** | EEA / outside EEA | Plant *catalogue* queries only — never donor personal data | Background enrichment of the plant catalogue |

### Transfers outside the EEA

Your donor personal data — donations, payments, receipts, account data, and the questions you type into AskTheGarden — is processed **within the EEA**: payments through the University of Oulu donation channel, and AI answers through the University-hosted **Lehmus AI**. **We do not transfer donor personal data outside the EEA.** Background enrichment of the plant *catalogue* may query public open-data sources (GBIF, Wikidata/Wikimedia) that operate partly outside the EEA, but those queries carry **no donor personal data**. As a precaution, **please do not enter personal data (names, contact details, payment information) into the AskTheGarden chat** — it is for botanical questions only.

## 4. Your rights

- **Art. 15 Right of access:** Request a JSON copy of your data — *My Garden → Privacy & GDPR → Request a copy*. Delivered within ~5 minutes; download link valid 24 hours.
- **Art. 17 Right to erasure:** *My Garden → Erase my data*. We pseudonymise PII (email → hash, name + address → null) but RETAIN financial records (Payment, Receipt, TaxCertificate) for 6 years per the Finnish Accounting Act (Kirjanpitolaki 2:5 §). An admin reviews each request within 30 days (Art. 12(3)).
- **Art. 18 Restriction**, **Art. 20 Portability** (covered by export), **Art. 21 Objection** — write to dpo@oulu.fi.
- **Complaint right:** Tietosuojavaltuutetun toimisto (Office of the Data Protection Ombudsman) — tietosuoja.fi.

## 5. Cookies and local storage

We use only **essential** cookies (the Auth.js sign-in session). We also use your browser's **local storage** to remember the plants you've favourited on this device — this stays on your device and is not used for tracking. No third-party analytics, no advertising pixels.

## 6. Updates

We will notify donors by email of any material change to this policy at least 30 days before it takes effect.
`;

const PRIVACY_FI = `${draftBanner.fi}

# Tietosuojaseloste

**Viimeksi päivitetty:** 17.6.2026 (luonnos)

## 1. Rekisterinpitäjä

Oulun yliopiston kasvitieteellinen puutarha, osa Oulun yliopistoa (Y-tunnus 0245259-2). Postiosoite: Linnanmaa, 90014 Oulun yliopisto. Yhteydenotot: garden@bloomoulu.fi.

Lahjoitukset käsitellään **Oulun yliopiston oman lahjoituskanavan** kautta; yliopisto on varojen vastaanottaja ja maksutapahtuman rekisterinpitäjä.

**Tietosuojavastaava:** dpo@oulu.fi (alustava — vahvistettava yliopiston tietosuojayksiköltä ennen julkaisua).

## 2. Mitä keräämme ja miksi

Käsittelemme henkilötietoja GDPR 6(1)(b) artiklan (sopimuksen täyttäminen — lahjoituksesi ja kuitti), 6(1)(c) artiklan (lakisääteinen velvoite — kirjanpitolaki) ja 6(1)(f) artiklan (oikeutettu etu — tietoturva, audit ja suosikkilista) nojalla.

| Tieto | Käyttötarkoitus | Oikeusperuste | Säilytysaika |
|---|---|---|---|
| Sähköposti, nimi, postiosoite | Lahjoituksen toteutus, kuitti + verotodistus sekä valitsemasi fyysisen kiitoslahjan postitus | Art. 6(1)(b) + 6(1)(c) | 6 v lahjoituksesta (Kirjanpitolaki 2:5 §) |
| Lahjoitustietue + maksuviite (itse maksun käsittelee yliopiston lahjoituskanava) | Täsmäytys, palautukset, kuitit | Art. 6(1)(b) + 6(1)(c) | 6 v |
| Lahjoittajaseinän merkintä — valitsemasi näyttönimi + valinnainen omistus (vain jos haluat näkyä) | Lahjoittajien julkinen kiittäminen lahjoittajaseinällä | Art. 6(1)(f), kieltäytymismahdollisuus | Kunnes peruutat tai pyydät poistoa |
| Suosikkiäänet ("♥") — yksisuuntainen tiiviste IP-osoitteestasi + selaimestasi (visitorHash); raakaa IP:tä **ei** tallenneta | "Rakastetuimmat kasvit" -listan järjestys ja kaksoisäänten esto | Art. 6(1)(f) oikeutettu etu | Tiiviste säilytetään listaa varten; ei yhdistettävissä tiliisi |
| AskTheGarden-keskustelut | Lähteistetyn AI-vastauksen antaminen; laadun arviointi | Art. 6(1)(f) | 12 kk, sitten pseudonymisointi |
| Audit-loki (kuka muutti mitä, milloin, IP) | Tietoturva + säädöstenmukaisuus | Art. 6(1)(f) | 6 v |
| Kioskin analytiikka (anonyymi: heartbeat, QR-skannit) | Toiminnan terveys | Art. 6(1)(f) | 90 vrk |
| Evästeet + paikallinen tallennus | Kirjautumisistunto (eväste); suosikkikasvien muistaminen tällä laitteella (paikallinen tallennus) | Art. 6(1)(b) / toiminnallinen | Istuntokohtainen / laitekohtainen |

## 3. Tietojen vastaanottajat (käsittelijät + alikäsittelijät)

Jaamme henkilötietoja vain alla luetelluille käsittelijöille, kullekin tietojenkäsittelysopimuksen (GDPR Art. 28) nojalla — tai, kun vastaanottaja on riippumaton avoimen datan lähde, vain ominaisuuden edellyttämän vähimmäismäärän.

| Vastaanottaja | Sijainti | Mitä vastaanottaa | Miksi |
|---|---|---|---|
| **Oulun yliopiston lahjoituskanava** (ja sen käyttämä maksunvälittäjä) | ETA | Nimi, sähköposti, summa, tapahtumatiedot | Lahjoituksen käsittely ja kuitin muodostus. Maksunvälittäjän valitsee yliopisto — *vahvistettava ennen julkaisua*. |
| **Lehmus AI** (Oulun yliopisto / CSC) | ETA | AskTheGarden-kysymyksesi teksti | AI-vastauksen muodostus yliopiston hallinnoimassa ympäristössä |
| **SMTP-/sähköpostipalvelu** | ETA (yliopiston laitteisto) | Sähköpostiosoite + viestin sisältö | Tapahtumasähköpostit (kirjautumislinkit, kuitit) |
| **MinIO-objektivarasto** | ETA (yliopiston laitteisto) | Kuitti- ja verotodistus-PDF:t | Dokumenttien tallennus |
| **GBIF, Wikidata/Wikimedia** | ETA / ETA:n ulkopuolella | Vain kasvi*tietokannan* kyselyt — ei koskaan henkilötietoja | Kasvitietokannan taustarikastus |

### Siirrot ETA:n ulkopuolelle

Lahjoittajan henkilötiedot — lahjoitukset, maksut, kuitit, tilitiedot ja AskTheGarden-kysymykset — käsitellään **ETA-alueella**: maksut Oulun yliopiston lahjoituskanavan kautta ja AI-vastaukset yliopiston hallinnoiman **Lehmus AI:n** kautta. **Emme siirrä lahjoittajan henkilötietoja ETA:n ulkopuolelle.** Kasvi*tietokannan* taustarikastus voi tehdä kyselyitä julkisiin avoimen datan lähteisiin (GBIF, Wikidata/Wikimedia), jotka toimivat osin ETA:n ulkopuolella, mutta nämä kyselyt eivät sisällä henkilötietoja. Varotoimena **älä syötä henkilötietoja (nimiä, yhteystietoja, maksutietoja) AskTheGarden-keskusteluun** — se on tarkoitettu vain kasviaiheisiin kysymyksiin.

## 4. Oikeutesi

- **Art. 15 Oikeus saada pääsy tietoihinsa:** Lataa JSON-kopio — *Oma puutarhani → Yksityisyys & GDPR → Pyydä kopio*. Toimitus ~5 min; latauslinkki voimassa 24 h.
- **Art. 17 Oikeus tietojen poistamiseen:** *Oma puutarhani → Poista tietoni*. Pseudonymisoimme PII-tiedot (sähköposti → hash, nimi + osoite → null) mutta SÄILYTÄMME taloustiedot (Payment, Receipt, TaxCertificate) 6 v Kirjanpitolain 2:5 § mukaisesti. Ylläpitäjä käsittelee jokaisen pyynnön 30 vrk kuluessa (Art. 12(3)).
- **Art. 18 Rajoittaminen**, **Art. 20 Siirrettävyys** (kattaa export), **Art. 21 Vastustaminen** — kirjoita dpo@oulu.fi.
- **Valitusoikeus:** Tietosuojavaltuutetun toimisto — tietosuoja.fi.

## 5. Evästeet ja paikallinen tallennus

Käytämme vain **välttämättömiä** evästeitä (Auth.js-kirjautumisistunto). Käytämme myös selaimen **paikallista tallennusta** muistaaksemme tällä laitteella suosikiksi merkitsemäsi kasvit — tämä pysyy laitteellasi eikä sitä käytetä seurantaan. Ei kolmannen osapuolen analytiikkaa, ei mainospikseleitä.

## 6. Päivitykset

Ilmoitamme lahjoittajille sähköpostilla jokaisesta olennaisesta muutoksesta vähintään 30 vrk ennen sen voimaantuloa.
`;

const PRIVACY_SV = `${draftBanner.sv}

# Integritetspolicy

**Senast uppdaterad:** 2026-06-17 (utkast)

## 1. Personuppgiftsansvarig

Uleåborgs universitets botaniska trädgård, del av Uleåborgs universitet (Y-org.nr 0245259-2). Postadress: Linnanmaa, 90014 Uleåborgs universitet, Finland. Förfrågningar: garden@bloomoulu.fi. Donationer behandlas via **Uleåborgs universitets egen donationskanal** (universitetet är mottagare av medlen och ansvarig för betalningen).

**Dataskyddsombud:** dpo@oulu.fi (platshållare — bekräftas av universitetets DPO före lansering).

## 2. Vad vi samlar och varför

Vi behandlar personuppgifter enligt GDPR Art. 6(1)(b) (avtal — din donation + kvitto), 6(1)(c) (rättslig skyldighet — bokföringslag) och 6(1)(f) (berättigat intresse — säkerhet, revision och favoritlistan). De detaljerade kategorierna matchar den finska versionen ovan och omfattar: e-post/namn/adress (6 års bokföringsretention), donationspost + betalningsreferens, donatorväggspost (om du väljer att synas), favoritröster ("♥" — en envägshash av IP + webbläsare; rå IP lagras inte), AskTheGarden-text, revisionslogg, kioskanalys samt nödvändiga cookies + lokal lagring för favoriter.

## 3. Mottagare + överföringar utanför EES

Donationer behandlas av **Uleåborgs universitets donationskanal** (EES) och AI-svar av universitetets **Lehmus AI** (EES). **Vi överför inte donatorers personuppgifter utanför EES.** Bakgrundsberikning av växt*katalogen* kan fråga GBIF/Wikidata/Wikimedia (delvis utanför EES) — men aldrig personuppgifter. **Skriv inte personuppgifter i AskTheGarden-chatten.**

## 4. Dina rättigheter

Art. 15 åtkomst, Art. 17 radering (med 6-årig finansiell retention), Art. 18, Art. 20, Art. 21. Klagomål: Tietosuojavaltuutetun toimisto.

## 5. Cookies och lokal lagring

Endast nödvändiga cookies (Auth.js-session) + lokal lagring för att minnas dina favoriter på denna enhet. Ingen spårning.

## 6. Uppdateringar

E-postavisering 30 dagar innan väsentliga ändringar träder i kraft.
`;

const TERMS_EN = `${draftBanner.en}

# Terms of service

**Last updated:** 2026-06-17 (draft)

## 1. Service

BloomOulu is operated by the University of Oulu Botanical Garden ("the Garden"). It lets you make a **one-time donation** to support plant conservation, the seed bank, and the Garden's operations. You may optionally direct your donation to a plant species you care about; this is a **symbolic association only** and transfers no ownership or other rights in any plant. Donations are processed through the University of Oulu's own donation channel.

## 2. Eligibility + donor obligations

You must be **18 years or older** to donate. You confirm that the information you provide (name, postal address, billing details) is truthful, and that you are authorised to use the payment method you select.

## 3. Garden obligations

The Garden uses donations for plant conservation, the seed bank, and operations, and publishes an annual audit report each March. Where a giving level includes a thank-you reward (e.g. a certificate, a printed item, or an event invitation), the Garden will provide it as described, subject to availability.

## 4. Refund + cooling-off

Per Finnish consumer law (Kuluttajansuojalaki 6 luku 14 §), donations made online have a 14-day cooling-off period. To exercise it: email garden@bloomoulu.fi within 14 days of your donation; we refund via the original method within 14 days of receiving your notice. Where a physical reward has already been dispatched, its value may be deducted from the refund.

## 5. One-time donations

Donations are **one-time** — there are no recurring charges or subscriptions, so there is nothing to cancel. Each donation is a separate, voluntary contribution.

## 6. Liability

The Garden's liability is limited to the amount of the donation. The Garden is not responsible for losses arising from your use of the platform beyond that.

## 7. Governing law + venue

Finnish law. Disputes are heard in the Oulu District Court (Oulun käräjäoikeus) unless mandatory consumer-protection law specifies otherwise.
`;

const TERMS_FI = `${draftBanner.fi}

# Käyttöehdot

**Viimeksi päivitetty:** 17.6.2026 (luonnos)

## 1. Palvelu

BloomOulu on Oulun yliopiston kasvitieteellisen puutarhan ("Puutarha") ylläpitämä palvelu. Sen kautta voit tehdä **kertaluonteisen lahjoituksen** kasvien suojelun, siemenpankin ja puutarhan toiminnan tueksi. Voit halutessasi kohdentaa lahjoituksesi haluamaasi kasvilajiin; tämä on **vain symbolinen yhteys** eikä siirrä mitään omistus- tai muita oikeuksia kasviin. Lahjoitukset käsitellään Oulun yliopiston oman lahjoituskanavan kautta.

## 2. Edellytykset + lahjoittajan velvollisuudet

Lahjoittajan on oltava **vähintään 18-vuotias**. Vahvistat, että antamasi tiedot (nimi, postiosoite, maksutiedot) ovat totuudenmukaisia ja että sinulla on oikeus käyttää valitsemaasi maksutapaa.

## 3. Puutarhan velvollisuudet

Puutarha käyttää lahjoitukset kasvien suojeluun, siemenpankkiin ja puutarhan toimintaan, ja julkaisee tilintarkastuskertomuksen vuosittain maaliskuussa. Jos lahjoitustaso sisältää kiitoslahjan (esim. todistus, painotuote tai tapahtumakutsu), Puutarha toimittaa sen kuvatulla tavalla saatavuuden mukaan.

## 4. Palautus + peruuttamisoikeus

Suomen kuluttajansuojalain 6 luvun 14 § mukaisesti verkossa tehdyillä lahjoituksilla on 14 päivän peruuttamisoikeus. Toteutus: lähetä sähköposti osoitteeseen garden@bloomoulu.fi 14 vrk kuluessa lahjoituksesta; palautamme varat alkuperäisellä maksutavalla 14 vrk kuluessa ilmoituksesi vastaanottamisesta. Jos fyysinen kiitoslahja on jo lähetetty, sen arvo voidaan vähentää palautuksesta.

## 5. Kertaluonteiset lahjoitukset

Lahjoitukset ovat **kertaluonteisia** — toistuvia veloituksia tai tilauksia ei ole, joten mitään ei tarvitse peruuttaa. Jokainen lahjoitus on erillinen, vapaaehtoinen suoritus.

## 6. Vastuu

Puutarhan vastuu rajoittuu lahjoituksen määrään. Puutarha ei vastaa muista palvelun käytöstä aiheutuvista vahingoista.

## 7. Sovellettava laki + tuomioistuin

Suomen laki. Riidat ratkaistaan Oulun käräjäoikeudessa, ellei pakottava kuluttajansuojalainsäädäntö muuta määrää.
`;

const TERMS_SV = `${draftBanner.sv}

# Användarvillkor

**Senast uppdaterad:** 2026-06-17 (utkast)

## 1. Tjänsten

BloomOulu drivs av Uleåborgs universitets botaniska trädgård. Du gör en **engångsdonation** till stöd för växtbevarande, fröbanken och trädgårdens verksamhet, och kan valfritt rikta den till en växtart — en **symbolisk koppling** som inte överför någon äganderätt. Donationer behandlas via universitetets egen donationskanal.

## 2. Behörighet + donatorns skyldigheter

Du måste vara **minst 18 år**. Sanna uppgifter och behörighet att använda vald betalningsmetod.

## 3. Trädgårdens skyldigheter

Användning för bevarande, fröbank och drift, samt årlig revisionsrapport. Eventuella tack-belöningar levereras enligt beskrivning, i mån av tillgång.

## 4. Återbetalning + ångerrätt

14 dagars ångerrätt enligt finsk konsumentskyddslag. Värdet av en redan skickad fysisk belöning kan dras av från återbetalningen.

## 5. Engångsdonationer

Donationer är **engångsbetalningar** — inga återkommande avgifter, inget att avsluta.

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
    // Legal blocks (privacy / terms / accessibility) encode compliance
    // statements — a stale copy can be a FALSE legal claim (e.g. the old
    // "no transfers outside the EEA" line), so on every seed they are
    // force-refreshed from this canonical source, which always wins over a
    // DB copy. Marketing copy (home.hero) is operator-editable in /admin, so
    // we only insert it and never clobber later edits.
    const isLegal = b.slug.startsWith('legal.');
    await prisma.contentBlock.upsert({
      where: { slug: b.slug },
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
      update: isLegal
        ? { kind: b.kind, bodyEn: b.bodyEn, bodyFi: b.bodyFi, bodySv: b.bodySv }
        : {},
    });
  }
}
