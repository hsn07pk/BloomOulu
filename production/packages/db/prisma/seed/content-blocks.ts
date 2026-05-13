import type { PrismaClient } from '@prisma/client';

export async function seedContentBlocks(prisma: PrismaClient) {
  await prisma.contentBlock.upsert({
    where: { slug: 'home.hero' },
    update: {},
    create: {
      slug: 'home.hero',
      kind: 'hero',
      bodyEn: 'Turning every plant into a story, a supporter, and a step toward saving Finnish flora.',
      bodyFi: 'Jokaisesta kasvista tarina, tukija ja askel suomalaisen lajiston suojelemiseksi.',
      bodySv: 'Varje växt en berättelse, en stödjare, ett steg för att rädda den finska floran.',
      ctaText: { en: 'Adopt a plant', fi: 'Adoptoi kasvi', sv: 'Adoptera en växt' } as any,
      ctaHref: '/adopt',
      isPublished: true,
      sortOrder: 0,
    },
  });
  await prisma.contentBlock.upsert({
    where: { slug: 'policy.funds-flow' },
    update: {},
    create: {
      slug: 'policy.funds-flow',
      kind: 'policy',
      bodyEn: '## Where your money goes\n\n- **82%** directly to plant conservation, seed-bank operation, propagation.\n- **12%** to platform operations (hosting, payments, audit).\n- **6%** to printed perks (postcards, prints, books, seeds) sourced from Finnish artists and the Garden\'s own seed bank.\n\nAnnual audit reports are published every March.',
      bodyFi: '## Mihin lahjoituksesi menee\n\n- **82 %** suoraan kasvien suojeluun, siemenpankin toimintaan, lisäykseen.\n- **12 %** alustan ylläpitoon.\n- **6 %** painettuihin etuihin suomalaisilta taiteilijoilta.\n\nVuosittaiset tilintarkastusraportit julkaistaan maaliskuussa.',
      bodySv: '## Vart dina pengar går\n\n- **82 %** direkt till växtbevarande.\n- **12 %** plattformsdrift.\n- **6 %** tryckta förmåner från finska konstnärer.\n\nÅrliga revisionsrapporter publiceras varje mars.',
      isPublished: true,
      sortOrder: 10,
    },
  });
}
