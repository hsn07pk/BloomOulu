import type { PrismaClient } from '@prisma/client';

export async function seedCitations(prisma: PrismaClient) {
  const cites = [
    {
      sourceType: 'report' as const,
      displayTitle: 'LIFE+ ESCAPE Final Report',
      year: 2017,
      identifier: 'LIFE11 BIO/FI/000917',
      authors: 'Aspi, J. et al.',
      url: 'https://botanic.oulu.fi/life-escape',
      notes: 'Ex-situ conservation of Finnish native plant species, 2012-2017.',
    },
    {
      sourceType: 'paper' as const,
      displayTitle: 'Suomen lajien uhanalaisuus 2019',
      year: 2019,
      identifier: 'YM2019-RL',
      authors: 'Suomen ympäristökeskus (SYKE)',
      url: 'https://www.ymparisto.fi/punainenkirja',
      notes: 'The Red List of Finnish Species, 2019 assessment.',
    },
    {
      sourceType: 'database' as const,
      displayTitle: 'Oulu Botanical Garden Accession DB',
      year: 2026,
      identifier: 'oulu-accession-db',
      notes: 'Internal accession catalogue.',
    },
    {
      sourceType: 'database' as const,
      displayTitle: 'GBIF Backbone Taxonomy',
      year: 2026,
      identifier: 'GBIF-Backbone',
      url: 'https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c',
    },
    {
      sourceType: 'database' as const,
      displayTitle: 'IUCN Red List of Threatened Species',
      year: 2025,
      identifier: 'iucnredlist.org',
      url: 'https://www.iucnredlist.org',
    },
  ];
  for (const c of cites) {
    await prisma.citation.create({ data: c });
  }
}
