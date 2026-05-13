import type { PrismaClient } from '@prisma/client';
import { EMAIL_TEMPLATES } from '@bloomoulu/emails/templates/seed';

export async function seedEmails(prisma: PrismaClient) {
  for (const t of EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { slug: t.slug },
      create: t,
      update: t,
    });
  }
}
