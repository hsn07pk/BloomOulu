/**
 * Lobby kiosk — full-bleed touchscreen display.
 *
 * Header:
 *   - Brand mark + Tervetuloa + sublabel ("Lobby kiosk · {label}")
 *   - Language pill (EN / FI / SV) — switches all kiosk copy and link
 *     locales for the rest of the session
 *   - Live local clock (Europe/Helsinki, seconds-precision, 1 Hz tick)
 *     and locale-formatted long-form date
 *   - Weather pill from Open-Meteo (temp + feels-like + humidity + wind)
 *
 * Main 3-col grid (1.4 / 1 / 1):
 *   - Most visited: 3×2 grid of plant tiles (image + vernacular + Latin)
 *     ordered by Plant.viewCount DESC
 *   - QR launcher: cream card with a real scannable QR that encodes the
 *     BloomOulu homepage URL + 2-step instructions
 *   - Ask the Garden: gradient card with 3 example-question chips +
 *     "Tap to ask" link to /{locale}/ask
 *
 * Bottom row (2 / 1.2):
 *   - Adopter wall: all-time totals header + colour-coded chips
 *     (corporate / class / memorial / individual based on Adoption.intent)
 *   - Today's stats: vertical 3-stack — Scans / Questions / Adoptions
 *     (with €raised-today as the sub-line on the Adoptions tile)
 *
 * Footer: monospace uppercase strip with brand line + version + date.
 *
 * Polling & resilience:
 *   - Feed polled every 60s, cached in localStorage as bloomoulu.kiosk.feed
 *   - Heartbeat every 60s; watchdog reloads the page if no heartbeat
 *     succeeds for 3 min (recovers a kiosk left running overnight)
 *   - Weather polled every 10 min
 *
 * SSR / hydration:
 *   - Anything time-dependent (clock, date, footer date) renders blank
 *     on SSR and fills in after mount. This avoids the "server rendered
 *     00:02:58 but client wants 00:02:59" hydration warning.
 */
'use client';
import { useEffect, useState, useRef } from 'react';
import { getBrowserApiUrl, getWebUrl } from '@bloomoulu/constants';

const KIOSK_ID = process.env.NEXT_PUBLIC_KIOSK_ID ?? '';
const KIOSK_SUBLABEL =
  process.env.NEXT_PUBLIC_KIOSK_SUBLABEL ?? 'Romeo & Julia entrance';
const API_URL = getBrowserApiUrl();
const WEB_URL = getWebUrl();

// ─── Types ───────────────────────────────────────────────────────────

type Locale = 'en' | 'fi' | 'sv';

interface Plant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  bloomSeason: string;
  bloomWindow?: string | null;
  story: Record<string, string>;
  primaryImage?: { url: string } | null;
  taxon?: { latinName: string } | null;
}

type Intent = 'for_self' | 'gift' | 'memorial' | 'class' | 'corporate';

interface RecentAdoption {
  id: string;
  publicName: string;
  plantNameFi: string;
  plantNameEn: string;
  tierName: string;
  intent: Intent;
}

interface Feed {
  featured: Plant | null;
  blooming: Plant[];
  mostVisited?: Plant[];
  recentAdoptions: RecentAdoption[];
  totals?: { supporters: number; raisedCents: number };
  todayStats?: {
    scans: number;
    questions: number;
    adoptions: number;
    raisedTodayCents: number;
  };
}

interface Weather {
  temp: number;
  feelsLike: number;
  humidity: number;
  windKmh: number;
  code: number;
}

// ─── Locale-aware copy + helpers ─────────────────────────────────────

// Typed shape — every locale must implement every key. Lets `t.welcome`
// resolve to `string` (not `string | undefined`) under
// noUncheckedIndexedAccess, and a missing key in one locale is a
// compile error rather than a silent fallback.
interface KioskStrings {
  welcome: string;
  lobbyKiosk: string;
  feelsLike: string;
  humidity: string;
  wind: string;
  mostVisited: string;
  mostVisitedHint: string;
  beginYourVisit: string;
  exploreHomepage: string;
  exploreSubtitle: string;
  scanWithCamera: string;
  step1: string;
  step2: string;
  askTheGarden: string;
  askH3: string;
  askSubtitle: string;
  askQ1: string;
  askQ2: string;
  askQ3: string;
  tapToAsk: string;
  theAdopterWall: string;
  supportersRaised: string;
  liveSinceLaunch: string;
  beFirst: string;
  scansToday: string;
  questionsAsked: string;
  adoptionsToday: string;
  qrScanned: string;
  toAsk: string;
  raisedToday: string;
  noNewAdoptions: string;
  footerBrand: string;
  footerVersion: string;
}

const STRINGS: Record<Locale, KioskStrings> = {
  en: {
    welcome: 'Welcome.',
    lobbyKiosk: 'Lobby kiosk',
    feelsLike: 'Feels {n} °C',
    humidity: 'Humidity {n}%',
    wind: 'Wind {n} km/h',
    mostVisited: 'Most visited',
    mostVisitedHint: 'Plants visitors are reading about right now',
    beginYourVisit: 'Begin your visit',
    exploreHomepage: 'Explore on your phone.',
    exploreSubtitle: 'Browse every plant, listen to narrations, adopt your favourite.',
    scanWithCamera: 'Scan with your phone camera',
    step1: 'Point your camera at the QR code',
    step2: 'Browse, listen, or adopt — right from your phone',
    askTheGarden: 'Ask the Garden',
    askH3: 'What would you like to know?',
    askSubtitle: "Trained on the Garden's own science. Every answer cites its source.",
    askQ1: "What's blooming this week?",
    askQ2: 'Where are the endangered plants?',
    askQ3: 'When does the water lily bloom?',
    tapToAsk: 'Tap to ask',
    theAdopterWall: 'The adopter wall',
    supportersRaised: '{n} supporters · {raised} raised · all time',
    liveSinceLaunch: 'Live · since launch',
    beFirst: 'Be the first to adopt today.',
    scansToday: 'Scans today',
    questionsAsked: 'Questions asked',
    adoptionsToday: 'Adoptions today',
    qrScanned: 'QR codes scanned',
    toAsk: 'to AskTheGarden',
    raisedToday: '{raised} raised',
    noNewAdoptions: 'No new adoptions yet',
    footerBrand: 'University of Oulu Botanical Garden · 65.0617° N',
    footerVersion: 'BloomOulu v1.0',
  },
  fi: {
    welcome: 'Tervetuloa.',
    lobbyKiosk: 'Aulakioski',
    feelsLike: 'Tuntuu {n} °C',
    humidity: 'Kosteus {n}%',
    wind: 'Tuuli {n} km/h',
    mostVisited: 'Eniten katsotut',
    mostVisitedHint: 'Kasvit, joista vierailijat ovat juuri nyt kiinnostuneet',
    beginYourVisit: 'Aloita vierailusi',
    exploreHomepage: 'Selaa puhelimellasi.',
    exploreSubtitle: 'Selaa kaikkia kasveja, kuuntele äänikertomuksia, adoptoi suosikkisi.',
    scanWithCamera: 'Skannaa puhelimesi kameralla',
    step1: 'Osoita kameralla QR-koodia',
    step2: 'Selaa, kuuntele tai adoptoi suoraan puhelimellasi',
    askTheGarden: 'Kysy puutarhalta',
    askH3: 'Mitä haluaisit tietää?',
    askSubtitle:
      'Koulutettu puutarhan omalla tieteellä. Jokainen vastaus mainitsee lähteensä.',
    askQ1: 'Mitä kukkii tällä viikolla?',
    askQ2: 'Missä uhanalaiset kasvit kasvavat?',
    askQ3: 'Milloin lumme kukkii?',
    tapToAsk: 'Napauta kysyäksesi',
    theAdopterWall: 'Adoptoijien seinä',
    supportersRaised: '{n} tukijaa · {raised} kerätty · kaikkien aikojen',
    liveSinceLaunch: 'Live · alusta asti',
    beFirst: 'Ole ensimmäinen adoptoija tänään.',
    scansToday: 'Skannauksia tänään',
    questionsAsked: 'Kysymyksiä esitetty',
    adoptionsToday: 'Adoptioita tänään',
    qrScanned: 'QR-koodia skannattu',
    toAsk: 'Kysy puutarhalta -palvelussa',
    raisedToday: '{raised} kerätty',
    noNewAdoptions: 'Ei uusia adoptioita vielä',
    footerBrand: 'Oulun yliopiston kasvitieteellinen puutarha · 65.0617° N',
    footerVersion: 'BloomOulu v1.0',
  },
  sv: {
    welcome: 'Välkommen.',
    lobbyKiosk: 'Lobbykiosk',
    feelsLike: 'Känns som {n} °C',
    humidity: 'Luftfuktighet {n}%',
    wind: 'Vind {n} km/h',
    mostVisited: 'Mest besökta',
    mostVisitedHint: 'Växter som besökare läser om just nu',
    beginYourVisit: 'Börja ditt besök',
    exploreHomepage: 'Utforska med din telefon.',
    exploreSubtitle: 'Bläddra bland alla växter, lyssna på berättelser, adoptera din favorit.',
    scanWithCamera: 'Skanna med din telefonkamera',
    step1: 'Rikta kameran mot QR-koden',
    step2: 'Bläddra, lyssna eller adoptera — direkt från din telefon',
    askTheGarden: 'Fråga trädgården',
    askH3: 'Vad vill du veta?',
    askSubtitle:
      'Tränad på trädgårdens egen vetenskap. Varje svar citerar sin källa.',
    askQ1: 'Vad blommar denna vecka?',
    askQ2: 'Var finns de hotade växterna?',
    askQ3: 'När blommar näckrosen?',
    tapToAsk: 'Tryck för att fråga',
    theAdopterWall: 'Adoptörväggen',
    supportersRaised: '{n} stödjare · {raised} insamlat · genom tiderna',
    liveSinceLaunch: 'Live · sedan starten',
    beFirst: 'Bli den första adoptören idag.',
    scansToday: 'Skanningar idag',
    questionsAsked: 'Frågor ställda',
    adoptionsToday: 'Adoptioner idag',
    qrScanned: 'QR-koder skannade',
    toAsk: 'till Fråga trädgården',
    raisedToday: '{raised} insamlat',
    noNewAdoptions: 'Inga nya adoptioner än',
    footerBrand: 'Uleåborgs universitets botaniska trädgård · 65.0617° N',
    footerVersion: 'BloomOulu v1.0',
  },
};

// Weather lives outside KioskStrings so the access pattern is by
// numeric code, not a stringified-and-asserted key.
interface WeatherDescriptor {
  en: string;
  fi: string;
  sv: string;
  icon: string;
}
const WEATHER_BY_CODE: Record<number, WeatherDescriptor> = {
  0: { en: 'Clear', fi: 'Selkeää', sv: 'Klart', icon: '☀' },
  1: { en: 'Cloudy', fi: 'Pilvistä', sv: 'Molnigt', icon: '⛅' },
  2: { en: 'Cloudy', fi: 'Pilvistä', sv: 'Molnigt', icon: '⛅' },
  3: { en: 'Overcast', fi: 'Pilvistä', sv: 'Mulet', icon: '☁' },
  45: { en: 'Fog', fi: 'Sumua', sv: 'Dimma', icon: '🌫' },
  61: { en: 'Rain', fi: 'Sadetta', sv: 'Regn', icon: '🌧' },
  63: { en: 'Rain', fi: 'Sadetta', sv: 'Regn', icon: '🌧' },
  71: { en: 'Snow', fi: 'Lumisadetta', sv: 'Snö', icon: '🌨' },
  73: { en: 'Snow', fi: 'Lumisadetta', sv: 'Snö', icon: '🌨' },
  95: { en: 'Thunderstorm', fi: 'Ukkosta', sv: 'Åska', icon: '⛈' },
};

function weatherFor(code: number, l: Locale): { label: string; icon: string } {
  const d = WEATHER_BY_CODE[code];
  if (!d) return { label: '—', icon: '🌡' };
  return { label: d[l], icon: d.icon };
}

const INTENT_CHIP: Record<Intent, { bg: string; color: string; italic: boolean }> = {
  // Institutional adoptions sit in the sage tint — visually punctuates the
  // wall by community-vs-corporate, matching the demo design system.
  corporate: { bg: 'rgba(168,192,96,0.18)', color: '#C8DC8C', italic: false },
  class: { bg: 'rgba(168,192,96,0.18)', color: '#C8DC8C', italic: false },
  // Memorial adoptions in a copper italic that quietly distinguishes them.
  memorial: { bg: 'rgba(178,92,58,0.18)', color: '#E5A88B', italic: true },
  // Personal / gift adoptions in cream on subtle paper-tone fill.
  gift: { bg: 'rgba(250,247,238,0.08)', color: '#FAF7EE', italic: false },
  for_self: { bg: 'rgba(250,247,238,0.08)', color: '#FAF7EE', italic: false },
};

function interp(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

function intlLocale(l: Locale): string {
  return l === 'fi' ? 'fi-FI' : l === 'sv' ? 'sv-FI' : 'en-GB';
}

function euro(cents: number, l: Locale): string {
  return new Intl.NumberFormat(intlLocale(l), {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function plantName(p: Plant, l: Locale): string {
  return l === 'fi' ? p.nameFi : l === 'sv' ? p.nameSv : p.nameEn;
}

// ─── Components ──────────────────────────────────────────────────────

function PlantSparkQR({ url, size = 200 }: { url: string; size?: number }) {
  // Render the QR via the existing qrcode-generator dep — same pattern
  // we used before, just keyed off the homepage URL now.
  const [svg, setSvg] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    import('qrcode-generator').then((m) => {
      const qr = m.default(0, 'H');
      qr.addData(url);
      qr.make();
      if (!cancelled) setSvg(qr.createSvgTag({ scalable: true }));
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return (
    <div
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-hidden="true"
    />
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export default function KioskPage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  // `now` starts null so SSR markup carries no time text and the client's
  // first paint (which DOES have a value) doesn't trip React's hydration
  // diff. The 1 Hz interval fills it in immediately on mount.
  const [now, setNow] = useState<Date | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [locale, setLocale] = useState<Locale>('fi');
  const lastHeartbeatOk = useRef<number>(Date.now());

  const t = STRINGS[locale];

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Pull feed every 60s, cache the last good payload, watchdog every 60s.
  useEffect(() => {
    let alive = true;
    async function pullFeed() {
      try {
        const res = await fetch(`${API_URL}/v1/kiosks/${KIOSK_ID || 'lobby'}/feed`, {
          cache: 'no-store',
        });
        if (alive && res.ok) {
          const data = (await res.json()) as Feed;
          setFeed(data);
          lastHeartbeatOk.current = Date.now();
          try {
            window.localStorage.setItem('bloomoulu.kiosk.feed', JSON.stringify(data));
          } catch {
            /* private mode — fine */
          }
        }
      } catch {
        // Use cached feed if available.
        try {
          const cached = window.localStorage.getItem('bloomoulu.kiosk.feed');
          if (cached && alive && !feed) setFeed(JSON.parse(cached) as Feed);
        } catch {
          /* no cache */
        }
      }
    }
    async function heartbeat() {
      try {
        const res = await fetch(`${API_URL}/v1/kiosks/heartbeat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceId: KIOSK_ID }),
        });
        if (res.ok) lastHeartbeatOk.current = Date.now();
      } catch {
        /* ignore — watchdog reloads if it goes too quiet */
      }
    }
    pullFeed();
    heartbeat();
    const t1 = setInterval(pullFeed, 60_000);
    const t2 = setInterval(heartbeat, 60_000);
    const t3 = setInterval(() => {
      // Watchdog: 3 minutes without a single successful exchange → reload.
      if (Date.now() - lastHeartbeatOk.current > 3 * 60_000) {
        window.location.reload();
      }
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open-Meteo for Oulu (no API key, free, EU-hosted). We request temp,
  // apparent (feels-like), humidity, wind in addition to the weather code
  // so the pill carries a bit more context than just "13 °C".
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=65.06&longitude=25.47&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=Europe%2FHelsinki&wind_speed_unit=kmh',
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          current: {
            temperature_2m: number;
            apparent_temperature: number;
            relative_humidity_2m: number;
            wind_speed_10m: number;
            weather_code: number;
          };
        };
        setWeather({
          temp: Math.round(j.current.temperature_2m),
          feelsLike: Math.round(j.current.apparent_temperature),
          humidity: Math.round(j.current.relative_humidity_2m),
          windKmh: Math.round(j.current.wind_speed_10m),
          code: j.current.weather_code,
        });
      } catch {
        /* offline — fine */
      }
    }
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => clearInterval(id);
  }, []);

  const totals = feed?.totals ?? { supporters: 0, raisedCents: 0 };
  const stats = feed?.todayStats ?? {
    scans: 0,
    questions: 0,
    adoptions: 0,
    raisedTodayCents: 0,
  };
  const adoptions = feed?.recentAdoptions ?? [];
  // Fall back to `blooming` if mostVisited is missing (e.g. cached
  // payload from a pre-deploy client) — keeps the kiosk filled.
  const visited = (feed?.mostVisited ?? feed?.blooming ?? []).slice(0, 6);

  // QR target: the public BloomOulu homepage. Resolves via WEB_URL
  // (NEXT_PUBLIC_WEB_URL, defaulted in @bloomoulu/constants).
  // TODO(deploy): in dev this is http://localhost:3000. For production,
  // set NEXT_PUBLIC_WEB_URL on the kiosk container to the live URL
  // (e.g. https://bloomoulu.fi) so visitors' phones don't load
  // localhost from a QR.
  const homepageQrUrl = `${WEB_URL}/${locale}`;

  const numberFi = new Intl.NumberFormat(intlLocale(locale));
  const weatherInfo = weather ? weatherFor(weather.code, locale) : null;

  return (
    <main
      style={{
        background: 'var(--forest-deep, #1F3C2D)',
        color: 'var(--cream, #FAF7EE)',
        minHeight: '100vh',
        padding: '32px 48px 24px',
        fontFamily:
          "'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes bloomoulu-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>

      {/* Decorative glows + veining */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 80% 20%, rgba(95,176,160,0.15) 0%, transparent 50%), radial-gradient(circle at 10% 80%, rgba(168,192,96,0.10) 0%, transparent 50%)',
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(115deg, transparent, transparent 80px, rgba(168,192,96,.03) 80px, rgba(168,192,96,.03) 81px)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* ─── HEADER ──────────────────────────────────────────────── */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: 28,
            borderBottom: '1px solid rgba(250,247,238,0.14)',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span
              aria-hidden="true"
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background:
                  'linear-gradient(135deg, #2D5440 0%, #5FB0A0 50%, #A8C060 100%)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Fraunces', serif",
                fontSize: 26,
                fontWeight: 600,
              }}
            >
              B
            </span>
            <div>
              <div
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: 32,
                  letterSpacing: '-0.02em',
                }}
              >
                {t.welcome}
              </div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: '#A8C060',
                  marginTop: 4,
                }}
              >
                {t.lobbyKiosk} · {KIOSK_SUBLABEL}
              </div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 18,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {/* Language pill — toggles all kiosk copy + link locales */}
            <div
              role="group"
              aria-label="Language"
              style={{
                display: 'inline-flex',
                padding: 4,
                borderRadius: 999,
                background: 'rgba(250,247,238,0.08)',
                border: '1px solid rgba(250,247,238,0.16)',
                gap: 2,
              }}
            >
              {(['en', 'fi', 'sv'] as const).map((l) => {
                const active = l === locale;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLocale(l)}
                    aria-pressed={active}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 999,
                      border: 'none',
                      background: active ? '#FAF7EE' : 'transparent',
                      color: active ? '#1F3C2D' : '#FAF7EE',
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      transition: 'background 120ms ease, color 120ms ease',
                    }}
                  >
                    {l === 'en' ? 'EN' : l === 'fi' ? 'FI' : 'SV'}
                  </button>
                );
              })}
            </div>
            <div style={{ textAlign: 'right', minWidth: 160 }}>
              <div
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: 32,
                  fontVariantNumeric: 'tabular-nums',
                  minHeight: 38,
                }}
              >
                {now
                  ? now.toLocaleTimeString(intlLocale(locale), {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : ''}
              </div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: '#A8C060',
                  minHeight: 14,
                }}
              >
                {now
                  ? now.toLocaleDateString(intlLocale(locale), {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  : ''}
              </div>
            </div>
            {weather && weatherInfo && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '10px 18px',
                  borderRadius: 16,
                  background: 'rgba(250,247,238,0.10)',
                  border: '1px solid rgba(250,247,238,0.18)',
                  minWidth: 220,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 16,
                  }}
                >
                  <span aria-hidden="true">{weatherInfo.icon}</span>
                  <strong>{weather.temp}&nbsp;°C</strong>
                  <span style={{ color: 'rgba(250,247,238,0.7)' }}>·</span>
                  <span>{weatherInfo.label}</span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'rgba(250,247,238,0.65)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {interp(t.feelsLike, { n: weather.feelsLike })} ·{' '}
                  {interp(t.humidity, { n: weather.humidity })} ·{' '}
                  {interp(t.wind, { n: weather.windKmh })}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* ─── MAIN 3-COL GRID ─────────────────────────────────────── */}
        <section
          style={{
            marginTop: 32,
            display: 'grid',
            gridTemplateColumns:
              'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)',
            gap: 24,
          }}
        >
          {/* Most visited — 3x2 grid of plant tiles */}
          <article
            style={{
              background:
                'linear-gradient(160deg, rgba(250,247,238,0.06) 0%, rgba(250,247,238,0.02) 100%)',
              borderRadius: 16,
              border: '1px solid rgba(250,247,238,0.12)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 380,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.24em',
                textTransform: 'uppercase',
                color: '#A8C060',
              }}
            >
              {t.mostVisited}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'rgba(250,247,238,0.6)',
                marginTop: 6,
                marginBottom: 16,
              }}
            >
              {t.mostVisitedHint}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridTemplateRows: 'repeat(2, 1fr)',
                gap: 12,
                flex: 1,
              }}
            >
              {visited.length === 0 &&
                // Skeleton — 6 empty tiles while the feed loads.
                Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={`skel-${i}`}
                    style={{
                      background: 'rgba(250,247,238,0.04)',
                      borderRadius: 10,
                      border: '1px solid rgba(250,247,238,0.08)',
                    }}
                  />
                ))}
              {visited.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: 'rgba(250,247,238,0.04)',
                    borderRadius: 10,
                    border: '1px solid rgba(250,247,238,0.10)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      aspectRatio: '4 / 3',
                      background: p.primaryImage?.url
                        ? `url(${p.primaryImage.url}) center/cover no-repeat`
                        : 'linear-gradient(135deg, rgba(168,192,96,0.25), rgba(95,176,160,0.20))',
                      borderBottom: '1px solid rgba(250,247,238,0.08)',
                    }}
                    role="img"
                    aria-label={plantName(p, locale)}
                  />
                  <div
                    style={{
                      padding: '10px 12px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      flex: 1,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Fraunces', serif",
                        fontSize: 15,
                        lineHeight: 1.2,
                        color: '#FAF7EE',
                      }}
                    >
                      {plantName(p, locale)}
                    </div>
                    {p.taxon?.latinName && (
                      <div
                        style={{
                          fontFamily: "'Fraunces', serif",
                          fontSize: 11,
                          fontStyle: 'italic',
                          color: 'rgba(168,192,96,0.85)',
                        }}
                      >
                        {p.taxon.latinName}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>

          {/* QR launcher — points at the BloomOulu homepage */}
          <article
            style={{
              background: '#FAF7EE',
              color: '#18271E',
              borderRadius: 16,
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.24em',
                textTransform: 'uppercase',
                color: '#2D5440',
              }}
            >
              {t.beginYourVisit}
            </div>
            <h3
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 28,
                marginTop: 10,
              }}
            >
              {t.exploreHomepage}
            </h3>
            <p style={{ marginTop: 6, fontSize: 13, color: '#5C6E60' }}>
              {t.exploreSubtitle}
            </p>
            <div
              style={{
                marginTop: 18,
                alignSelf: 'center',
                padding: 14,
                background: '#FFFFFF',
                borderRadius: 12,
                border: '1px solid #E2E0D2',
              }}
            >
              <PlantSparkQR url={homepageQrUrl} size={170} />
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: '#5C6E60',
                textAlign: 'center',
              }}
            >
              {t.scanWithCamera}
            </div>
            <ol
              style={{
                listStyle: 'none',
                padding: 0,
                marginTop: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {[t.step1, t.step2].map((step, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 13,
                    color: '#3F5045',
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: '#2D5440',
                      color: '#FAF7EE',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </article>

          {/* AskTheGarden */}
          <article
            style={{
              background:
                'linear-gradient(160deg, #A8C060 0%, #5FB0A0 100%)',
              color: '#1F3C2D',
              borderRadius: 16,
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                }}
              >
                {t.askTheGarden}
              </div>
              <h3
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: 28,
                  marginTop: 12,
                }}
              >
                {t.askH3}
              </h3>
              <p
                style={{
                  marginTop: 12,
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: 'rgba(31,60,45,0.8)',
                }}
              >
                {t.askSubtitle}
              </p>
            </div>
            <div style={{ marginTop: 20 }}>
              {[t.askQ1, t.askQ2, t.askQ3].map((q) => (
                <a
                  key={q}
                  href={`${WEB_URL}/${locale}/ask?q=${encodeURIComponent(q)}`}
                  style={{
                    display: 'block',
                    padding: '12px 16px',
                    borderRadius: 10,
                    marginBottom: 8,
                    background: 'rgba(31,60,45,0.10)',
                    color: '#1F3C2D',
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  &ldquo;{q}&rdquo;
                </a>
              ))}
              <a
                href={`${WEB_URL}/${locale}/ask`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  marginTop: 12,
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: '#1F3C2D',
                  color: '#FAF7EE',
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <span aria-hidden="true">💬</span> {t.tapToAsk}
              </a>
            </div>
          </article>
        </section>

        {/* ─── BOTTOM ROW: ADOPTER WALL + STATS STACK ──────────────── */}
        <section
          style={{
            marginTop: 24,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.2fr)',
            gap: 24,
          }}
        >
          {/* Adopter wall — all-time */}
          <div
            style={{
              background: 'rgba(250,247,238,0.04)',
              borderRadius: 16,
              border: '1px solid rgba(250,247,238,0.12)',
              padding: 28,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 20,
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.24em',
                    textTransform: 'uppercase',
                    color: '#A8C060',
                  }}
                >
                  {t.theAdopterWall}
                </div>
                <h3
                  style={{
                    fontFamily: "'Fraunces', serif",
                    fontSize: 24,
                    marginTop: 6,
                    color: '#FAF7EE',
                  }}
                >
                  {interp(t.supportersRaised, {
                    n: numberFi.format(totals.supporters),
                    raised: euro(totals.raisedCents, locale),
                  })}
                </h3>
              </div>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'rgba(250,247,238,0.10)',
                  border: '1px solid rgba(250,247,238,0.18)',
                  fontSize: 12,
                  color: '#FAF7EE',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#C8DC8C',
                    animation: 'bloomoulu-blink 1.6s infinite',
                  }}
                />
                {t.liveSinceLaunch}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                maxHeight: 220,
                overflow: 'hidden',
              }}
            >
              {adoptions.map((a) => {
                const style = INTENT_CHIP[a.intent] ?? INTENT_CHIP.for_self;
                return (
                  <span
                    key={a.id}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 999,
                      background: style.bg,
                      color: style.color,
                      fontSize: 13,
                      fontStyle: style.italic ? 'italic' : 'normal',
                      border: '1px solid rgba(250,247,238,0.08)',
                    }}
                    title={`${a.plantNameFi} · ${a.tierName}`}
                  >
                    {a.publicName}
                  </span>
                );
              })}
              {!adoptions.length && (
                <p
                  style={{
                    color: 'rgba(250,247,238,0.5)',
                    fontStyle: 'italic',
                  }}
                >
                  {t.beFirst}
                </p>
              )}
            </div>

            {/* Bottom fade for the chip cloud */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 60,
                background:
                  'linear-gradient(180deg, transparent, var(--forest-deep, #1F3C2D))',
                pointerEvents: 'none',
              }}
            />
          </div>

          {/* Today's stats — vertical 3-stack. */}
          <div
            style={{
              display: 'grid',
              gridTemplateRows: 'repeat(3, 1fr)',
              gap: 12,
            }}
          >
            {(
              [
                {
                  label: t.scansToday,
                  value: numberFi.format(stats.scans),
                  sub: t.qrScanned,
                  icon: '▣',
                },
                {
                  label: t.questionsAsked,
                  value: numberFi.format(stats.questions),
                  sub: t.toAsk,
                  icon: '◆',
                },
                {
                  label: t.adoptionsToday,
                  value: numberFi.format(stats.adoptions),
                  sub:
                    stats.raisedTodayCents > 0
                      ? interp(t.raisedToday, {
                          raised: euro(stats.raisedTodayCents, locale),
                        })
                      : t.noNewAdoptions,
                  icon: '✿',
                },
              ] as const
            ).map((s) => (
              <div
                key={s.label}
                style={{
                  padding: 20,
                  background: 'rgba(250,247,238,0.04)',
                  borderRadius: 12,
                  border: '1px solid rgba(250,247,238,0.10)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: 90,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'rgba(168,192,96,0.18)',
                      color: '#C8DC8C',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                    }}
                  >
                    {s.icon}
                  </span>
                  <span
                    style={{
                      fontFamily: "'Fraunces', serif",
                      fontSize: 38,
                      lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {s.value}
                  </span>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      color: '#A8C060',
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'rgba(250,247,238,0.55)',
                      marginTop: 2,
                    }}
                  >
                    {s.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ─── FOOTER ──────────────────────────────────────────────── */}
        <footer
          style={{
            marginTop: 28,
            paddingTop: 18,
            borderTop: '1px solid rgba(250,247,238,0.14)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            color: 'rgba(250,247,238,0.5)',
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span>{t.footerBrand}</span>
          <span>
            {t.footerVersion} · {now ? now.toLocaleDateString(intlLocale(locale)) : ''}
          </span>
        </footer>
      </div>
    </main>
  );
}
