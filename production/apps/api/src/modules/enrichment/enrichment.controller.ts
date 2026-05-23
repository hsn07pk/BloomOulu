/**
 * /v1/admin/enrichment/* — the human-in-the-loop review API surface.
 *
 *   GET    /pending           List pending suggestions (paginated).
 *   GET    /history           List recently applied / rejected suggestions.
 *   POST   /:id/approve       Apply the proposed value to the Plant row.
 *   POST   /:id/reject        Mark rejected with a curator reason.
 *   POST   /preview           Run all four sources for a Latin name without
 *                             writing anything — used by the "Add plant"
 *                             assistant + ad-hoc "what would we get?"
 *                             curator workflow.
 *   POST   /:plantId/run-now  Enqueue a one-shot enrichment for one plant
 *                             (manual override of the cron schedule).
 */
import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Queue } from 'bullmq';
import { z } from 'zod';
import {
  applyEnrichmentValue,
  fetchEnrichmentPreview,
  type EnrichField,
} from './index.js';
import { QUEUE_PLANT_ENRICH } from '../jobs/queues.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PreviewDto = z.object({
  latinName: z.string().min(2).max(120),
});
type PreviewDto = z.infer<typeof PreviewDto>;

const RejectDto = z.object({ reason: z.string().max(500).optional() });
type RejectDto = z.infer<typeof RejectDto>;

const RunNowDto = z.object({
  fields: z.array(z.enum(['story', 'origin', 'status', 'image'])).optional(),
  overwrite: z.boolean().optional(),
  /** Override the autoApply policy for THIS run only — useful when the
   *  admin wants to force a manual review of a specific field. */
  reviewAll: z.boolean().optional(),
});
type RunNowDto = z.infer<typeof RunNowDto>;

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };
let enrichQueue: Queue | null = null;
function getEnrichQueue() {
  if (!enrichQueue) enrichQueue = new Queue(QUEUE_PLANT_ENRICH, { connection });
  return enrichQueue;
}

@Controller('admin/enrichment')
export class EnrichmentController {
  constructor(private readonly prisma: PrismaService) {}

  /** Pending suggestions awaiting curator review, newest first. */
  @Get('pending')
  async pending(@Query('limit') limit?: string, @Query('field') field?: string) {
    const take = Math.max(1, Math.min(200, parseInt(limit ?? '50', 10) || 50));
    const where: any = { status: 'pending' };
    if (field) where.field = field;
    const rows = await this.prisma.enrichmentSuggestion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        plant: {
          select: {
            id: true,
            slug: true,
            nameEn: true,
            nameFi: true,
            nameSv: true,
            redListStatus: true,
            taxon: { select: { latinName: true } },
          },
        },
      },
    });
    return { items: rows };
  }

  /** Anything reviewed in the last 30 days, for audit. */
  @Get('history')
  async history(@Query('limit') limit?: string) {
    const take = Math.max(1, Math.min(200, parseInt(limit ?? '100', 10) || 100));
    const rows = await this.prisma.enrichmentSuggestion.findMany({
      where: { status: { in: ['approved', 'rejected', 'applied', 'auto_applied'] } },
      orderBy: { updatedAt: 'desc' },
      take,
      include: {
        plant: { select: { slug: true, taxon: { select: { latinName: true } } } },
      },
    });
    return { items: rows };
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string) {
    const row = await this.prisma.enrichmentSuggestion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (row.status !== 'pending') {
      throw new BadRequestException(`already ${row.status}`);
    }
    const ok = await applyEnrichmentValue(
      this.prisma as any,
      row.plantId,
      row.field as EnrichField,
      row.proposed,
    );
    if (!ok) throw new BadRequestException('failed to apply value');
    await this.prisma.enrichmentSuggestion.update({
      where: { id },
      data: {
        status: 'applied',
        appliedAt: new Date(),
        reviewedAt: new Date(),
      },
    });
    return { ok: true };
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectDto)) dto: RejectDto,
  ) {
    const row = await this.prisma.enrichmentSuggestion.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (row.status !== 'pending') {
      throw new BadRequestException(`already ${row.status}`);
    }
    await this.prisma.enrichmentSuggestion.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewNote: dto.reason ?? null,
      },
    });
    return { ok: true };
  }

  /** Run all four sources for a Latin name without persisting anything.
   *  Returns the raw fetched values so the "Add plant" assistant can show
   *  them and let the curator pick which to keep. */
  @Post('preview')
  async preview(@Body(new ZodValidationPipe(PreviewDto)) dto: PreviewDto) {
    const preview = await fetchEnrichmentPreview(dto.latinName);
    return { latinName: dto.latinName, preview };
  }

  /** Enqueue a one-shot enrichment job for one plant. */
  @Post(':plantId/run-now')
  async runNow(
    @Param('plantId') plantId: string,
    @Body(new ZodValidationPipe(RunNowDto)) dto: RunNowDto,
  ) {
    const plant = await this.prisma.plant.findUnique({
      where: { id: plantId },
      select: { id: true },
    });
    if (!plant) throw new NotFoundException(`plant ${plantId} not found`);
    const queue = getEnrichQueue();
    const job = await queue.add(
      'enrich-manual',
      {
        plantId,
        fields: dto.fields,
        overwrite: dto.overwrite ?? false,
        autoApply: dto.reviewAll
          ? { story: false, origin: false, status: false, image: false }
          : undefined,
      },
      { jobId: `enrich-${plantId}`, removeOnComplete: true, removeOnFail: true },
    );
    return { ok: true, jobId: job.id };
  }
}
