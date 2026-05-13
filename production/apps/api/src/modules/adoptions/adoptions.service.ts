import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PaymentsService } from '../payments/payments.service.js';

export const CreateAdoptionDto = z.object({
  plantSlug: z.string().min(1).max(120),
  tierId: z.enum(['seedling', 'rooted', 'vulnerable', 'endangered', 'corporate']),
  intent: z.enum(['for_self', 'gift', 'memorial', 'class', 'corporate']).default('for_self'),
  recurring: z.boolean().default(true),
  billingInterval: z.enum(['annual', 'monthly', 'one_time']).default('annual'),
  donor: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(120).optional(),
    locale: z.enum(['en', 'fi', 'sv']).default('fi'),
    countryCode: z.string().length(2).default('FI'),
    homeRegion: z.string().max(8).optional(),
    postalAddress: z
      .object({
        line1: z.string().max(120),
        line2: z.string().max(120).optional(),
        postalCode: z.string().max(16),
        city: z.string().max(80),
        country: z.string().length(2),
      })
      .optional(),
  }),
  nickname: z.string().max(80).optional(),
  dedication: z.string().max(240).optional(),
  giftRecipientEmail: z.string().email().optional(),
  memorialOf: z.string().max(120).optional(),
  showOnDonorWall: z.boolean().default(true),
  preferredProvider: z.enum(['paytrail', 'mobilepay', 'bank_transfer']).optional(),
});
export type CreateAdoptionDto = z.infer<typeof CreateAdoptionDto>;

@Injectable()
export class AdoptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
  ) {}

  async create(dto: CreateAdoptionDto, actorIp?: string) {
    const plant = await this.prisma.plant.findUnique({ where: { slug: dto.plantSlug } });
    if (!plant) throw new NotFoundException(`Plant ${dto.plantSlug} not found`);

    const tier = await this.prisma.tier.findUnique({ where: { id: dto.tierId } });
    if (!tier) throw new NotFoundException(`Tier ${dto.tierId} not found`);

    const amountCents =
      dto.billingInterval === 'monthly' && tier.monthlyPriceCents
        ? tier.monthlyPriceCents
        : tier.annualPriceCents;

    // Find-or-create donor user
    const donor = await this.prisma.user.upsert({
      where: { email: dto.donor.email },
      update: {
        name: dto.donor.name ?? undefined,
        locale: dto.donor.locale,
        homeRegion: dto.donor.homeRegion ?? undefined,
        postalAddress: dto.donor.postalAddress as any,
      },
      create: {
        email: dto.donor.email,
        name: dto.donor.name ?? null,
        locale: dto.donor.locale,
        homeRegion: dto.donor.homeRegion ?? null,
        postalAddress: (dto.donor.postalAddress as any) ?? Prisma.JsonNull,
      },
    });

    const adoption = await this.prisma.$transaction(async (tx) => {
      const a = await tx.adoption.create({
        data: {
          donorId: donor.id,
          plantId: plant.id,
          tierId: tier.id as any,
          intent: dto.intent as any,
          recurring: dto.recurring,
          billingInterval: dto.billingInterval as any,
          amountCents,
          status: 'pending',
          nickname: dto.nickname ?? null,
          dedication: dto.dedication ?? null,
          showOnDonorWall: dto.showOnDonorWall,
          homeRegion: dto.donor.homeRegion ?? null,
          memorialOf: dto.memorialOf ?? null,
        },
      });
      await this.audit.log(tx, {
        actorUserId: donor.id,
        action: 'adoption.create',
        resource: `Adoption/${a.id}`,
        after: { tierId: tier.id, plantId: plant.id, amountCents },
        ip: actorIp ?? null,
      });
      return a;
    });

    const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
    const handoff = await this.payments.initiate(
      {
        donorId: donor.id,
        donorEmail: donor.email,
        donorName: donor.name ?? undefined,
        donorLocale: donor.locale as 'en' | 'fi' | 'sv',
        donorCountry: dto.donor.countryCode,
        preferredProvider: dto.preferredProvider,
        amountCents,
        intent: dto.intent,
        recurring: dto.recurring,
        description: `Adopt ${plant.nameEn} (${tier.name})`,
        adoptionId: adoption.id,
        successUrl: `${webUrl}/${donor.locale}/garden?orderId={ORDER_ID}`,
        cancelUrl: `${webUrl}/${donor.locale}/adopt?plant=${plant.slug}`,
      },
      actorIp,
    );

    return {
      adoptionId: adoption.id,
      ...handoff,
    };
  }
}
