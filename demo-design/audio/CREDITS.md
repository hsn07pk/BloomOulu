# Plant audio narrations

Each file is a ~20-30 second audio narration of the plant's story:
common name, conservation status, brief origin, and one notable fact.

**Voice**: synthesised with the macOS `say` command using the Samantha
voice (en_US, AAC m4a, rate 175 wpm). For a real production deployment,
these placeholder narrations should be re-recorded with a human voice
(e.g. Yle Radio Suomi presenter) or replaced with a higher-quality
neural TTS (Azure Neural Finnish, ElevenLabs, etc.), matched to all
three site languages (FI / SV / EN).

| File | Plant | Duration |
|---|---|---|
| `puls-pat.m4a` | *Pulsatilla patens* | 0:30 |
| `camp-uni.m4a` | *Campanula uniflora* | 0:27 |
| `saxi-hirc.m4a` | *Saxifraga hirculus* | 0:23 |
| `prim-nut.m4a` | *Primula nutans* | 0:20 |
| `trol-eur.m4a` | *Trollius europaeus* | 0:25 |
| `cyp-cal.m4a` | *Cypripedium calceolus* | 0:25 |
| `lob-pul.m4a` | *Lobaria pulmonaria* | 0:23 |
| `vict-am.m4a` | *Victoria amazonica* | 0:24 |

The script for each narration lives inline in the generation step at
`audio/CREDITS.md` history; regenerate by editing the script + running
`say -v Samantha -r 175 -o <id>.m4a --data-format=aac "<text>"`.

## Multilingual narration

Each plant now has three narrations in `audio/{en,fi,sv}/{id}.m4a`.

- **EN** - Samantha (en_US), 160 wpm
- **FI** - Satu (fi_FI), 150 wpm
- **SV** - Alva (sv_SE), 150 wpm

All generated via macOS `say --data-format=aac` with `[[slnc N]]` pause
markers for natural rhythm. The transcript field in `data.jsx` exposes
the same text per language for on-screen captions; the Plant screen
audio player swaps file + transcript whenever the language pill changes.
