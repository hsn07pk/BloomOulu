#!/usr/bin/env tsx
/**
 * Render-check the adoption certificate for one adoption and write it to
 * storage so it can be fetched at /v1/files/certificates/_test-<id>.pdf.
 * Confirms the on-demand certificate renderer works against real data
 * (the live route at GET /v1/adoptions/:id/certificate.pdf renders the
 * same PDF behind donor/staff auth, never persisting it).
 *
 *   pnpm tsx scripts/test-cert-render.ts <adoptionId>
 */
import { prisma } from '@bloomoulu/db';
import { renderAdoptionCertificatePdf } from '@bloomoulu/emails/pdf/adoption-certificate';
import { getWebUrl } from '@bloomoulu/constants';
import { uploadToS3 } from '../apps/api/src/infra/storage.js';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('usage: test-cert-render.ts <adoptionId>');
    process.exit(1);
  }
  const a = await prisma.adoption.findUnique({
    where: { id },
    include: { donor: true, plant: { include: { taxon: true } }, tier: true },
  });
  if (!a) {
    console.log('adoption not found');
    return;
  }
  const locale = (a.donor.locale ?? 'en') as 'en' | 'fi' | 'sv';
  const plantLatin = a.plant.taxon?.latinName ?? a.plant.nameEn;
  const plantCommon =
    locale === 'fi' ? a.plant.nameFi : locale === 'sv' ? a.plant.nameSv : a.plant.nameEn;
  const tierLabel =
    locale === 'fi'
      ? a.tier.nameFi ?? a.tier.name
      : locale === 'sv'
        ? a.tier.nameSv ?? a.tier.name
        : a.tier.name;
  const certificateNumber = `ADOPT-${new Date(a.createdAt).getUTCFullYear()}-${a.id.slice(0, 8).toUpperCase()}`;
  const pdf = await renderAdoptionCertificatePdf({
    certificateNumber,
    locale,
    donorName: a.donor.name ?? a.donor.email,
    plantLatin,
    plantCommon: plantCommon && plantCommon !== plantLatin ? plantCommon : null,
    tierName: tierLabel,
    amount: `€${(a.amountCents / 100).toFixed(0)}`,
    dedication: a.dedication,
    nickname: a.nickname,
    issuedAt: a.startedAt ?? a.createdAt,
    verificationUrl: `${getWebUrl().replace(/\/$/, '')}/${locale}/plants/${a.plant.slug}`,
  });
  const key = `certificates/_test-${a.id}.pdf`;
  await uploadToS3({ key, body: pdf, contentType: 'application/pdf' });
  console.log(`rendered ${certificateNumber}: ${pdf.length} bytes -> /v1/files/${key}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
