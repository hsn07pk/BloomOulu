# Contributing to BloomOulu

Thanks for stopping by 🌱

This is a prototype repo — it ships a self-contained static demo at
[bloom-oulu.vercel.app/demo-design/](https://bloom-oulu.vercel.app/demo-design/).
The production frontend will be a separate codebase. With that in mind, here's
how to work in this repo if you'd like to contribute.

## Quick start

```bash
git clone https://github.com/hsn07pk/BloomOulu.git
cd BloomOulu
python3 -m http.server 8000
# open http://localhost:8000/demo-design/
```

No build step — the demo loads React + Babel-standalone in the browser. Edits
to any `.jsx` / `.html` file are visible on a hard refresh.

## Project layout

See [README › Project structure](./README.md#project-structure).

## How to add a plant

1. Add an entry to the `PLANTS` array in `demo-design/data.jsx` with all fields
   (`id`, `accession`, `name`, `fi`, `sv`, `en`, `family`, `rarity`,
   `rarityLabel`, `origin`, `habitat`, `color`, `accent`, `variant`,
   `adopters`, `funded`, `target`, `story`, `bloom`, `accessed`, `audio`,
   `transcript: { en, fi, sv }`, `seasons: { spring, summer, autumn }`,
   `image`, `quickFacts`).
2. Add the primary 800 px photo to `demo-design/plants/<id>.jpg` and credit the
   source in `demo-design/plants/CREDITS.md`.
3. Optionally add seasonal alternates to `plants/<id>-<season>.jpg`.
4. Generate three audio narrations into `demo-design/audio/{en,fi,sv}/<id>.m4a`:
   ```bash
   say -v Samantha -r 160 -o audio/en/<id>.m4a --data-format=aac "<EN script>"
   say -v Satu     -r 150 -o audio/fi/<id>.m4a --data-format=aac "<FI script>"
   say -v Alva     -r 150 -o audio/sv/<id>.m4a --data-format=aac "<SV script>"
   ```
5. Add micro-coordinates to `PLANT_COORDS` and a bed description to `PLANT_BED`
   in `icons.jsx` so the map marker is in the right place.

## How to add a translation key

`demo-design/translations.jsx` is the i18n source of truth. Add the English
key as a string literal and the Finnish + Swedish translations in the
respective sections. Any key the `t()` helper can't find falls back to the
English source string.

## Coding conventions

- **No dependencies inside the bundle.** External libraries load via CDN with
  SRI hashes where available. Don't add a build step.
- **Inline styles + a single `<style>` block.** The CSS lives in
  `demo-design/index.html`. New components use inline `style={{ … }}`
  consistent with the existing screens.
- **Mobile first.** Every new layout should collapse cleanly at ≤768 px via
  the responsive CSS sweep in `index.html` (`@media (max-width: 768px)`).
  Use `data-grid-mobile="2"` to opt into a 2-col layout on phones.
- **Accessibility.** Every new icon-only button needs `aria-label`. Live
  regions for status (`role="status" aria-live="polite"`). Don't intercept
  clicks with decorative `position: absolute` elements — add
  `pointer-events: none` and `aria-hidden="true"`.
- **One component per concern.** New shared components go in `icons.jsx` (the
  catch-all for everything we expose on `window`).

## Commit + PR conventions

- Commit messages: imperative, scope-prefixed when useful. Co-author tag is
  fine but not required.
- Open PRs against `main`. Vercel will build a preview URL automatically.

## Reporting bugs

Open an [issue](https://github.com/hsn07pk/BloomOulu/issues) with:

- a steps-to-reproduce list,
- the URL hash you were on (e.g. `…/#plant=puls-pat`),
- screenshot or screen recording (Vercel preview URL is preferred).

## Licence

By contributing you agree your contributions are licensed under the [MIT
License](./LICENSE) of this repository.
