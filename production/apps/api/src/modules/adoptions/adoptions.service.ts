import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
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
  billingInterval: z.enum(['annual', 'monthly', 'one_time']).default('monthly'),
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

/**
 * Bundle DTO — one donor block, multiple cart items. Each item has its
 * own plant+tier+nickname; the rest (donor identity, recurring, etc.)
 * is shared. We deliberately keep gift/memorial out of this first
 * iteration because they need per-item recipient flows.
 */
export const CreateBundleDto = z.object({
  items: z.array(
    z.object({
      plantSlug: z.string().min(1).max(120),
      tierId: z.enum(['seedling', 'rooted', 'vulnerable', 'endangered', 'corporate']),
      nickname: z.string().max(80).optional(),
      dedication: z.string().max(240).optional(),
    }),
  ).min(1).max(25),
  recurring: z.boolean().default(true),
  billingInterval: z.enum(['annual', 'monthly', 'one_time']).default('monthly'),
  donor: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(120).optional(),
    locale: z.enum(['en', 'fi', 'sv']).default('fi'),
    countryCode: z.string().length(2).default('FI'),
    homeRegion: z.string().max(32).optional(),
    postalAddress: PostalAddress.optional(),
  }),
  showOnDonorWall: z.boolean().default(true),
  marketingOptIn: z.boolean().default(false),
  preferredProvider: z.enum(['paytrail', 'mobilepay', 'bank_transfer']).optional(),
});
export type CreateBundleDto = z.infer<typeof CreateBundleDto>;

@Injectable()
export class AdoptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
  ) {}

  async create(dto: CreateAdoptionDto, actorIp?: string) {
    // Gate `billingInterval` against the admin-controlled allow-list
    // (`adoption.intervalsEnabled` SystemSetting). Production default
    // hides annual; an admin can flip it on without redeploying.
    const allowed = this.settings.get().adoption.intervalsEnabled ?? ['monthly', 'one_time'];
    if (!allowed.includes(dto.billingInterval as 'monthly' | 'annual' | 'one_time')) {
      throw new BadRequestException(
        `Billing interval '${dto.billingInterval}' is disabled. Allowed: ${allowed.join(', ')}`,
      );
    }

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

  /**
   * Create N pending Adoption rows + ONE Payment for the sum. All
   * sibling Adoptions share a bundleId; the webhook activates them
   * together on payment success.
   */
  async createBundle(dto: CreateBundleDto, actorIp?: string) {
    // Gate `billingInterval` against the admin-controlled allow-list.
    const allowed = this.settings.get().adoption.intervalsEnabled ?? ['monthly', 'one_time'];
    if (!allowed.includes(dto.billingInterval as 'monthly' | 'annual' | 'one_time')) {
      throw new BadRequestException(
        `Billing interval '${dto.billingInterval}' is disabled. Allowed: ${allowed.join(', ')}`,
      );
    }

    // Resolve every plant + tier up front so we fail fast before
    // creating anything.
    const slugs = Array.from(new Set(dto.items.map((i) => i.plantSlug)));
    const plants = await this.prisma.plant.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true, nameEn: true },
    });
    const bySlug = new Map(plants.map((p) => [p.slug, p]));
    for (const slug of slugs) {
      if (!bySlug.has(slug)) throw new NotFoundException(`Plant ${slug} not found`);
    }

    const tierIds = Array.from(new Set(dto.items.map((i) => i.tierId)));
    const tiers = await this.prisma.tier.findMany({
      where: { id: { in: tierIds as any } },
    });
    const byTier = new Map(tiers.map((t) => [t.id as string, t]));
    for (const id of tierIds) {
      if (!byTier.has(id)) throw new NotFoundException(`Tier ${id} not found`);
    }

    // Per-item price = tier price for the chosen interval. Bundles don't
    // support per-item gift-wrap in this iteration (cart UI doesn't surface it).
    const perItemCents = dto.items.map((it) => {
      const tier = byTier.get(it.tierId)!;
      return dto.billingInterval === 'monthly' && tier.monthlyPriceCents
        ? tier.monthlyPriceCents
        : tier.annualPriceCents;
    });
    const totalCents = perItemCents.reduce((s, c) => s + c, 0);
    if (totalCents <= 0) throw new BadRequestException('Bundle total must be positive');

    // Donor upsert — same as single-item flow.
    const donor = await this.prisma.user.upsert({
      where: { email: dto.donor.email },
      update: {
        name: dto.donor.name ?? undefined,
        locale: dto.donor.locale,
        homeRegion: dto.donor.homeRegion ?? undefined,
        postalAddress: (dto.donor.postalAddress as any) ?? undefined,
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

    const bundleId = uuidv7();
    const adoptions = await this.prisma.$transaction(async (tx) => {
      const rows: Array<{ id: string; plantSlug: string; tierId: string; amountCents: number }> = [];
      for (let i = 0; i < dto.items.length; i++) {
        const it = dto.items[i]!;
        const plant = bySlug.get(it.plantSlug)!;
        const tier = byTier.get(it.tierId)!;
        const amountCents = perItemCents[i]!;
        const a = await tx.adoption.create({
          data: {
            donorId: donor.id,
            plantId: plant.id,
            tierId: tier.id as any,
            intent: 'for_self' as any,
            recurring: dto.recurring,
            billingInterval: dto.billingInterval as any,
            amountCents,
            status: 'pending',
            nickname: it.nickname ?? null,
            dedication: it.dedication ?? null,
            showOnDonorWall: dto.showOnDonorWall,
            homeRegion: dto.donor.homeRegion ?? null,
            marketingOptIn: dto.marketingOptIn,
            bundleId,
          },
        });
        rows.push({ id: a.id, plantSlug: plant.slug, tierId: tier.id as string, amountCents });
      }
      await this.audit.log(tx, {
        actorUserId: donor.id,
        action: 'adoption.bundle.create',
        resource: `Bundle/${bundleId}`,
        after: {
          bundleId,
          totalCents,
          itemCount: rows.length,
          items: rows,
          billingInterval: dto.billingInterval,
          recurring: dto.recurring,
        },
        ip: actorIp ?? null,
      });
      return rows;
    });

    // Single Paytrail/MobilePay session for the sum. The "head" adoption
    // is the first one — its activation will fan out to all siblings.
    const head = adoptions[0]!;
    const webUrl = process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000';
    const itemNames = adoptions
      .map((a) => bySlug.get(a.plantSlug)!.nameEn)
      .join(', ')
      .slice(0, 140);
    const handoff = await this.payments.initiate(
      {
        donorId: donor.id,
        donorEmail: donor.email,
        donorName: donor.name ?? undefined,
        donorLocale: donor.locale as 'en' | 'fi' | 'sv',
        donorCountry: dto.donor.countryCode,
        preferredProvider: dto.preferredProvider,
        amountCents: totalCents,
        intent: 'for_self',
        recurring: dto.recurring,
        description: `Adopt ${adoptions.length} plant${adoptions.length === 1 ? '' : 's'}: ${itemNames}`,
        adoptionId: head.id,
        // Paytrail appends ?checkout-stamp=...&checkout-status=ok&signature=...
        // to this URL; /donate/complete reads them, hits /webhooks/paytrail
        // (GET) to verify the signature, then redirects to /garden.
        successUrl: `${webUrl}/${donor.locale}/donate/complete?bundle=${bundleId}`,
        cancelUrl: `${webUrl}/${donor.locale}/cart?cancelled=1`,
      },
      actorIp,
    );

    return {
      bundleId,
      itemCount: adoptions.length,
      totalCents,
      adoptionIds: adoptions.map((a) => a.id),
      ...handoff,
    };
  }
}
