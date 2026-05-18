-- QuizQuestion: school-mode multiple-choice questions per plant.
-- Each question stores 4 options + the index of the correct one.

CREATE TABLE "QuizQuestion" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "plantId"      UUID NOT NULL,
    "locale"       "Locale" NOT NULL,
    "prompt"       TEXT NOT NULL,
    "options"      TEXT[] NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "explanation"  TEXT,
    "difficulty"   TEXT NOT NULL DEFAULT 'middle',
    "orderIndex"   INTEGER NOT NULL DEFAULT 0,

    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuizQuestion_plantId_locale_difficulty_orderIndex_idx"
    ON "QuizQuestion"("plantId", "locale", "difficulty", "orderIndex");

ALTER TABLE "QuizQuestion"
    ADD CONSTRAINT "QuizQuestion_plantId_fkey"
    FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- QuizAttempt: append-only log of attempts (signed-in or anonymous).

CREATE TABLE "QuizAttempt" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID,
    "plantId"      UUID NOT NULL,
    "locale"       "Locale" NOT NULL,
    "difficulty"   TEXT NOT NULL,
    "questionIds"  TEXT[] NOT NULL,
    "answers"      INTEGER[] NOT NULL,
    "score"        INTEGER NOT NULL,
    "durationMs"   INTEGER NOT NULL,

    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuizAttempt_plantId_createdAt_idx"   ON "QuizAttempt"("plantId", "createdAt" DESC);
CREATE INDEX "QuizAttempt_userId_createdAt_idx"    ON "QuizAttempt"("userId", "createdAt" DESC);
