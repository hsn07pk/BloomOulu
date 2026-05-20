import { Body, Controller, Ip, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import {
  AdoptionsService,
  CreateAdoptionDto,
  CreateBundleDto,
} from './adoptions.service.js';

@ApiTags('Adoptions')
@Controller('adoptions')
export class AdoptionsController {
  constructor(private readonly svc: AdoptionsService) {}

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
}
