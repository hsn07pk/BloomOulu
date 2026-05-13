import type { PrismaClient } from '@prisma/client';

export async function seedTiers(prisma: PrismaClient) {
  const tiers = [
    {
      id: 'seedling',
      name: 'Seedling', nameFi: 'Siemen', nameSv: 'Frö',
      annualPriceCents: 2500, monthlyPriceCents: 300,
      blurbEn: 'A starter gesture. Nickname your plant, pick one from your home region.',
      blurbFi: 'Aloittelijan ele. Anna kasville lempinimi, valitse kotiseudultasi.',
      blurbSv: 'Ett startsteg. Ge din växt ett smeknamn, välj en från din hembygd.',
      perks: [
        'nickname_your_plant',
        'i_at_h_home_region_plant',
        'digital_certificate',
        'quarterly_growers_notes',
      ],
      color: '#A8C060', bg: '#E8EEDE', sortOrder: 1,
    },
    {
      id: 'rooted',
      name: 'Rooted', nameFi: 'Juurtunut', nameSv: 'Rotad',
      annualPriceCents: 7500, monthlyPriceCents: 800,
      blurbEn: 'Printed certificate mailed to you, postcard, seasonal photos.',
      blurbFi: 'Painettu todistus, postikortti, kausittaiset valokuvat.',
      blurbSv: 'Tryckt diplom, vykort, säsongsbilder.',
      perks: [
        'printed_certificate_mailed',
        'i_at_h_postcard',
        'seasonal_photos_your_plant',
        'adopters_open_day_invite',
      ],
      color: '#88A050', bg: '#DDE6CB', sortOrder: 2,
    },
    {
      id: 'vulnerable',
      name: 'Vulnerable', nameFi: 'Vaarantunut', nameSv: 'Sårbar',
      annualPriceCents: 25000, monthlyPriceCents: 2500,
      blurbEn: 'Funds an actively threatened species. Signed botanical art, themed walk.',
      blurbFi: 'Rahoittaa uhanalaista lajia. Allekirjoitettu taideprintti, opastettu kierros.',
      blurbSv: 'Finansierar en sårbar art. Signerad botanisk tryck, guidad rundvandring.',
      perks: [
        'signed_botanical_art',
        'themed_garden_walk',
        'adopters_open_day_plus_one',
        'donor_wall_listing',
        'shared_plaque',
      ],
      color: '#5FB0A0', bg: '#D6EBE3', sortOrder: 3,
    },
    {
      id: 'endangered',
      name: 'Endangered', nameFi: 'Erittäin uhanalainen', nameSv: 'Starkt hotad',
      annualPriceCents: 75000, monthlyPriceCents: 7500,
      blurbEn: 'Limited-edition art, donor dinner with seed-bank visit, plaque by your plant.',
      blurbFi: 'Rajoitettu painos, lahjoittajien illallinen, oma laatta.',
      blurbSv: 'Limiterad utgåva, donatormiddag, egen plakett.',
      perks: [
        'limited_edition_art_print',
        'curated_botany_book',
        'donor_dinner_seed_bank_visit',
        'plaque_next_to_your_plant',
        'annual_seed_packet',
      ],
      color: '#1F3C2D', bg: '#CFD9D0', sortOrder: 4,
    },
    {
      id: 'corporate',
      name: 'Corporate', nameFi: 'Yritystaso', nameSv: 'Företag',
      annualPriceCents: 250000, monthlyPriceCents: null,
      blurbEn: 'CSR-ready impact report, logo on greenhouse signage, private event.',
      blurbFi: 'CSR-vaikuttavuusraportti, logo opastauluissa, yksityinen tapahtuma.',
      blurbSv: 'CSR-rapport, logo på växthusskyltar, privat evenemang.',
      perks: [
        'logo_on_greenhouse_signage',
        'csr_impact_report',
        'private_event_slot_20_guests',
      ],
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
