# ADR-0006: Accessibility (EAA 2025 + WCAG 2.2 AA) and i18n

**Status:** Accepted
**Date:** 2026-05-13

## Context

The European Accessibility Act became enforceable on **28 June 2025**. By November 2025, French disability advocates had already filed emergency injunctions against non-compliant retailers. The Garden, as a university service, falls under the EAA; the checkout flow is the highest-risk surface.

WCAG 2.2 AA is the technical bar (EN 301 549 is being updated to incorporate it; until then, WCAG 2.1 AA is the operative floor but 2.2 is what we target so the next standards revision finds us already compliant).

## Decision

### Engineering rules (enforced in CI)

1. **No fixed `px` font sizes** for text. Use `rem` + relative leading. Lint: `stylelint` rule `declaration-property-unit-disallowed-list`.
2. **Every interactive control has a `:focus-visible` outline** of ≥ 2px and ≥ 3:1 contrast. Lint via Storybook a11y addon + Playwright per-state visual diff.
3. **Tap targets ≥ 44 × 44 CSS px** on mobile. Tested in Playwright iPhone-13 viewport.
4. **No DIV-as-button.** ESLint plugin `jsx-a11y` enforces this; we never bypass it.
5. **Skip-to-main-content** link at the top of every page.
6. **Live regions for toasts** (`aria-live="polite"`) — already in the prototype, retained.
7. **No autoplay** audio, ever. Captions are on by default. Reduced motion respected via `prefers-reduced-motion` + an in-app toggle.
8. **Keyboard-only path through the entire adopt flow** verified in Playwright (no mouse simulation).
9. **Screen-reader smoke test** with `axe-playwright` on every PR. A serious violation blocks merge.
10. **High-contrast mode** + **larger-text mode** are user-set, persisted in `localStorage` + (if logged in) `User.preferences`.

### i18n strategy

- **`next-intl` v3** on the web, with messages under `packages/i18n/messages/{en,fi,sv}/*.json`. Server components read locale from the URL (`/[locale]/...`); client components consume via `useTranslations()`.
- All UI strings, accessibility labels, error messages, email subjects, PDF receipt strings — every single one — comes from the i18n bundle.
- **Plurals** use ICU MessageFormat (`{count, plural, one {# adopter} other {# adopters}}`).
- **Plant common names** ship per-locale; **scientific names** are locale-invariant.
- **The AskTheGarden corpus** is multilingual — primary language varies by document, and the retriever supports cross-lingual retrieval by translating the query to canonical English.
- **Audio narration** is recorded per locale (a hard requirement — the pitch promised this); the script the curator records is also the on-screen caption file.

### Audit

We commission an external WCAG 2.2 AA audit from **TPGi** or **Siteimprove** at three points: pre-launch, +3 months, +12 months. Each audit produces a public conformance report linked from the footer (EAA Article 14 transparency requirement).

## Consequences

**Positive**

- CI catches accessibility regressions before code review.
- Conformance is *demonstrable*: every PR has axe-playwright output; every release has a Lighthouse a11y score baselined in the dashboard.
- The "larger text" mode is universal in Nordic libraries — adopting it now means our donor demographic is wider than the prototype's.

**Negative**

- Three-language voiceover is a real cost. We budget one studio day per quarter; the curator does FI, a Finnish-Swedish bilingual reader does SV, a native English reader does EN. ~€600/quarter.
