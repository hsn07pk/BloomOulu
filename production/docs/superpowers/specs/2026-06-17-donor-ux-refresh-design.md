# Donor-journey UX/UI refresh — design

Date: 2026-06-17 · Status: approved · Branch: `feat/donation-favourites-rewrite`

## Goal
Make the donor-facing web frontend easy, interactive, and appealing. Direct
trigger: the UI is cluttered and dropdown-heavy (the donate form's species
picker is a 48-option `<select>`; `/plants` stacks four filter controls).
Scope: the full donor journey — home → browse → plant page → donate →
favourites → My Garden. Direction: **elevate the existing botanical identity**
(deep-forest / sage / cream palette, Fraunces serif), don't reinvent it.

## Principles (cross-cutting)
1. **One primary action per screen.** Secondary options behind progressive
   disclosure (`▸ more`).
2. **No wall of dropdowns.** Chips for short mutually-exclusive sets;
   **typeahead search** for large lists (species, plant families); a single
   **Filters sheet** for advanced/secondary filters.
3. **Mobile-first.** Donors arrive via QR codes on plant labels → phones.
   Single-column, thumb-reachable CTAs, ≥44px targets.
4. **Tactile & rewarding.** Press states on chips/buttons; ♥ vote fill + count
   pop; warm donate-success moment; smooth section reveals; desktop card
   hover-lift; skeletons on load. All gated by the existing reduced-motion
   a11y toggle. WCAG 2.2 AA preserved (EAA 2025 target).
5. **Shared component kit** so surfaces stay consistent and files stay focused:
   `AmountChips`, `SpeciesSearch` (typeahead), `FilterSheet`, `PlantCard` (v2),
   `VoteButton` (exists), `PrimaryButton`, `Disclosure`/`MoreOptions`.

## Surface designs
### Donate (`/donate`)
"One calm screen + smart defaults" (chosen):
- Big amount chips (€5 / €15 / €25● / €50 / Other) from
  `settings.donation.suggestedAmountsCents`; custom amount inline.
- Gift defaults to the whole Garden. **Optional collapsed species typeahead**
  (`▸ Direct it to a plant?`) — searches plants by name, shows a few
  threatened suggestions; replaces the 48-option `<select>`. When reached from
  a plant page / favourite, the species shows as a removable chip instead.
- Email + optional name. Dedication / anonymity behind `▸ more`.
- One `Donate €N →` CTA; trust line (Card · MobilePay · secure · VAT-exempt).
- Success: warm confirmation (not a bare redirect outcome).

### Browse (`/plants`)
Replace the four-control filter stack with:
- Prominent **search bar** (name / Latin / family typeahead).
- **One always-visible rarity chip row** (All · CR · EN · VU · NT · LC),
  horizontally scrollable.
- A single **"Filters" button** → bottom-sheet (mobile) / popover (desktop)
  holding Bloom season, Family (as in-sheet search, not a giant select), and
  "needs support". Active filters render as removable chips above results.
- `PlantCard` v2: image-forward, rarity badge, ♥ + vote count, Donate
  affordance.

### Plant page (`/plants/[slug]`)
Clear hierarchy: hero image → name + rarity → short story → two CTAs
(**Donate to this plant** primary; **♥ Favourite** with live count) →
accession / citations / audio / map in collapsible sections.

### Favourites (`/favourites`)
Leaderboard made rewarding: ranked rows (image, rarity, big vote count),
optimistic ♥ toggle with animation, Donate per row, a "you've favourited N"
nudge + share affordance.

### Home (`/`)
Funnel, not a text wall: hero → 3-step "Scan · Ask · Donate" → **Most-loved
plants** strip (top favourites, inline ♥ + Donate) → impact stats → one
Donate CTA.

### My Garden (`/garden`)
Declutter to: your gifts (cards: amount, optional species, date, status),
receipts / tax-cert downloads, saved favourites, GDPR controls. Welcoming
header.

## Build order
Shared kit → Donate → Favourites → Browse filters → Plant page → Home →
My Garden. Rebuild the web image (the `next build` is the type/lint gate) and
redeploy after each meaningful chunk; verify routes render (HTTP 200 +
structure). Visual "appeal" is judged by the user on the deployed site.

## Acceptance criteria
- No control presents a large flat list of options; species/family are
  typeahead; advanced plant filters live in one sheet.
- Donate is completable in ≤ ~4 interactions for a general gift.
- All new components keyboard-navigable, labelled, reduced-motion-aware.
- `next build` passes; existing API contracts unchanged (UI-only refresh).

## Out of scope
Backend/API/data-model changes (the donation rewrite is done); the demo-design
site; the kiosk (already adapted). No new i18n namespaces beyond keys these
components need.
