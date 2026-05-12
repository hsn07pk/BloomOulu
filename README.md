<div align="center">

# 🌱 BloomOulu

**One platform for the University of Oulu Botanical Garden — adoption · AI-grounded plant guide · immersive QR experience · live kiosk.**

[![Live demo](https://img.shields.io/badge/demo-bloom--oulu.vercel.app-2D5440?style=flat&logo=vercel)](https://bloom-oulu.vercel.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-A8C060.svg?style=flat)](./LICENSE)
[![WCAG 2.2 AA](https://img.shields.io/badge/WCAG-2.2%20AA-5FB0A0?style=flat)](https://www.w3.org/WAI/WCAG22/quickref/)
[![EU hosted](https://img.shields.io/badge/hosted-EU-1F3C2D?style=flat)](https://vercel.com)
[![Languages: FI · SV · EN](https://img.shields.io/badge/i18n-FI%20·%20SV%20·%20EN-88A050?style=flat)](./demo-design/translations.jsx)

[**Open the live demo →**](https://bloom-oulu.vercel.app/demo-design/)

</div>

---

## Overview

BloomOulu is a unified digital experience for the University of Oulu Botanical Garden, the northernmost scientific garden in the world. It replaces the existing voluntary‑MobilePay donation flow with a **four-tier Adopt-a-Plant program** (€25 → €500 + corporate), pairs every plant label with a **scannable QR** that opens a rich plant page (audio narration, real photos, deep-link), and adds an **AI plant guide grounded in the Garden's own science** with visible citations.

The platform is designed for the European Accessibility Act 2025 and BGCI/IUCN reporting standards, and is multilingual (Finnish, Swedish, English) end-to-end — UI, audio narration, captions and all.

> Built by **Team Meraki** for **GrowthHack 2026** at the University of Oulu, with research grounded in [the comprehensive platform analysis](https://github.com/hsn07pk/BloomOulu/) (peer benchmarks: Kew, Meise, ELTE Füvészkert, RBGE, Queens BG, NYBG, Mt Auburn).

## Features

| Pillar | Inside |
|---|---|
| 🌿 **Discover** | Hero with live Oulu weather, plant index filtered by Red-List status (CR/EN/VU/NT), conservation-impact strip, "How BloomOulu works" journey. |
| 🪴 **Plant page** | Real plant photos + per-season Wikimedia alternates, live multilingual audio narration with on-screen captions, accession data, cited papers, Kid mode (plant-as-character + sticker collection), School mode (reading-level toggle + 3-question quiz + printable worksheet), shareable per-plant QR. |
| 🤖 **AskTheGarden** | RAG-styled chat grounded in the accession DB and Biodiversity Unit corpus, with visible citations. EN/FI/SV intent matching, helpful/off-base/forward-to-curator reactions, recent + trending starter prompts. |
| 💚 **Adopt** | 4-tier ladder (€25 Seed → €500 Critically Endangered) + corporate tiers (€2,500 → €20,000/yr), gift / memorial / class intents, monthly recurring, transparent VAT split + TVL §57 corporate-deduction copy. |
| 🌷 **My Garden** | Loyalty card (Silver/Gold), conservation-impact breakdown, plant timeline with curator notes, memorial dedication, gifts sent, year-end tax certificate, saved-for-later list. |
| 🖥 **Kiosk** | Lobby-display-ready view with live time, weather, "Blooming today" feature card, real scannable QR (deep-links to a plant page), animated adopter wall, daily stats. |
| 🗺 **Real maps** | Leaflet + OpenStreetMap. Every plant has micro-coordinates within the garden; pin clusters by Red-List status. |
| 🔊 **Audio** | 24 narrations (8 plants × 3 languages), AAC/m4a, ~30 sec each, generated locally so they always load. |
| 📷 **QR** | Real high-error-correction QR codes (qrcode-generator) with the BloomOulu mark in the centre. Tap-or-scan deep-links via URL hash. |
| ♿ **Accessibility** | Skip-link, focus-visible, ARIA landmarks + labels, semantic regions, reduced-motion, larger-text, high-contrast, on-screen audio captions per language. EAA 2025 / WCAG 2.2 AA target. |

## Live demo

[**bloom-oulu.vercel.app/demo-design/**](https://bloom-oulu.vercel.app/demo-design/)

Try:

1. **Scan the kiosk QR** with your phone → land on Pulsatilla patens.
2. **Switch the language** in the top bar → audio + captions + UI all swap atomically.
3. **Kid mode** (right panel) → plant introduces itself, sticker book counts up.
4. **School mode** → Alakoulu / Yläkoulu / Lukio reading levels + Start quiz + Print worksheet.
5. **Show on map** → real OpenStreetMap pin on the south esker bed.
6. **Read where your money goes** (Discover) → full funds-flow policy modal with audit + tax disclosure.
7. **Accessibility ♿ button** (bottom-left) → larger text, high contrast, reduced motion.

## Tech stack

| | |
|---|---|
| **Frontend** | Vanilla React 18 loaded via Babel-standalone (no build step). One global namespace; window-attached components. |
| **Mapping** | [Leaflet](https://leafletjs.com/) + OpenStreetMap tiles (free, no key). |
| **Weather** | [Open-Meteo](https://open-meteo.com/) (free, no key) — live readings for the Garden coordinates. |
| **QR codes** | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (vanilla JS) with level-H error correction. |
| **Audio** | macOS `say` (Samantha/Satu/Alva voices) → AAC m4a, served as static assets. |
| **Images** | Wikimedia Commons (CC-licensed, attributed in `plants/CREDITS.md`), resized to 800 px / 75 % JPEG via `sips`. |
| **Hosting** | [Vercel](https://vercel.com/) static deploy from `main`, auto-redeploy on push, EU region. |
| **Fonts** | Fraunces, Manrope, JetBrains Mono (Google Fonts). |

No npm, no bundler, no build pipeline — `git push` is the deploy. The entire site is static files.

## Project structure

```
BloomOulu/
├── index.html                 # Root redirect → /demo-design/
├── vercel.json                # cleanUrls, Cache-Control on demo
├── LICENSE                    # MIT
├── README.md                  # this file
└── demo-design/               # Self-contained prototype (~6 MB)
    ├── index.html             # CSS tokens, accessibility CSS, mobile @media
    ├── app.jsx                # Top nav, routing (hash-based deep links), toaster, a11y panel
    ├── data.jsx               # Plants, tiers, citations, season images, transcripts (3 langs)
    ├── translations.jsx       # FI + SV i18n (700+ keys)
    ├── icons.jsx              # Icons, BloomMark, PlantImage, QRCode, PlantMap, hooks, helpers
    ├── screens-discover.jsx   # Homepage
    ├── screens-plant.jsx      # Plant detail (Kid / School / Adult modes)
    ├── screens-adopt.jsx      # 4-step adoption flow
    ├── screens-ask.jsx        # AskTheGarden chat
    ├── screens-garden.jsx     # My Garden dashboard
    ├── screens-kiosk.jsx      # Lobby kiosk view
    ├── plants/                # 16 plant photos + CREDITS.md
    ├── audio/{en,fi,sv}/      # 24 m4a narrations + CREDITS.md
    ├── uploads/, assets/      # Logo + pitch deck
    └── chats/                 # Design handoff transcripts
```

## Local development

The project is plain static files — no build step. Run any HTTP server in the repo root:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve

# then open http://localhost:8000/demo-design/
```

The Plant page deep-links via URL hash (e.g. `…/demo-design/#plant=puls-pat`). The same hash is what the kiosk QR code encodes.

## Deployment

Pushing to `main` auto-deploys on Vercel (~30 seconds). Branches get preview URLs automatically.

To deploy your own fork: import the repo at [vercel.com/new](https://vercel.com/new) — leave framework as "Other" and root directory at `./`. Done.

## Accessibility

- **Keyboard:** every interactive element is reachable in tab order; `:focus-visible` outlines on all controls; skip-to-main-content link at page top.
- **Screen readers:** semantic `<header role="banner">`, `<main>`, `<nav aria-label>`, `<footer role="contentinfo">`, `aria-current="page"`, `aria-pressed` on toggle buttons, `lang=` attribute on translated regions, live region for toasts.
- **Motion:** respects `prefers-reduced-motion`; explicit in-app toggle.
- **Vision:** in-app larger-text + high-contrast modes; tap targets ≥44 px on mobile.
- **Audio:** on-screen captions for every narration in the playing language.
- **Internationalisation:** UI, narration audio, transcripts, and intent matching all support FI + SV + EN.

Targeted standards: **WCAG 2.2 AA** and the **European Accessibility Act 2025**.

## Internationalisation

| Surface | EN | FI | SV |
|---|:---:|:---:|:---:|
| UI strings | ✓ | ✓ | ✓ |
| Audio narration | ✓ | ✓ | ✓ |
| On-screen captions | ✓ | ✓ | ✓ |
| Chat intent matching | ✓ | ✓ | ✓ |
| Funds-flow disclosure | ✓ | ✓ | ✓ |
| Map labels | ✓ | ✓ | ✓ |

Plant scientific names stay constant; common names are pulled per language from `data.jsx`.

## Attribution

- **Plant photos** — Wikimedia Commons under various Creative Commons licences. See [`demo-design/plants/CREDITS.md`](./demo-design/plants/CREDITS.md) for per-image source + author.
- **Map tiles** — © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- **Weather data** — [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).
- **Research** — peer-benchmarked against Kew (UK), Meise (BE), ELTE Füvészkert (HU), Royal Botanic Garden Edinburgh, Queens Botanical Garden (US), New York Botanical Garden, Mount Auburn Cemetery, Singapore Botanic Gardens, BGCI / IUCN Red List.

## Status

⚠️ **This is a reference prototype.** It is the visual + interaction handoff from the design phase, deployed live so stakeholders can experience the full flow. A production build with proper SSR/SSG, real payments (MobilePay + Stripe), an authoritative accession DB sync, a CMS-backed transcript pipeline, and human-recorded audio is the next phase.

## License

MIT — see [`LICENSE`](./LICENSE).

## Acknowledgments

- **Team Meraki** — concept, research, design, build.
- **University of Oulu Botanical Garden** — Director Jouni Aspi, Curator Anna Liisa Ruotsalainen, Head Gardener Tuomas Kauppila.
- **University of Oulu Biodiversity Unit** — corpus grounding for AskTheGarden.
- **BGCI** + **LIFE+ ESCAPE** project (LIFE11 BIO/FI/000917) — conservation framing.
- Built with [Claude Code](https://www.anthropic.com/claude-code) (Claude Opus 4.7).

<div align="center">

*65.0617° N, 25.4661° E · Oulu, Finland*

</div>
