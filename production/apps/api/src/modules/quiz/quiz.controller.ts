/**
 * Quiz endpoints. Public read (kids/teachers don't need to sign in);
 * attempts can be anonymous OR carry a user JWT for /garden history.
 */
import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { LocaleEnum } from '@bloomoulu/constants';
import { ZodValidationPipe } from '../../common/zod.pipe.js';
import { QuizService } from './quiz.service.js';

const AttemptBody = z.object({
  locale: LocaleEnum,
  difficulty: z.string().optional(),
  answers: z.record(z.string(), z.number().int().min(-1).max(99)),
  durationMs: z.number().int().min(0),
  userId: z.string().uuid().nullable().optional(),
});

@Controller('plants')
export class QuizController {
  constructor(private readonly svc: QuizService) {}

  @Get(':slug/quiz')
  async questions(
    @Param('slug') slug: string,
    @Query('locale') locale: string = 'en',
    @Query('difficulty') difficulty: string = 'middle',
  ) {
    const l = ['en', 'fi', 'sv'].includes(locale) ? (locale as 'en' | 'fi' | 'sv') : 'en';
    const res = await this.svc.getQuestions(slug, l, difficulty);
    if (!res) throw new NotFoundException();
    return res;
  }

  @Post(':slug/quiz/attempt')
  async attempt(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(AttemptBody)) body: z.infer<typeof AttemptBody>,
  ) {
    const res = await this.svc.submitAttempt(slug, body);
    if (!res) throw new NotFoundException();
    return res;
  }

  @Post(':slug/quiz/regenerate')
  async regenerate(
    @Param('slug') slug: string,
    @Query('locale') locale: string = 'en',
    @Query('difficulty') difficulty: string = 'middle',
  ) {
    const l = ['en', 'fi', 'sv'].includes(locale) ? (locale as 'en' | 'fi' | 'sv') : 'en';
    const count = await this.svc.regenerate(slug, l, difficulty);
    return { ok: true, count };
  }
}
