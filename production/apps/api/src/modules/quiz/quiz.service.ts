/**
 * Quiz service — generates and serves school-mode multiple-choice
 * questions per plant per locale.
 *
 * Generation is template-based + deterministic from the plant's existing
 * facts (origin, habitat, biome, bloomWindow, redListStatus, taxon.family).
 * Each plant gets 3 questions per locale. They're persisted into
 * QuizQuestion on first request so subsequent calls are a single SELECT.
 *
 * Curators can edit / re-author via AdminJS (CRUD generated from the model).
 * A re-seed endpoint regenerates from templates if the fact set changed.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type Locale = 'en' | 'fi' | 'sv';

interface PlantFacts {
  id: string;
  slug: string;
  nameEn: string;
  redListStatus: string;
  bloomSeason: string;
  bloomWindow: string | null;
  origin: string;
  habitat: string;
  biome: string;
  taxon: { latinName: string; family: string } | null;
}

interface GeneratedQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const RED_LIST_FULL: Record<string, Record<Locale, string>> = {
  CR: {
    en: 'Critically Endangered',
    fi: 'Äärimmäisen uhanalainen',
    sv: 'Akut hotad',
  },
  EN: { en: 'Endangered', fi: 'Erittäin uhanalainen', sv: 'Starkt hotad' },
  VU: { en: 'Vulnerable', fi: 'Vaarantunut', sv: 'Sårbar' },
  NT: { en: 'Near Threatened', fi: 'Silmälläpidettävä', sv: 'Nära hotad' },
  LC: { en: 'Least Concern', fi: 'Elinvoimainen', sv: 'Livskraftig' },
  DD: { en: 'Data Deficient', fi: 'Puutteellisesti tunnettu', sv: 'Kunskapsbrist' },
  EX: { en: 'Extinct', fi: 'Hävinnyt', sv: 'Utdöd' },
  NA: { en: 'Not Applicable', fi: 'Ei sovellu', sv: 'Ej tillämpligt' },
};

const SEASON_TO_MONTHS: Record<string, string> = {
  spring: 'March–May',
  summer: 'June–August',
  autumn: 'September–November',
  winter: 'December–February',
  all: 'all year',
};

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get (or auto-generate) the quiz questions for a plant + locale.
   * If the DB has none, the first call seeds the standard 3-question
   * template; subsequent calls return the rows directly.
   */
  async getQuestions(slug: string, locale: Locale, difficulty = 'middle') {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        nameEn: true,
        redListStatus: true,
        bloomSeason: true,
        bloomWindow: true,
        origin: true,
        habitat: true,
        biome: true,
        taxon: { select: { latinName: true, family: true } },
      },
    });
    if (!plant) return null;

    let questions = await this.prisma.quizQuestion.findMany({
      where: { plantId: plant.id, locale, difficulty },
      orderBy: { orderIndex: 'asc' },
    });
    if (questions.length === 0) {
      await this.seedFor(plant as PlantFacts, locale, difficulty);
      questions = await this.prisma.quizQuestion.findMany({
        where: { plantId: plant.id, locale, difficulty },
        orderBy: { orderIndex: 'asc' },
      });
    }
    // Strip correctIndex + explanation from the public response — the
    // client only sees them after submitting an attempt.
    return {
      plant: { id: plant.id, slug: plant.slug, nameEn: plant.nameEn },
      questions: questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options,
        difficulty: q.difficulty,
        orderIndex: q.orderIndex,
      })),
    };
  }

  async submitAttempt(
    slug: string,
    body: {
      locale: Locale;
      difficulty?: string;
      answers: Record<string, number>; // questionId → chosen index
      durationMs: number;
      userId?: string | null;
    },
  ) {
    const plant = await this.prisma.plant.findUnique({ where: { slug }, select: { id: true } });
    if (!plant) return null;
    const difficulty = body.difficulty ?? 'middle';
    const questions = await this.prisma.quizQuestion.findMany({
      where: { plantId: plant.id, locale: body.locale, difficulty },
      orderBy: { orderIndex: 'asc' },
    });
    const questionIds: string[] = [];
    const answers: number[] = [];
    const results: Array<{
      questionId: string;
      yourAnswer: number;
      correct: boolean;
      correctIndex: number;
      explanation: string;
    }> = [];
    let score = 0;
    for (const q of questions) {
      const given = body.answers[q.id];
      const safeGiven = typeof given === 'number' && given >= 0 && given < q.options.length ? given : -1;
      const correct = safeGiven === q.correctIndex;
      if (correct) score += 1;
      questionIds.push(q.id);
      answers.push(safeGiven);
      results.push({
        questionId: q.id,
        yourAnswer: safeGiven,
        correct,
        correctIndex: q.correctIndex,
        explanation: q.explanation ?? '',
      });
    }
    await this.prisma.quizAttempt.create({
      data: {
        userId: body.userId ?? null,
        plantId: plant.id,
        locale: body.locale,
        difficulty,
        questionIds,
        answers,
        score,
        durationMs: Math.max(0, Math.min(body.durationMs | 0, 60 * 60 * 1000)),
      },
    });
    return { score, total: questions.length, results };
  }

  /**
   * Force-rebuild the quiz for a plant + locale. Wipes existing rows and
   * runs the template generator again. Curators call this after editing
   * the underlying plant facts.
   */
  async regenerate(slug: string, locale: Locale, difficulty = 'middle'): Promise<number> {
    const plant = await this.prisma.plant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        nameEn: true,
        redListStatus: true,
        bloomSeason: true,
        bloomWindow: true,
        origin: true,
        habitat: true,
        biome: true,
        taxon: { select: { latinName: true, family: true } },
      },
    });
    if (!plant) return 0;
    await this.prisma.quizQuestion.deleteMany({
      where: { plantId: plant.id, locale, difficulty },
    });
    await this.seedFor(plant as PlantFacts, locale, difficulty);
    return this.prisma.quizQuestion.count({
      where: { plantId: plant.id, locale, difficulty },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Template-based question generation
  // ────────────────────────────────────────────────────────────────────

  private async seedFor(plant: PlantFacts, locale: Locale, difficulty: string): Promise<void> {
    const key = `${plant.id}:${locale}:${difficulty}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = (async () => {
      try {
        const generated = this.generate(plant, locale, difficulty);
        if (generated.length === 0) return;
        await this.prisma.quizQuestion.createMany({
          data: generated.map((q, i) => ({
            plantId: plant.id,
            locale: locale as Locale,
            prompt: q.prompt,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            difficulty,
            orderIndex: i,
          })),
          skipDuplicates: true,
        });
        this.logger.log(`quiz seeded: ${plant.slug} · ${locale} · ${difficulty} · ${generated.length} Q`);
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  private generate(plant: PlantFacts, locale: Locale, _difficulty: string): GeneratedQuestion[] {
    const out: GeneratedQuestion[] = [];

    // Q1 — Red-List status.
    {
      const correctKey = plant.redListStatus;
      const correct = RED_LIST_FULL[correctKey]?.[locale] ?? correctKey;
      const distractors = ['VU', 'EN', 'CR', 'NT', 'LC']
        .filter((s) => s !== correctKey)
        .slice(0, 3)
        .map((s) => RED_LIST_FULL[s]?.[locale] ?? s);
      const { options, correctIndex } = shuffleWithCorrect(correct, distractors, plant.id + 'r');
      out.push({
        prompt:
          locale === 'fi'
            ? `Mihin Punaisen kirjan luokkaan ${plant.nameEn} kuuluu?`
            : locale === 'sv'
              ? `Vilken rödlistningskategori tillhör ${plant.nameEn}?`
              : `Which Red-List category does ${plant.nameEn} belong to?`,
        options,
        correctIndex,
        explanation:
          locale === 'fi'
            ? `Suomen lajien uhanalaisuusarvioinnin 2019 mukaan luokka on ${correct} (${correctKey}).`
            : locale === 'sv'
              ? `Enligt 2019 års bedömning av Finlands arter är kategorin ${correct} (${correctKey}).`
              : `Per the 2019 assessment of Finnish species, the category is ${correct} (${correctKey}).`,
      });
    }

    // Q2 — Habitat.
    {
      const correct = plant.habitat;
      const distractorPool = [
        'Coastal dunes',
        'Tropical lowland forest',
        'Alpine scree',
        'Mediterranean garrigue',
        'Boreal bog',
        'Old-growth spruce forest',
        'Wet meadow',
      ].filter((s) => s.toLowerCase() !== correct.toLowerCase());
      const { options, correctIndex } = shuffleWithCorrect(
        correct,
        distractorPool.slice(0, 3),
        plant.id + 'h',
      );
      out.push({
        prompt:
          locale === 'fi'
            ? `Mikä on ${plant.nameEn} -lajin tyypillinen elinympäristö?`
            : locale === 'sv'
              ? `Vilken är ${plant.nameEn}s typiska livsmiljö?`
              : `What is the typical habitat of ${plant.nameEn}?`,
        options,
        correctIndex,
        explanation:
          locale === 'fi'
            ? `Sen luonnollinen elinympäristö on ${correct}.`
            : locale === 'sv'
              ? `Dess naturliga livsmiljö är ${correct}.`
              : `Its natural habitat is ${correct}.`,
      });
    }

    // Q3 — Bloom season.
    {
      const seasonKey = plant.bloomSeason;
      const correct = plant.bloomWindow ?? SEASON_TO_MONTHS[seasonKey] ?? seasonKey;
      const distractors = Object.values(SEASON_TO_MONTHS)
        .filter((s) => s !== correct)
        .slice(0, 3);
      const { options, correctIndex } = shuffleWithCorrect(correct, distractors, plant.id + 'b');
      out.push({
        prompt:
          locale === 'fi'
            ? `Milloin ${plant.nameEn} tyypillisesti kukkii?`
            : locale === 'sv'
              ? `När blommar ${plant.nameEn} vanligtvis?`
              : `When does ${plant.nameEn} typically bloom?`,
        options,
        correctIndex,
        explanation:
          locale === 'fi'
            ? `Sen pääkukinta osuu ajalle ${correct}.`
            : locale === 'sv'
              ? `Dess huvudblomning sker ${correct}.`
              : `Its main bloom window is ${correct}.`,
      });
    }

    return out;
  }
}

// Deterministic 4-option shuffle that always includes the correct answer.
// Seeded by a stable string so the same plant always shows the same order
// (visitors won't see the answer move around when the page refreshes).
function shuffleWithCorrect(
  correct: string,
  distractors: string[],
  seed: string,
): { options: string[]; correctIndex: number } {
  const pool = [correct, ...distractors.slice(0, 3)];
  while (pool.length < 4) pool.push('—'); // shouldn't happen, but keep length stable
  // FNV-1a 32-bit, plenty for ordering.
  let h = 0x811c9dc5;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = (h * 0x01000193) >>> 0;
  }
  const order = pool
    .map((v, i) => ({ v, k: (h + i * 0x9e3779b1) >>> 0 }))
    .sort((a, b) => a.k - b.k)
    .map(({ v }) => v);
  return { options: order, correctIndex: order.indexOf(correct) };
}
