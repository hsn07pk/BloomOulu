-- One-shot backfill for Plant.adopterCount and Plant.fundedCents.
--
-- Both counters were declared as denormalised aggregates of the Adoption
-- table (schema.prisma:194; admin/server.ts:530) but no application code
-- ever maintained them — they stayed at 0 for every plant since launch.
-- AdoptionLifecycleService now keeps them in sync going forward; this
-- migration corrects the legacy state.
--
-- An adoption contributes to its plant's counters while its status is
-- `active` OR `paused` (paused = transient dunning state; donor still
-- "has" the plant). `pending`, `cancelled`, and `expired` do not count.
--
-- Idempotent: safe to re-run. Plants with no qualifying adoptions are
-- reset to 0 so a re-run cleans up any drift introduced between the
-- first run and the deploy.
UPDATE "Plant" p
SET "adopterCount" = COALESCE(sub.cnt, 0),
    "fundedCents"  = COALESCE(sub.sum_cents, 0)
FROM (
  SELECT pl.id AS plant_id,
         COALESCE(agg.cnt, 0)::int       AS cnt,
         COALESCE(agg.sum_cents, 0)::int AS sum_cents
  FROM "Plant" pl
  LEFT JOIN (
    SELECT "plantId",
           COUNT(*)::int             AS cnt,
           SUM("amountCents")::int   AS sum_cents
    FROM "Adoption"
    WHERE status IN ('active', 'paused')
    GROUP BY "plantId"
  ) agg ON agg."plantId" = pl.id
) sub
WHERE p.id = sub.plant_id;
