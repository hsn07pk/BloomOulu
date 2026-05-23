/**
 * /v1/translations/:locale — serves the live i18n catalog the web app
 * consumes via next-intl. Merges Translation rows from the DB on top of
 * the bundled JSON catalog so admin edits in /admin → Translations show
 * up in the next request, no redeploy required.
 *
 * The DB stores flat keys like "Adopt.tier_seedling"; next-intl expects
 * nested objects ({Adopt: {tier_seedling: "..."}}). We reconstruct the
 * shape here so the web doesn't have to care which storage is which.
 */
import { Controller, Get, Module, Param, NotFoundException } from '@nestjs/common';
import { LOCALES, type Locale } from '@bloomoulu/constants';
import { PrismaService } from '../prisma/prisma.service.js';

type NestedRecord = { [key: string]: string | NestedRecord };

function setNested(target: NestedRecord, dottedKey: string, value: string): void {
  const parts = dottedKey.split('.');
  let cur: NestedRecord = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next == null || typeof next === 'string') {
      const obj: NestedRecord = {};
      cur[p] = obj;
      cur = obj;
    } else {
      cur = next;
    }
  }
  cur[parts[parts.length - 1]!] = value;
}

@Controller('translations')
class TranslationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':locale')
  async byLocale(@Param('locale') locale: string) {
    if (!(LOCALES as readonly string[]).includes(locale)) {
      throw new NotFoundException(`unknown locale: ${locale}`);
    }
    const rows = await this.prisma.translation.findMany({
      where: { status: { not: 'deprecated' } },
      select: { i18nKey: true, en: true, fi: true, sv: true },
    });
    const out: NestedRecord = {};
    const field = locale as Locale;
    for (const row of rows) {
      const value = row[field];
      if (!value) continue;
      setNested(out, row.i18nKey, value);
    }
    return out;
  }
}

@Module({ controllers: [TranslationsController] })
export class TranslationsModule {}
