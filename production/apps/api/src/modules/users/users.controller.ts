import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/garden')
  async myGarden(@Param('id') id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        locale: true,
        adoptions: {
          include: { plant: true, tier: true, payments: true, plaque: true },
        },
        receipts: { orderBy: { issuedAt: 'desc' }, take: 50 },
        taxCertificates: true,
      },
    });
  }
}
