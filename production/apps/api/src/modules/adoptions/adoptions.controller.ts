import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Ip,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { renderAdoptionCertificatePdf } from '@bloomoulu/emails/pdf/adoption-certificate';
import { getWebUrl } from '@bloomoulu/constants';
import {
  AdoptionsService,
  CreateAdoptionDto,
  CreateBundleDto,
} from './adoptions.service.js';

const STAFF_ROLES = new Set(['curator', 'finance', 'admin']);

@ApiTags('Adoptions')
@Controller('adoptions')
export class AdoptionsController {
  constructor(
    private readonly svc: AdoptionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Start an adoption + initiate payment' })
  async create(
    @Body(new ZodValidationPipe(CreateAdoptionDto)) dto: CreateAdoptionDto,
    @Ip() ip: string,
  ) {
    return this.svc.create(dto, ip);
  }

  @Post('bundle')
  @ApiOperation({
    summary: 'Adopt N plants with one Paytrail/MobilePay session',
    description:
      'All sibling adoptions share a bundleId. The webhook activates ' +
      'them together on payment success.',
  })
  async bundle(
    @Body(new ZodValidationPipe(CreateBundleDto)) dto: CreateBundleDto,
    @Ip() ip: string,
  ) {
    return this.svc.createBundle(dto, ip);
  }

  /**
   * Renders + streams the digital adoption certificate PDF on demand.
   * No persistence — the certificate is deterministic from Adoption +
   * Plant + Tier + donor name, so we can re-render any time without
   * worrying about stale storage. Donor or staff can pull it.
   */
  @Get(':id/certificate.pdf')
  @Roles('donor', 'curator', 'finance', 'admin')
  async certificatePdf(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const a = await this.prisma.adoption.findUnique({
      where: { id },
      include: {
        donor: { select: { id: true, name: true, email: true, locale: true } },
        plant: { select: { nameEn: true, nameFi: true, nameSv: true, slug: true, taxon: { select: { latinName: true } } } },
        tier: { select: { id: true, name: true, nameFi: true, nameSv: true } },
      },
    });
    if (!a) throw new NotFoundException();
    const isOwner = a.donor.id === actor.sub;
    const isGiftRecipient = a.giftRecipientId === actor.sub;
    if (!isOwner && !isGiftRecipient && !STAFF_ROLES.has(actor.role)) {
      throw new ForbiddenException();
    }
    if (!isOwner) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: actor.sub,
          action: 'staff.adoptionCertificate.download',
          resource: `Adoption/${a.id}`,
        },
      });
    }
    const locale = a.donor.locale ?? 'en';
    const tierLabel =
      locale === 'fi' ? a.tier.nameFi ?? a.tier.name : locale === 'sv' ? a.tier.nameSv ?? a.tier.name : a.tier.name;
    const plantLatin = a.plant.taxon?.latinName ?? a.plant.nameEn;
    const plantCommon =
      locale === 'fi' ? a.plant.nameFi : locale === 'sv' ? a.plant.nameSv : a.plant.nameEn;
    // Number is deterministic so re-issues look identical.
    const certificateNumber = `ADOPT-${new Date(a.createdAt).getUTCFullYear()}-${a.id.slice(0, 8).toUpperCase()}`;
    const amountLabel = `€${(a.amountCents / 100).toFixed(0)} · ${a.billingInterval.replace('_', '-')}`;
    const pdf = await renderAdoptionCertificatePdf({
      certificateNumber,
      locale: locale as 'en' | 'fi' | 'sv',
      donorName: a.donor.name ?? a.donor.email,
      plantLatin,
      plantCommon: plantCommon && plantCommon !== plantLatin ? plantCommon : null,
      tierName: tierLabel,
      amount: amountLabel,
      dedication: a.dedication,
      nickname: a.nickname,
      issuedAt: a.startedAt ?? a.createdAt,
      verificationUrl: `${getWebUrl().replace(/\/$/, '')}/${locale}/plants/${a.plant.slug}`,
    });
    reply
      .code(200)
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `inline; filename="${certificateNumber}.pdf"`,
      )
      .header('cache-control', 'private, no-cache')
      .send(pdf);
  }
}
