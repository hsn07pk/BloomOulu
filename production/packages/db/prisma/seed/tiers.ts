import type { PrismaClient } from '@prisma/client';

export async function seedTiers(prisma: PrismaClient) {
  const tiers = [
    {
      id: 'seedling',
      name: 'Seedling', nameFi: 'Siemen', nameSv: 'Frö',
      annualPriceCents: 2500, monthlyPriceCents: 300,
      blurbEn: 'A starter gesture. Nickname your plant, pick one from your home region, get a digital certificate and quarterly notes.',
      blurbFi: 'Aloittelijan ele. Anna kasville lempinimi, valitse kotiseudultasi, saa digitaalinen sertifikaatti ja neljännesvuosittaiset päivitykset.',
      blurbSv: 'Ett startsteg. Ge din växt ett smeknamn, välj en från din hembygd, få ett digitalt diplom och kvartalsuppdateringar.',
      perks: [
        'nickname_your_plant',
        'i_at_h_home_region_plant',
        'digital_certificate',
        'quarterly_growers_notes',
      ],
      tagEn: 'Most popular gift', tagFi: 'Suosituin lahja', tagSv: 'Populäraste gåvan',
      color: '#A8C060', bg: '#E8EEDE', sortOrder: 1,
    },
    {
      id: 'rooted',
      name: 'Rooted', nameFi: 'Juurtunut', nameSv: 'Rotad',
      annualPriceCents: 7500, monthlyPriceCents: 800,
      blurbEn: 'Printed certificate mailed to you, I@H postcard from your plant\'s region, seasonal photos of your specific plant.',
      blurbFi: 'Painettu todistus postitettuna, I@H-postikortti kasvisi alueelta, kausittaiset valokuvat juuri sinun kasvistasi.',
      blurbSv: 'Tryckt diplom per post, I@H-vykort från växtens region, säsongsbilder av just din växt.',
      perks: [
        'printed_certificate_mailed',
        'i_at_h_postcard',
        'seasonal_photos_your_plant',
        'adopters_open_day_invite',
      ],
      tagEn: 'Best value', tagFi: 'Paras hinta-laatu', tagSv: 'Bäst värde',
      color: '#88A050', bg: '#DDE6CB', sortOrder: 2,
    },
    {
      id: 'vulnerable',
      name: 'Vulnerable', nameFi: 'Vaarantunut', nameSv: 'Sårbar',
      annualPriceCents: 25000, monthlyPriceCents: 2500,
      blurbEn: 'Funds an actively threatened species. Signed botanical art, themed garden walk, Adopters\' Open Day + guest.',
      blurbFi: 'Rahoittaa uhanalaista lajia. Allekirjoitettu kasvitaide, opastettu teemakierros, Adoptoijien avoin päivä + vieras.',
      blurbSv: 'Finansierar en sårbar art. Signerad botanisk konst, temarundvandring, Adoptanternas dag + gäst.',
      perks: [
        'signed_botanical_art',
        'themed_garden_walk',
        'adopters_open_day_plus_one',
        'donor_wall_listing',
        'shared_plaque',
      ],
      tagEn: 'Donor-wall listing', tagFi: 'Lahjoittajaseinä', tagSv: 'Donatorväggen',
      color: '#5FB0A0', bg: '#D6EBE3', sortOrder: 3,
    },
    {
      id: 'endangered',
      name: 'Endangered', nameFi: 'Erittäin uhanalainen', nameSv: 'Starkt hotad',
      annualPriceCents: 75000, monthlyPriceCents: 7500,
      blurbEn: 'Limited-edition signed art, donor dinner with a seed-bank visit, an engraved plaque next to your specific plant, and an annual seed packet.',
      blurbFi: 'Rajoitettu painos allekirjoitettua taidetta, lahjoittajien illallinen siemenpankin vierailulla, kaiverrettu laatta juuri sinun kasvisi viereen ja vuosittainen siemenpaketti.',
      blurbSv: 'Limiterad utgåva av signerad konst, donatormiddag med fröbanksbesök, en graverad plakett bredvid just din växt och ett årligt fröpaket.',
      perks: [
        'limited_edition_art_print',
        'curated_botany_book',
        'donor_dinner_seed_bank_visit',
        'plaque_next_to_your_plant',
        'annual_seed_packet',
      ],
      tagEn: 'Plaque by YOUR plant', tagFi: 'Oma laatta kasvisi viereen', tagSv: 'Plakett vid din växt',
      color: '#1F3C2D', bg: '#CFD9D0', sortOrder: 4,
    },
    {
      id: 'corporate',
      name: 'Corporate', nameFi: 'Yritystaso', nameSv: 'Företag',
      annualPriceCents: 250000, monthlyPriceCents: null,
      blurbEn: 'CSR-ready quarterly impact reports, logo placement on greenhouse signage, private event slot for up to 20 guests. Tax-deductible under TVL §57 for Finnish corporates.',
      blurbFi: 'CSR-valmiit neljännesvuosittaiset vaikuttavuusraportit, logo kasvihuoneiden opasteissa, yksityinen tapahtuma-aika enintään 20 vieraalle. Verovähennyskelpoinen suomalaisille yrityksille TVL §57 mukaan.',
      blurbSv: 'CSR-redo kvartalsvisa effektrapporter, logoplacering på växthusskyltar, privat evenemang för upp till 20 gäster. Avdragsgill för finländska företag enligt TVL §57.',
      perks: [
        'logo_on_greenhouse_signage',
        'csr_impact_report',
        'private_event_slot_20_guests',
      ],
      tagEn: null, tagFi: null, tagSv: null,
      color: '#B25C3A', bg: '#F0DCD0', sortOrder: 5,
    },
  ];
  for (const t of tiers) {
    await prisma.tier.upsert({
      where: { id: t.id as any },
      create: t as any,
      update: t as any,
    });
  }
}
