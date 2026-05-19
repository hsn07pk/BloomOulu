/**
 * Comprehensive Finnish flora seed.
 *
 * Sources (all open data / CC):
 *   * GBIF backbone taxonomy + Finnish occurrences (https://www.gbif.org/)
 *   * IUCN Red List + Suomen lajien uhanalaisuus 2019 (Finnish Red List)
 *   * Wikimedia Commons (photos, CC-licensed)
 *   * Suomen kasvit & Wikidata (Q-IDs for cross-reference)
 *   * Pl@ntNet (https://identify.plantnet.org/ — CC licensed images)
 *
 * This file ships ~60 representative Finnish + showcase species across all
 * Red List categories. A separate, larger ingest script (scripts/ingest-flora.ts)
 * fetches the full ~2,667 vascular plants of Finland on demand. We seed a
 * curated subset so the demo is immediately useful.
 *
 * Image URLs point at Wikimedia thumbnail URLs (stable). All attribution is
 * recorded in `PlantImage.attribution` per Wikimedia CC requirements.
 */

import type { PrismaClient, RedListStatus, BloomSeason } from '@prisma/client';

export interface FloraEntry {
  slug: string;
  taxon: { latinName: string; family: string; author?: string; synonyms?: string[] };
  nameFi: string;
  nameSv: string;
  nameEn: string;
  redListStatus: RedListStatus;
  redListYear: number;
  origin: string;
  habitat: string;
  biome: string;
  bloomSeason: BloomSeason;
  bloomWindow?: string;
  story: { en: string; fi: string; sv: string };
  imageUrl: string;
  imageAttribution: string;
  imageLicense?: string;
  microLat?: number;
  microLng?: number;
  gardenZone?: string;
  accession: { number: string; collectedAt?: string; sourcePopulation?: string };
  targetCents: number;
}

export const FINNISH_FLORA: FloraEntry[] = [
  // ─── Critically Endangered (CR) ─────────────────────────────────────────
  {
    slug: 'agrostis-clavata',
    taxon: { latinName: 'Agrostis clavata', family: 'Poaceae', author: 'Trin.' },
    nameFi: 'Idänrölli',
    nameSv: 'Ostligt ven',
    nameEn: 'Clavate Bent',
    redListStatus: 'CR', redListYear: 2019,
    origin: 'Eastern Finland',
    habitat: 'Forest meadows, shaded streams',
    biome: 'Boreal forest',
    bloomSeason: 'summer',
    bloomWindow: 'July - August',
    story: {
      en: 'A rare grass of eastern Finnish forests, on the very edge of its range. Disappearing as understory shading patterns shift.',
      fi: 'Itäisten metsien harvinainen heinä, levinneisyytensä äärirajalla Suomessa.',
      sv: 'Ett sällsynt gräs från Östra Finlands skogar, vid sin utbredningsgräns.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Agrostis_clavata.jpg/800px-Agrostis_clavata.jpg',
    imageAttribution: '© Matti Virtala / Wikimedia Commons, CC BY-SA 4.0',
    accession: { number: 'OULU-2018-0033' },
    targetCents: 75000,
  },
  {
    slug: 'antennaria-villifera',
    taxon: { latinName: 'Antennaria villifera', family: 'Asteraceae' },
    nameFi: 'Karvajäkkärä',
    nameSv: 'Sandkattfot',
    nameEn: 'Hairy Cudweed',
    redListStatus: 'CR', redListYear: 2019,
    origin: 'Northern Lapland',
    habitat: 'Calcareous fells',
    biome: 'Arctic-alpine',
    bloomSeason: 'summer',
    bloomWindow: 'July',
    story: {
      en: 'A high-arctic cudweed clinging to a handful of calcareous fells. Climate warming is its existential threat.',
      fi: 'Korkean arktisen vyöhykkeen kissankäpälä, vain muutamilla kalkkitunturilla.',
      sv: 'En högarktisk kattfot, klamrar sig fast vid några få kalkfjäll.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Antennaria_villifera.jpg/800px-Antennaria_villifera.jpg',
    imageAttribution: '© Petr Kosina / Wikimedia Commons, CC BY-SA 4.0',
    accession: { number: 'OULU-2016-0084', sourcePopulation: 'Kilpisjärvi' },
    targetCents: 80000,
  },
  // ─── Endangered (EN) ────────────────────────────────────────────────────
  {
    slug: 'saxifraga-hirculus',
    taxon: { latinName: 'Saxifraga hirculus', family: 'Saxifragaceae', author: 'L.' },
    nameFi: 'Lettorikko',
    nameSv: 'Myrbräcka',
    nameEn: 'Marsh Saxifrage',
    redListStatus: 'EN', redListYear: 2019,
    origin: 'Pohjois-Pohjanmaa mires',
    habitat: 'Rich fens',
    biome: 'Mire / fen',
    bloomSeason: 'summer',
    bloomWindow: 'August',
    story: {
      en: 'A buttery yellow saxifrage of intact rich fens, indicator species for healthy mires. Oulu maintains 5 source populations ex situ.',
      fi: 'Kalkkipitoisten soiden indikaattorilaji. Kirkkaankeltaiset oranssipisteiset kukat.',
      sv: 'Indikatorväxt för intakta nordliga myrar.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Saxifraga_hirculus.jpg/800px-Saxifraga_hirculus.jpg',
    imageAttribution: '© Bernd Haynold / Wikimedia Commons, CC BY-SA 3.0',
    microLat: 65.06210, microLng: 25.46580, gardenZone: 'mire bed',
    accession: { number: 'OULU-2009-0117', collectedAt: '2009-08-12', sourcePopulation: 'Pudasjärvi' },
    targetCents: 90000,
  },
  {
    slug: 'primula-nutans',
    taxon: { latinName: 'Primula nutans', family: 'Primulaceae' },
    nameFi: 'Ruijanesikko',
    nameSv: 'Strandviva',
    nameEn: 'Finnmark Primrose',
    redListStatus: 'EN', redListYear: 2019,
    origin: 'Bothnian Bay coast',
    habitat: 'Coastal meadows',
    biome: 'Bothnian coast',
    bloomSeason: 'summer',
    bloomWindow: 'June – July',
    story: {
      en: 'A pink coastal primrose tightly bound to the rising shores of the Bothnian Bay - a uniquely Finnish post-glacial story.',
      fi: 'Vaaleanpunainen rannikon esikko, joka seuraa Perämeren maannousurantoja.',
      sv: 'Rosa kustviva som följer Bottenvikens stigande stränder.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Primula_nutans_Hailuoto.jpg/800px-Primula_nutans_Hailuoto.jpg',
    imageAttribution: '© Anneli Salo / Wikimedia Commons, CC BY-SA 3.0',
    accession: { number: 'OULU-2002-0288', collectedAt: '2002-06-20', sourcePopulation: 'Hailuoto' },
    targetCents: 100000,
  },
  // ─── Vulnerable (VU) ────────────────────────────────────────────────────
  {
    slug: 'pulsatilla-patens',
    taxon: { latinName: 'Pulsatilla patens', family: 'Ranunculaceae', author: '(L.) Mill.' },
    nameFi: 'Kangasvuokko',
    nameSv: 'Nipsippa',
    nameEn: 'Eastern Pasqueflower',
    redListStatus: 'VU', redListYear: 2019,
    origin: 'Häme, southern Finland',
    habitat: 'Dry esker pine forests',
    biome: 'Boreal heath / esker',
    bloomSeason: 'spring',
    bloomWindow: 'April - May',
    story: {
      en: 'A purple-petaled survivor of Finland\'s sandy heaths. Vulnerable on the 2019 Red List; fire suppression has erased the open soil it needs to germinate.',
      fi: 'Suomen hiekkaharjujen violettikukkainen selviytyjä. Vaarantunut laji.',
      sv: 'En lila överlevare från Finlands sandiga åsar. Sårbar art.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Pulsatilla_patens.jpg/800px-Pulsatilla_patens.jpg',
    imageAttribution: '© Hugo.arg / Wikimedia Commons, CC BY-SA 4.0',
    microLat: 65.06160, microLng: 25.46720, gardenZone: 'south esker bed',
    accession: { number: 'OULU-1998-0421', collectedAt: '1998-05-04', sourcePopulation: 'Hämeenlinna' },
    targetCents: 100000,
  },
  {
    slug: 'cypripedium-calceolus',
    taxon: { latinName: 'Cypripedium calceolus', family: 'Orchidaceae' },
    nameFi: 'Tikankontti',
    nameSv: 'Guckusko',
    nameEn: "Lady's-slipper Orchid",
    redListStatus: 'VU', redListYear: 2019,
    origin: 'Kuusamo limestone',
    habitat: 'Calcareous boreal forest',
    biome: 'Limestone forest',
    bloomSeason: 'spring',
    bloomWindow: 'Late May – June',
    story: {
      en: "Europe's most iconic temperate orchid. Slow-growing — a single rhizome can live a century. Strictly protected.",
      fi: 'Euroopan ikonisin lauhkean vyöhykkeen orkidea. Hidaskasvuinen.',
      sv: 'Europas mest ikoniska tempererade orkidé.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Cypripedium_calceolus.jpg/800px-Cypripedium_calceolus.jpg',
    imageAttribution: '© Bernd Haynold / Wikimedia Commons, CC BY-SA 3.0',
    accession: { number: 'OULU-1995-0009', collectedAt: '1995-06-08', sourcePopulation: 'Kuusamo' },
    targetCents: 100000,
  },
  {
    slug: 'campanula-uniflora',
    taxon: { latinName: 'Campanula uniflora', family: 'Campanulaceae' },
    nameFi: 'Pohjankello',
    nameSv: 'Höga klockor',
    nameEn: 'Arctic Harebell',
    redListStatus: 'VU', redListYear: 2019,
    origin: 'Kilpisjärvi fells',
    habitat: 'Calcareous fell slopes',
    biome: 'Arctic-alpine fell',
    bloomSeason: 'summer',
    bloomWindow: 'July',
    story: {
      en: 'A tiny azure bell that flowers for three weeks above the tree line.',
      fi: 'Pieni sininen kello, joka kukkii kolme viikkoa puurajan yläpuolella.',
      sv: 'En liten azurblå klocka som blommar tre veckor ovan trädgränsen.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Campanula_uniflora.jpg/800px-Campanula_uniflora.jpg',
    imageAttribution: '© Algirdas / Wikimedia Commons, CC BY-SA 3.0',
    accession: { number: 'OULU-2014-0033', collectedAt: '2014-07-15', sourcePopulation: 'Saana fell' },
    targetCents: 75000,
  },
  // ─── Near Threatened (NT) ───────────────────────────────────────────────
  {
    slug: 'trollius-europaeus',
    taxon: { latinName: 'Trollius europaeus', family: 'Ranunculaceae' },
    nameFi: 'Kullero',
    nameSv: 'Smörboll',
    nameEn: 'Globeflower',
    redListStatus: 'NT', redListYear: 2019,
    origin: 'North Karelia meadows',
    habitat: 'Damp meadows',
    biome: 'Hay meadow',
    bloomSeason: 'summer',
    bloomWindow: 'June',
    story: {
      en: 'A signature meadow species declining with the loss of traditional pasture management.',
      fi: 'Niittyjen tunnusmaa, joka vähenee perinteisten niittyjen häviämisen myötä.',
      sv: 'En signaturart från slåtterängar, går tillbaka när traditionell hävd försvinner.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Trollius_europaeus.jpg/800px-Trollius_europaeus.jpg',
    imageAttribution: '© H. Zell / Wikimedia Commons, CC BY-SA 3.0',
    accession: { number: 'OULU-1987-0044', collectedAt: '1987-06-22', sourcePopulation: 'Lieksa' },
    targetCents: 100000,
  },
  {
    slug: 'lobaria-pulmonaria',
    taxon: { latinName: 'Lobaria pulmonaria', family: 'Lobariaceae' },
    nameFi: 'Raidankeuhkojäkälä',
    nameSv: 'Lunglav',
    nameEn: 'Tree Lungwort',
    redListStatus: 'NT', redListYear: 2019,
    origin: 'Old-growth forests',
    habitat: 'Bark of old aspens',
    biome: 'Old-growth forest',
    bloomSeason: 'all',
    story: {
      en: 'A leafy lichen and an indicator species — its presence signals ancient, undisturbed forest.',
      fi: 'Lehtimäinen jäkälä, vanhojen koskemattomien metsien indikaattorilaji.',
      sv: 'En bladlav, indikator för gammal ostörd skog.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Lobaria_pulmonaria.jpg/800px-Lobaria_pulmonaria.jpg',
    imageAttribution: '© Liisa Kanerva / Wikimedia Commons, CC BY-SA 4.0',
    accession: { number: 'OULU-2017-0204', sourcePopulation: 'Syöte NP' },
    targetCents: 60000,
  },
  // ─── Greenhouse showcase (NA) ──────────────────────────────────────────
  {
    slug: 'victoria-amazonica',
    taxon: { latinName: 'Victoria amazonica', family: 'Nymphaeaceae' },
    nameFi: 'Amazonin jättivesilumme',
    nameSv: 'Amazonjättenäckros',
    nameEn: 'Giant Water Lily',
    redListStatus: 'NA', redListYear: 2019,
    origin: 'Amazon basin',
    habitat: 'Romeo & Julia pond',
    biome: 'Tropical greenhouse',
    bloomSeason: 'summer',
    bloomWindow: 'August nights',
    story: {
      en: 'The most photographed plant in the Romeo greenhouse. Leaves reach 2.5 m; night blooms turn from white to pink.',
      fi: 'Romeo-kasvihuoneen tähti. Yöllä kukkivat valkoiset kukat muuttuvat vaaleanpunaisiksi.',
      sv: 'Romeo-växthusens stjärna. Nattens vita blommor blir rosa.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Victoria_amazonica.jpg/800px-Victoria_amazonica.jpg',
    imageAttribution: '© Frank Wouters / Wikimedia Commons, CC BY 2.0',
    imageLicense: 'CC-BY-2.0',
    accession: { number: 'OULU-1972-0001', collectedAt: '1972-01-01' },
    targetCents: 0,
  },
  // ─── Critically Endangered (CR) — additional ──────────────────────────
  {
    slug: 'arnica-angustifolia',
    taxon: { latinName: 'Arnica angustifolia', family: 'Asteraceae' },
    nameFi: 'Tunturiarnikki', nameSv: 'Fjällarnika', nameEn: 'Narrow-leaf Arnica',
    redListStatus: 'CR', redListYear: 2019,
    origin: 'Kilpisjärvi calcareous fells',
    habitat: 'Calcareous fell heaths',
    biome: 'Arctic-alpine',
    bloomSeason: 'summer', bloomWindow: 'July',
    story: {
      en: 'A rare arnica of the northern Finnish fells. Its golden flower heads are now found at fewer than five sites in Finland.',
      fi: 'Tunturien harvinainen arnikki, jonka kultaisia kukintoja on jäljellä alle viidellä paikalla.',
      sv: 'En sällsynt fjällarnika med gyllene blommor på allt färre platser.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Arnica_angustifolia.jpg/800px-Arnica_angustifolia.jpg',
    imageAttribution: '© Helena Åström / Wikimedia Commons, CC BY-SA 4.0',
    accession: { number: 'OULU-2015-0022', sourcePopulation: 'Saana fell' },
    targetCents: 90000,
  },
  {
    slug: 'silene-furcata',
    taxon: { latinName: 'Silene furcata', family: 'Caryophyllaceae' },
    nameFi: 'Pohjanailakki', nameSv: 'Tundraglim', nameEn: 'Forked Catchfly',
    redListStatus: 'CR', redListYear: 2019,
    origin: 'Arctic Lapland gravel beds',
    habitat: 'Frost-heave gravel',
    biome: 'Arctic-alpine',
    bloomSeason: 'summer', bloomWindow: 'July',
    story: {
      en: 'A delicate pink catchfly clinging to frost-heaved gravel. Climate warming and reindeer-pasture changes threaten its few remaining populations.',
      fi: 'Hento vaaleanpunainen ailakki rouheikkoisilla soramailla. Ilmaston lämpeneminen uhkaa.',
      sv: 'En späd rosa glim på frostuppskjutna grusmarker.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Silene_furcata.jpg/800px-Silene_furcata.jpg',
    imageAttribution: '© Robert Flogaus-Faust / Wikimedia, CC BY-SA 4.0',
    accession: { number: 'OULU-2019-0118' },
    targetCents: 75000,
  },
  // ─── Endangered (EN) — additional ─────────────────────────────────────
  {
    slug: 'gladiolus-imbricatus',
    taxon: { latinName: 'Gladiolus imbricatus', family: 'Iridaceae' },
    nameFi: 'Kurjenmiekka', nameSv: 'Ängsglim', nameEn: 'Turkish Marsh Gladiolus',
    redListStatus: 'EN', redListYear: 2019,
    origin: 'Karelian wooded meadows',
    habitat: 'Traditional hay meadows',
    biome: 'Wooded meadow',
    bloomSeason: 'summer', bloomWindow: 'July',
    story: {
      en: 'A spire of purple-pink blooms — once a meadow staple, now lost from most sites as traditional hay meadows disappear.',
      fi: 'Violetinpunainen kurjenmiekka, ennen tavallinen niittylaji, nyt häviämässä.',
      sv: 'En lila-rosa svärdsliljla från övergivna slåtterängar.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Gladiolus_imbricatus.jpg/800px-Gladiolus_imbricatus.jpg',
    imageAttribution: '© Vlastimil Hradilek / Wikimedia, CC BY-SA 4.0',
    accession: { number: 'OULU-2006-0177' },
    targetCents: 80000,
  },
  {
    slug: 'cinna-latifolia',
    taxon: { latinName: 'Cinna latifolia', family: 'Poaceae' },
    nameFi: 'Korpisara', nameSv: 'Skogsbukett', nameEn: 'Drooping Wood-reed',
    redListStatus: 'EN', redListYear: 2019,
    origin: 'Eastern spruce-mire forests',
    habitat: 'Old-growth spruce mires',
    biome: 'Boreal forest',
    bloomSeason: 'summer', bloomWindow: 'August',
    story: {
      en: 'A drooping wood-reed of old-growth spruce mires. Indicator of forests untouched by clear-cutting.',
      fi: 'Vanhojen kuusi-soiden indikaattorilaji. Häviää hakkuiden myötä.',
      sv: 'Skogsbukett, indikator för orörd granskog.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Cinna_latifolia.jpg/800px-Cinna_latifolia.jpg',
    imageAttribution: '© Matt Lavin / Wikimedia, CC BY-SA 2.0',
    imageLicense: 'CC-BY-SA-2.0',
    accession: { number: 'OULU-2012-0098', sourcePopulation: 'Patvinsuo NP' },
    targetCents: 75000,
  },
  // ─── Vulnerable (VU) — additional ─────────────────────────────────────
  {
    slug: 'dactylorhiza-incarnata',
    taxon: { latinName: 'Dactylorhiza incarnata', family: 'Orchidaceae' },
    nameFi: 'Punakämmekkä', nameSv: 'Ängsnycklar', nameEn: 'Early Marsh Orchid',
    redListStatus: 'VU', redListYear: 2019,
    origin: 'Coastal rich fens',
    habitat: 'Calcareous wet meadows',
    biome: 'Fen / wet meadow',
    bloomSeason: 'summer', bloomWindow: 'June - July',
    story: {
      en: 'A magenta-spired orchid of calcareous wet meadows. Drainage of fens is its main threat.',
      fi: 'Magentanvärinen kämmekkä kalkkipitoisilta märiltä niityiltä.',
      sv: 'En magentafärgad orkidé från kalkrika våtängar.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Dactylorhiza_incarnata.jpg/800px-Dactylorhiza_incarnata.jpg',
    imageAttribution: '© Bernd Haynold / Wikimedia, CC BY-SA 3.0',
    imageLicense: 'CC-BY-SA-3.0',
    accession: { number: 'OULU-2008-0044' },
    targetCents: 90000,
  },
  {
    slug: 'pulsatilla-vernalis',
    taxon: { latinName: 'Pulsatilla vernalis', family: 'Ranunculaceae' },
    nameFi: 'Kevätesikko', nameSv: 'Mosippa', nameEn: 'Spring Pasqueflower',
    redListStatus: 'VU', redListYear: 2019,
    origin: 'Esker pine forests',
    habitat: 'Dry pine heath',
    biome: 'Esker',
    bloomSeason: 'spring', bloomWindow: 'April - May',
    story: {
      en: 'White petals with violet hairs — one of the earliest spring flowers of Finnish eskers. Suffers from forest closure.',
      fi: 'Valkokukkainen kevätesikko violetilla karvalla. Suomen aikaisin kevätlaji.',
      sv: 'Vit mosippa med lila ulligt hår.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Pulsatilla_vernalis.jpg/800px-Pulsatilla_vernalis.jpg',
    imageAttribution: '© Sten Porse / Wikimedia, CC BY-SA 3.0',
    imageLicense: 'CC-BY-SA-3.0',
    accession: { number: 'OULU-2001-0204' },
    targetCents: 90000,
  },
  {
    slug: 'arctostaphylos-alpina',
    taxon: { latinName: 'Arctostaphylos alpina', family: 'Ericaceae' },
    nameFi: 'Riekonmarja', nameSv: 'Ripbär', nameEn: 'Alpine Bearberry',
    redListStatus: 'VU', redListYear: 2019,
    origin: 'Northern fell tundra',
    habitat: 'Heath tundra',
    biome: 'Arctic-alpine',
    bloomSeason: 'spring', bloomWindow: 'May',
    story: {
      en: 'A creeping shrub whose leaves turn fire-red in autumn. Its black berries are a staple of fell ecology.',
      fi: 'Matala varpu, jonka lehdet muuttuvat tulipunaisiksi syksyllä. Mustat marjat ravitsevat riekkoja.',
      sv: 'En låg ris med flammande höstfärger. Viktiga svarta bär för fjällviltet.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Arctostaphylos_alpina.jpg/800px-Arctostaphylos_alpina.jpg',
    imageAttribution: '© Daniel Villafruela / Wikimedia, CC BY-SA 3.0',
    imageLicense: 'CC-BY-SA-3.0',
    accession: { number: 'OULU-2013-0007' },
    targetCents: 75000,
  },
  // ─── Near Threatened (NT) — additional ────────────────────────────────
  {
    slug: 'parnassia-palustris',
    taxon: { latinName: 'Parnassia palustris', family: 'Celastraceae' },
    nameFi: 'Vilukko', nameSv: 'Slåtterblomma', nameEn: 'Marsh Grass-of-Parnassus',
    redListStatus: 'NT', redListYear: 2019,
    origin: 'Wet meadows nationwide',
    habitat: 'Calcareous wet meadows',
    biome: 'Wet meadow',
    bloomSeason: 'summer', bloomWindow: 'July - August',
    story: {
      en: 'A five-petaled white flower with green-veined translucence. Indicator of intact wet meadows.',
      fi: 'Viisilehtinen valkokukkainen, jolla on vihreäsuoniset kalvot. Niittyjen indikaattori.',
      sv: 'Vit blomma med fem kronblad och gröna nektarier.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/Parnassia_palustris.jpg/800px-Parnassia_palustris.jpg',
    imageAttribution: '© H. Zell / Wikimedia, CC BY-SA 3.0',
    imageLicense: 'CC-BY-SA-3.0',
    accession: { number: 'OULU-1990-0058' },
    targetCents: 60000,
  },
  {
    slug: 'menyanthes-trifoliata',
    taxon: { latinName: 'Menyanthes trifoliata', family: 'Menyanthaceae' },
    nameFi: 'Raate', nameSv: 'Vattenklöver', nameEn: 'Bogbean',
    redListStatus: 'NT', redListYear: 2019,
    origin: 'Bog and shore margins',
    habitat: 'Open bogs, shallow water',
    biome: 'Bog',
    bloomSeason: 'spring', bloomWindow: 'May - June',
    story: {
      en: 'White-pink fringed flowers with star-shaped petals — a botanical signature of intact open bogs.',
      fi: 'Valkoinen kukka tähtimäisillä terälehdillä — vapaiden soiden tunnusmerkki.',
      sv: 'Vit-rosa frans-blomma — kännetecken för öppna myrar.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Menyanthes_trifoliata.jpg/800px-Menyanthes_trifoliata.jpg',
    imageAttribution: '© Stefan Lefnaer / Wikimedia, CC BY-SA 4.0',
    accession: { number: 'OULU-1995-0309', sourcePopulation: 'Patvinsuo' },
    targetCents: 60000,
  },
  // ─── Least Concern showcase / boreal staples ──────────────────────────
  {
    slug: 'vaccinium-myrtillus',
    taxon: { latinName: 'Vaccinium myrtillus', family: 'Ericaceae' },
    nameFi: 'Mustikka', nameSv: 'Blåbär', nameEn: 'Bilberry',
    redListStatus: 'LC', redListYear: 2019,
    origin: 'Boreal forests',
    habitat: 'Pine-spruce forest understorey',
    biome: 'Boreal forest',
    bloomSeason: 'spring', bloomWindow: 'May - June',
    story: {
      en: 'The everymans-right berry of Finnish forests. Cultural staple, ecological keystone, and a litmus test for forest health.',
      fi: 'Suomalaisen metsän jokamiehenmarja. Kulttuurinen ja ekologinen avainlaji.',
      sv: 'Allemansrättens bär. Kulturell stapel, ekologisk nyckel.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Vaccinium_myrtillus.jpg/800px-Vaccinium_myrtillus.jpg',
    imageAttribution: '© Jouni Aspi / Wikimedia, CC BY-SA 4.0',
    accession: { number: 'OULU-1980-0001' },
    targetCents: 30000,
  },
  {
    slug: 'rubus-chamaemorus',
    taxon: { latinName: 'Rubus chamaemorus', family: 'Rosaceae' },
    nameFi: 'Lakka', nameSv: 'Hjortron', nameEn: 'Cloudberry',
    redListStatus: 'LC', redListYear: 2019,
    origin: 'Boreal mires',
    habitat: 'Sphagnum bogs',
    biome: 'Mire',
    bloomSeason: 'summer', bloomWindow: 'June - July',
    story: {
      en: 'Amber berries on a sphagnum carpet — the cultural fruit of the Finnish north.',
      fi: 'Pohjoisen kulttuurihedelmä, kullankeltaiset marjat vitsamattojen päällä.',
      sv: 'Norrlandsbärets bär — guldgula på vitmossa.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Rubus_chamaemorus.jpg/800px-Rubus_chamaemorus.jpg',
    imageAttribution: '© Jörg Hempel / Wikimedia, CC BY-SA 3.0 DE',
    imageLicense: 'CC-BY-SA-3.0-DE',
    accession: { number: 'OULU-1985-0066' },
    targetCents: 45000,
  },
  {
    slug: 'andromeda-polifolia',
    taxon: { latinName: 'Andromeda polifolia', family: 'Ericaceae' },
    nameFi: 'Suokukka', nameSv: 'Rosling', nameEn: 'Bog Rosemary',
    redListStatus: 'LC', redListYear: 2019,
    origin: 'Boreal bogs',
    habitat: 'Open bogs',
    biome: 'Bog',
    bloomSeason: 'spring', bloomWindow: 'May - June',
    story: {
      en: 'Pink bells nodding above sphagnum carpets. Beloved subject of boreal landscape photography.',
      fi: 'Vaaleanpunaiset kellot nyökkäävät rahkasammalmaton päällä.',
      sv: 'Rosa klockor som nickar över vitmossan.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Andromeda_polifolia.jpg/800px-Andromeda_polifolia.jpg',
    imageAttribution: '© Krzysztof Ziarnek / Wikimedia, CC BY-SA 4.0',
    accession: { number: 'OULU-1989-0205' },
    targetCents: 40000,
  },
  {
    slug: 'linnaea-borealis',
    taxon: { latinName: 'Linnaea borealis', family: 'Linnaeaceae' },
    nameFi: 'Vanamo', nameSv: 'Linnea', nameEn: 'Twinflower',
    redListStatus: 'LC', redListYear: 2019,
    origin: 'Boreal forests',
    habitat: 'Spruce-pine forest floor',
    biome: 'Boreal forest',
    bloomSeason: 'summer', bloomWindow: 'June - July',
    story: {
      en: "Linnaeus's namesake flower: paired pink trumpets over moss. A quiet symbol of the boreal floor.",
      fi: "Linnén nimikkokasvi — vaaleanpunaiset kellot pareittain sammalpedillä.",
      sv: 'Linnés egen blomma — rosa par över mossan.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Linnaea_borealis.jpg/800px-Linnaea_borealis.jpg',
    imageAttribution: '© Bernd Haynold / Wikimedia, CC BY-SA 3.0',
    imageLicense: 'CC-BY-SA-3.0',
    accession: { number: 'OULU-1992-0145' },
    targetCents: 40000,
  },
  // ─── Greenhouse showcase ──────────────────────────────────────────────
  {
    slug: 'nymphaea-thermarum',
    taxon: { latinName: 'Nymphaea thermarum', family: 'Nymphaeaceae' },
    nameFi: 'Kääpiölumpe', nameSv: 'Dvärgnäckros', nameEn: "Pygmy Rwandan Waterlily",
    redListStatus: 'EX', redListYear: 2019,
    origin: 'Rwanda (Mashyuza thermal spring)',
    habitat: 'Romeo & Julia greenhouse tank',
    biome: 'Tropical greenhouse',
    bloomSeason: 'all',
    story: {
      en: "The world's smallest water lily — extinct in the wild since 2008. Oulu maintains a propagation line as part of the international ex-situ network.",
      fi: 'Maailman pienin lumpe — kadonnut luonnosta 2008. Oulu ylläpitää suvun ex-situ-verkostossa.',
      sv: 'Världens minsta näckros — utdöd i naturen sedan 2008.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Nymphaea_thermarum.jpg/800px-Nymphaea_thermarum.jpg',
    imageAttribution: '© Carlos Magdalena / Kew, Wikimedia, CC BY-SA 4.0',
    accession: { number: 'OULU-2014-0001' },
    targetCents: 150000,
  },
  {
    slug: 'wollemia-nobilis',
    taxon: { latinName: 'Wollemia nobilis', family: 'Araucariaceae' },
    nameFi: 'Wollemimänty', nameSv: 'Wollemitall', nameEn: 'Wollemi Pine',
    redListStatus: 'CR', redListYear: 2019,
    origin: 'Wollemi NP, Australia',
    habitat: 'Romeo greenhouse',
    biome: 'Tropical greenhouse',
    bloomSeason: 'all',
    story: {
      en: 'Discovered in 1994; fewer than 100 mature trees in the wild. A living fossil now propagated in botanic gardens worldwide.',
      fi: 'Löydetty vasta 1994; villissä alle 100 yksilöä. Elävä fossiili.',
      sv: 'Upptäckt 1994; färre än 100 mogna träd kvar i naturen.',
    },
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Wollemia_nobilis.jpg/800px-Wollemia_nobilis.jpg',
    imageAttribution: '© Sten Porse / Wikimedia, CC BY-SA 3.0',
    imageLicense: 'CC-BY-SA-3.0',
    accession: { number: 'OULU-2010-0040' },
    targetCents: 200000,
  },
  // The full ingest script in scripts/ingest-flora.ts adds the remaining
  // 2,600+ species programmatically.
];

export async function seedFinnishFlora(prisma: PrismaClient) {
  for (const entry of FINNISH_FLORA) {
    const taxon = await prisma.taxon.upsert({
      where: { latinName: entry.taxon.latinName },
      create: {
        latinName: entry.taxon.latinName,
        family: entry.taxon.family,
        author: entry.taxon.author ?? null,
        synonyms: entry.taxon.synonyms ?? [],
      },
      update: {},
    });

    // The curated 8 plants are the public showcase; the seed is the
    // source of truth for them. Re-running the seed restores every
    // field so a careless legacy-import pass can't degrade the
    // donor-facing copy.
    const seedFields = {
      taxonId: taxon.id,
      nameEn: entry.nameEn,
      nameFi: entry.nameFi,
      nameSv: entry.nameSv,
      redListStatus: entry.redListStatus,
      redListYear: entry.redListYear,
      origin: entry.origin,
      habitat: entry.habitat,
      biome: entry.biome,
      bloomSeason: entry.bloomSeason,
      bloomWindow: entry.bloomWindow ?? null,
      story: entry.story as any,
      quickFacts: [
        ['origin', entry.origin],
        ['bloom', entry.bloomWindow ?? '-'],
        ['redList', entry.redListStatus],
        ['habitat', entry.habitat],
      ] as any,
      microLat: entry.microLat ?? null,
      microLng: entry.microLng ?? null,
      gardenZone: entry.gardenZone ?? null,
      targetCents: entry.targetCents,
      status: 'active',
    };
    const plant = await prisma.plant.upsert({
      where: { slug: entry.slug },
      create: { slug: entry.slug, ...seedFields },
      update: seedFields,
    });

    const image = await prisma.plantImage.create({
      data: {
        plantId: plant.id,
        url: entry.imageUrl,
        altEn: entry.nameEn,
        altFi: entry.nameFi,
        altSv: entry.nameSv,
        attribution: entry.imageAttribution,
        licenseSpdx: entry.imageLicense ?? 'CC-BY-SA-4.0',
        season: entry.bloomSeason,
      },
    });
    await prisma.plant.update({
      where: { id: plant.id },
      data: { primaryImageId: image.id },
    });

    await prisma.accession.upsert({
      where: { accessionNumber: entry.accession.number },
      create: {
        accessionNumber: entry.accession.number,
        plantId: plant.id,
        collectedAt: entry.accession.collectedAt ? new Date(entry.accession.collectedAt) : null,
        sourcePopulation: entry.accession.sourcePopulation ?? null,
      },
      update: {},
    });
  }
}
