/**
 * REST surface for the Garden's disbursement workflow. Every route is
 * `finance` / `admin` only — the data shape (donor PII + transaction
 * detail) must not leak past the finance team.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DisbursementStatus } from '@prisma/client';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { Roles } from '../../common/roles.decorator.js';
import { CurrentUser, type AuthenticatedUser } from '../../common/current-user.decorator.js';
import { DisbursementsService } from './disbursements.service.js';

const CreateDraftDto = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  notes: z.string().max(2000).optional(),
  paymentIds: z.array(z.string().uuid()).max(10000).optional(),
});

const UpdateEntriesDto = z.object({
  include: z.array(z.string().uuid()).max(10000).optional(),
  exclude: z
    .array(
      z.object({
        entryId: z.string().uuid(),
        reason: z.string().min(1).max(240),
      }),
    )
    .max(10000)
    .optional(),
});

const MarkPaidDto = z.object({
  paidCents: z.number().int().positive(),
  paidAt: z.string().datetime(),
});

const CancelDto = z.object({
  reason: z.string().min(1).max(240),
});

const StatusQuery = z.object({
  status: z.nativeEnum(DisbursementStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});

@ApiTags('Disbursements')
@Controller('disbursements')
@Roles('finance', 'admin')
export class DisbursementsController {
  constructor(private readonly svc: DisbursementsService) {}

  @Get()
  @ApiOperation({ summary: 'List disbursements (paginated, filter by status)' })
  list(@Query(new ZodValidationPipe(StatusQuery)) q: z.infer<typeof StatusQuery>) {
    return this.svc.list(q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Aggregate counts + outstanding payout exposure' })
  stats() {
    return this.svc.stats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single disbursement with entries + payment detail' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(id);
  }

  @Post('draft')
  @ApiOperation({
    summary: 'Create a draft disbursement bundling settled Payments in a period',
  })
  createDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateDraftDto)) dto: z.infer<typeof CreateDraftDto>,
  ) {
    return this.svc.createDraft(
      {
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        notes: dto.notes,
        paymentIds: dto.paymentIds,
      },
      actor.sub,
    );
  }

  @Patch(':id/entries')
  @ApiOperation({ summary: 'Add or exclude entries on a draft disbursement' })
  updateEntries(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateEntriesDto)) dto: z.infer<typeof UpdateEntriesDto>,
  ) {
    return this.svc.updateEntries(id, dto, actor.sub);
  }

  @Post(':id/ready')
  @ApiOperation({ summary: 'Lock the draft (final review done)' })
  setReady(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.setReady(id, actor.sub);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Mark submitted to the University finance office' })
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.setSubmitted(id, actor.sub);
  }

  @Post(':id/paid')
  @ApiOperation({ summary: 'Mark paid with the actual amount received' })
  markPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(MarkPaidDto)) dto: z.infer<typeof MarkPaidDto>,
  ) {
    return this.svc.markPaid(id, dto.paidCents, new Date(dto.paidAt), actor.sub);
  }

  @Post(':id/reconcile')
  @ApiOperation({ summary: 'Final reconciliation — closes the disbursement' })
  reconcile(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.reconcile(id, actor.sub);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a draft / ready / submitted disbursement' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(CancelDto)) dto: z.infer<typeof CancelDto>,
  ) {
    return this.svc.cancel(id, dto.reason, actor.sub);
  }

  @Get(':id/export.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary: 'Download the CSV claim payload handed to University finance',
  })
  async exportCsv(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: FastifyReply) {
    const { csv, sha256, filename } = await this.svc.exportCsv(id);
    res.header('content-disposition', `attachment; filename="${filename}"`);
    res.header('x-content-sha256', sha256);
    return csv;
  }
}
