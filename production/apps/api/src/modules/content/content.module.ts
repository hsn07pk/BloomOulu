/**
 * Read-only public endpoint for ContentBlock. The web legal pages
 * (/privacy, /terms, /accessibility-statement) fetch these by slug at SSR
 * time so operators can edit the wording from /admin/resources/ContentBlock
 * and the next ISR refresh (5 min) picks it up — no redeploy needed.
 */
import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('content-blocks')
class ContentBlocksController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':slug')
  async one(@Param('slug') slug: string) {
    const block = await this.prisma.contentBlock.findUnique({ where: { slug } });
    if (!block || !block.isPublished) throw new NotFoundException();
    return block;
  }
}

@Module({ controllers: [ContentBlocksController] })
export class ContentModule {}
