import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { PaymentsService } from '../payments/payments.service.js';

const PostalAddress = z.object({
  line1: z.string().max(120),
  line2: z.string().max(120).optional(),
  postalCode: z.string().max(16),
  city: z.string().max(80),
  country: z.string().length(2),
});

const CoAdopter = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email().optional(),
});

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
    homeRegion: z.string().max(32).optional(),
    postalAddress: PostalAddress.optional(),
  }),
  nickname: z.string().max(80).optional(),
  dedication: z.string().max(240).optional(),
  // Gift recipient
  giftRecipientName: z.string().max(120).optional(),
  giftRecipientEmail: z.string().email().optional(),
  giftDeliverOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  giftAnonymous: z.boolean().default(false),
  giftWrap: z.boolean().default(false),
  // Memorial
  memorialOf: z.string().max(120).optional(),
  memorialFamilyEmail: z.string().email().optional(),
  // Co-adopt
  coAdopters: z.array(CoAdopter).max(10).optional(),
  // Visibility + consent
  showOnDonorWall: z.boolean().default(true),
  marketingOptIn: z.boolean().default(false),
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

    // Refuse intent/tier combos that the funnel funds-flow doesn't support
    // — e.g. a memorial against the corporate tier would short-circuit the
    // family-email pathway. Match the demo design's UI gating.
    if (dto.intent === 'gift' && !dto.giftRecipientEmail) {
      throw new BadRequestException('Gift adoption requires giftRecipientEmail');
    }
    if (dto.intent === 'memorial' && !dto.memorialOf) {
      throw new BadRequestException('Memorial adoption requires memorialOf');
    }

    const tierBaseCents =
      dto.billingInterval === 'monthly' && tier.monthlyPriceCents
        ? tier.monthlyPriceCents
        : tier.annualPriceCents;
    // Gift-wrap add-on price is admin-configurable in SystemSetting
    // (`adoption.giftWrapCents`); the wizard surfaces the same value.
    const giftWrapCents = this.settings.get().adoption.giftWrapCents;
    const giftWrapAddOn = dto.intent === 'gift' && dto.giftWrap ? giftWrapCents : 0;
    const amountCents = tierBaseCents + giftWrapAddOn;

    // Find-or-create donor user; merge marketing opt-in into preferences
    // (the Adoption row also stores the snapshot for audit).
    const donor = await this.prisma.user.upsert({
      where: { email: dto.donor.email },
      update: {
        name: dto.donor.name ?? undefined,
        locale: dto.donor.locale,
        homeRegion: dto.donor.homeRegion ?? undefined,
        postalAddress: (dto.donor.postalAddress as any) ?? undefined,
        preferences: {
          // Shallow-merge — Prisma's Json type doesn't have a "deep merge"
          // primitive, so we read+spread above the upsert below.
        },
      },
      create: {
        email: dto.donor.email,
        name: dto.donor.name ?? null,
        locale: dto.donor.locale,
        homeRegion: dto.donor.homeRegion ?? null,
        postalAddress: (dto.donor.postalAddress as any) ?? Prisma.JsonNull,
        preferences: { marketingOptIn: dto.marketingOptIn },
      },
    });
    // If the donor already existed, persist the new marketingOptIn into
    // their JSON preferences without clobbering other keys.
    if (donor.preferences && typeof donor.preferences === 'object') {
      const merged = {
        ...(donor.preferences as Record<string, unknown>),
        marketingOptIn: dto.marketingOptIn,
      };
      await this.prisma.user.update({
        where: { id: donor.id },
        data: { preferences: merged as any },
      });
    }

    // Find-or-create gift recipient (only when intent=gift). The recipient
    // is a real User row so they can sign in with magic link and see the
    // gifted adoption in My Garden. Anonymous gifts still create the
    // recipient; the giftAnonymous flag only controls the email signature.
    let giftRecipientId: string | null = null;
    if (dto.intent === 'gift' && dto.giftRecipientEmail) {
      const recipient = await this.prisma.user.upsert({
        where: { email: dto.giftRecipientEmail },
        update: {
          name: dto.giftRecipientName ?? undefined,
        },
        create: {
          email: dto.giftRecipientEmail,
          name: dto.giftRecipientName ?? null,
          locale: dto.donor.locale,
        },
      });
      giftRecipientId = recipient.id;
    }

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
          memorialFamilyEmail: dto.memorialFamilyEmail ?? null,
          giftRecipientId,
          giftDeliverOn: dto.giftDeliverOn ? new Date(`${dto.giftDeliverOn}T00:00:00Z`) : null,
          giftAnonymous: dto.giftAnonymous,
          giftWrap: dto.giftWrap,
          coAdopters: dto.coAdopters && dto.coAdopters.length > 0 ? (dto.coAdopters as any) : Prisma.JsonNull,
          marketingOptIn: dto.marketingOptIn,
        },
      });
      // ADR-0001 §"Robustness": every mutation gets a full snapshot in
      // AuditLog. We capture the donor-facing fields verbatim so finance
      // can reconstruct exactly what was submitted, even if the row is
      // later edited from /admin.
      await this.audit.log(tx, {
        actorUserId: donor.id,
        action: 'adoption.create',
        resource: `Adoption/${a.id}`,
        after: {
          tierId: tier.id,
          plantId: plant.id,
          plantSlug: plant.slug,
          amountCents,
          tierBaseCents,
          giftWrapAddOn,
          intent: dto.intent,
          recurring: dto.recurring,
          billingInterval: dto.billingInterval,
          homeRegion: dto.donor.homeRegion ?? null,
          nickname: dto.nickname ?? null,
          dedication: dto.dedication ?? null,
          showOnDonorWall: dto.showOnDonorWall,
          giftRecipientEmail: dto.giftRecipientEmail ?? null,
          giftRecipientId,
          giftDeliverOn: dto.giftDeliverOn ?? null,
          giftAnonymous: dto.giftAnonymous,
          giftWrap: dto.giftWrap,
          memorialOf: dto.memorialOf ?? null,
          memorialFamilyEmail: dto.memorialFamilyEmail ?? null,
          coAdopters: dto.coAdopters ?? [],
          marketingOptIn: dto.marketingOptIn,
          preferredProvider: dto.preferredProvider ?? null,
        },
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
        description: dto.giftWrap
          ? `Adopt ${plant.nameEn} (${tier.name}) + linen gift-wrap`
          : `Adopt ${plant.nameEn} (${tier.name})`,
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
