import { Body, Controller, Ip, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { DonationsService, CreateDonationDto } from './donations.service.js';

@ApiTags('Donations')
@Controller('donations')
export class DonationsController {
  constructor(private readonly svc: DonationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Make a one-time donation + initiate payment',
    description:
      'Creates a pending Donation (optionally directed to a species) and ' +
      'returns the payment handoff (redirectUrl). The webhook settles it.',
  })
  async create(
    @Body(new ZodValidationPipe(CreateDonationDto)) dto: CreateDonationDto,
    @Ip() ip: string,
  ) {
    return this.svc.create(dto, ip);
  }
}
