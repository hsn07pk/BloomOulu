import { Body, Controller, Ip, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AdoptionsService, CreateAdoptionDto } from './adoptions.service.js';

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
}
