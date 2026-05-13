import { Body, Controller, Module, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { AskService } from './ask.service.js';

const AskDto = z.object({
  question: z.string().min(3).max(500),
  locale: z.enum(['en', 'fi', 'sv']).default('fi'),
  userId: z.string().uuid().optional(),
});

@Controller('ask')
class AskController {
  constructor(private readonly svc: AskService) {}

  @Post()
  async ask(@Body(new ZodValidationPipe(AskDto)) body: z.infer<typeof AskDto>) {
    return this.svc.answer(body.question, body.locale, body.userId);
  }
}

@Module({ controllers: [AskController], providers: [AskService] })
export class AskModule {}
