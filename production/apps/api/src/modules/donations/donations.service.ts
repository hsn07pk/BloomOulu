import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { LocaleEnum, PaymentProviderEnum, getWebUrl } from '@bloomoulu/constants';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PaymentsService } from '../payments/payments.service.js';

/**
 * One-time donation. The donor gives a freely-chosen (or suggested) amount,
 * optionally directed to a species they care about (plantSlug). There are no
 * tiers, perks, recurring billing, gifts, or bundles — a gift is a single
 * payment to the Garden's conservation programme.
 */
export const CreateDonationDto = z.object({
  /** Optional species the donor wants to support; omit for a general gift. */
  plantSlug: z.string().min(1).max(120).optional(),
  /** Amount in cents. Bounds re-checked server-side against admin settings. */
  amountCents: z.number().int().positive(),
  donor: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(120).optional(),
    locale: LocaleEnum.default('fi'),
    countryCode: z.string().length(2).default('FI'),
  }),
  /** Optional public dedication / tribute ("In memory of …"). */
  dedication: z.string().max(240).optional(),
  showOnWall: z.boolean().default(true),
  anonymous: z.boolean().default(false),
  marketingOptIn: z.boolean().default(false),
  preferredProvider: PaymentProviderEnum.optional(),
});
export type CreateDonationDto = z.infer<typeof CreateDonationDto>;

@Injectable()
export class DonationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
  ) {}

  async create(dto: CreateDonationDto, actorIp?: string) {
    const { minCents, maxCents, dedicationMaxChars } = this.settings.get().donation;
    if (dto.amountCents < minCents || dto.amountCents > maxCents) {
      throw new BadRequestException(
        `Donation amount must be between ${minCents} and ${maxCents} cents`,
      );
    }
    if (dto.dedication && dto.dedication.length > dedicationMaxChars) {
      throw new BadRequestException(`Dedication exceeds ${dedicationMaxChars} characters`);
    }

    // Resolve the optional species designation.
    let plant: { id: string; slug: string; nameEn: string; redListStatus: string } | null = null;
    if (dto.plantSlug) {
      plant = await this.prisma.plant.findUnique({
        where: { slug: dto.plantSlug },
        select: { id: true, slug: true, nameEn: true, redListStatus: true },
      });
      if (!plant) throw new NotFoundException(`Plant ${dto.plantSlug} not found`);
      // Extinct (EX) species are still shown for awareness but can't be the
      // designated beneficiary — there's nothing left in the wild to fund.
      if (plant.redListStatus === 'EX') {
        throw new BadRequestException(
          `Plant ${plant.slug} is classified Extinct (EX) and cannot receive a directed gift`,
        );
      }
    }

    // Find-or-create donor user; snapshot the marketing consent.
    const donor = await this.prisma.user.upsert({
      where: { email: dto.donor.email },
      update: {
        name: dto.donor.name ?? undefined,
        locale: dto.donor.locale,
      },
      create: {
        email: dto.donor.email,
        name: dto.donor.name ?? null,
        locale: dto.donor.locale,
        preferences: { marketingOptIn: dto.marketingOptIn },
      },
    });
    if (donor.preferences && typeof donor.preferences === 'object') {
      await this.prisma.user.update({
        where: { id: donor.id },
        data: {
          preferences: {
            ...(donor.preferences as Record<string, unknown>),
            marketingOptIn: dto.marketingOptIn,
          } as Prisma.InputJsonValue,
        },
      });
    }

    const donation = await this.prisma.$transaction(async (tx) => {
      const d = await tx.donation.create({
        data: {
          donorId: donor.id,
          plantId: plant?.id ?? null,
          amountCents: dto.amountCents,
          status: 'pending',
          dedication: dto.dedication ?? null,
          showOnWall: dto.showOnWall,
          anonymous: dto.anonymous,
          marketingOptIn: dto.marketingOptIn,
        },
      });
      await this.audit.log(tx, {
        actorUserId: donor.id,
        action: 'donation.create',
        resource: `Donation/${d.id}`,
        after: {
          amountCents: dto.amountCents,
          plantId: plant?.id ?? null,
          plantSlug: plant?.slug ?? null,
          dedication: dto.dedication ?? null,
          showOnWall: dto.showOnWall,
          anonymous: dto.anonymous,
          marketingOptIn: dto.marketingOptIn,
          preferredProvider: dto.preferredProvider ?? null,
        },
        ip: actorIp ?? null,
      });
      return d;
    });

    const webUrl = getWebUrl();
    const description = plant
      ? `Donation to the Oulu Botanical Garden — ${plant.nameEn}`
      : `Donation to the Oulu Botanical Garden`;
    const handoff = await this.payments.initiate(
      {
        donorId: donor.id,
        donorEmail: donor.email,
        donorName: donor.name ?? undefined,
        donorLocale: donor.locale as 'en' | 'fi' | 'sv',
        donorCountry: dto.donor.countryCode,
        preferredProvider: dto.preferredProvider,
        amountCents: dto.amountCents,
        description,
        donationId: donation.id,
        // Paytrail appends ?checkout-stamp=…&checkout-status=ok&signature=…
        // here; /donate/complete reads them, verifies via GET /webhooks/paytrail,
        // then redirects to /garden.
        successUrl: `${webUrl}/${donor.locale}/donate/complete?donation=${donation.id}`,
        cancelUrl: plant
          ? `${webUrl}/${donor.locale}/donate?plant=${plant.slug}`
          : `${webUrl}/${donor.locale}/donate`,
      },
      actorIp,
    );

    return { donationId: donation.id, ...handoff };
  }
}
