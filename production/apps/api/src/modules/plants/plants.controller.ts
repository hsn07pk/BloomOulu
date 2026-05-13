import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('Plants')
@Controller('plants')
export class PlantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('bloomSeason') bloomSeason?: string,
    @Query('q') q?: string,
    @Query('limit') limit = '50',
  ) {
    const take = Math.min(parseInt(limit, 10) || 50, 200);
    return this.prisma.plant.findMany({
      where: {
        status: 'active',
        ...(status ? { redListStatus: status as any } : {}),
        ...(bloomSeason ? { bloomSeason: bloomSeason as any } : {}),
        ...(q
          ? {
              OR: [
                { nameEn: { contains: q, mode: 'insensitive' } },
                { nameFi: { contains: q, mode: 'insensitive' } },
                { nameSv: { contains: q, mode: 'insensitive' } },
                { taxon: { latinName: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { primaryImage: true, taxon: true },
      take,
      orderBy: [{ adopterCount: 'desc' }, { nameEn: 'asc' }],
    });
  }

  @Get(':slug')
  async one(@Param('slug') slug: string) {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      include: {
        taxon: true,
        primaryImage: true,
        images: true,
        accessions: true,
        narrations: true,
        citations: { include: { citation: true } },
      },
    });
    if (!plant) throw new NotFoundException();
    return plant;
  }
}
