/**
 * Lobby kiosk — full-bleed touchscreen display.
 *
 *   - Forest-deep background with animated radial glows
 *   - Live local clock (Europe/Helsinki) + weather strip (Open-Meteo, free)
 *   - "Blooming today" feature card with a real plant from the API
 *   - QR code → deep-link to the plant's mobile page so visitors can
 *     scan and continue the experience on their phone
 *   - AskTheGarden quick prompts
 *   - Adopter wall — last 10 active adoptions (donor wall opt-in respected
 *     server-side)
 *   - Offline tolerance: last successful feed cached in localStorage
 *   - Watchdog: if the heartbeat hasn't received a response in 3 min the
 *     browser reloads itself (recovers from a kiosk left running overnight)
 */
'use client';
import { useEffect, useState, useRef } from 'react';
import { getBrowserApiUrl, getWebUrl } from '@bloomoulu/constants';

const KIOSK_ID = process.env.NEXT_PUBLIC_KIOSK_ID ?? '';
const API_URL = getBrowserApiUrl();
const WEB_URL = getWebUrl();

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

interface Feed {
  featured: Plant | null;
  blooming: Plant[];
  recentAdoptions: Array<{
    id: string;
    publicName: string;
    plantNameFi: string;
    plantNameEn: string;
    tierName: string;
  }>;
}

interface Weather {
  temp: number;
  code: number;
  label: string;
  icon: string;
}

const WEATHER_LABELS: Record<number, { fi: string; icon: string }> = {
  0: { fi: 'Selkeää', icon: '☀' },
  1: { fi: 'Pilvistä', icon: '⛅' },
  2: { fi: 'Pilvistä', icon: '⛅' },
  3: { fi: 'Pilvistä', icon: '☁' },
  45: { fi: 'Sumua', icon: '🌫' },
  61: { fi: 'Sadetta', icon: '🌧' },
  63: { fi: 'Sadetta', icon: '🌧' },
  71: { fi: 'Lumisadetta', icon: '🌨' },
  73: { fi: 'Lumisadetta', icon: '🌨' },
  95: { fi: 'Ukkosta', icon: '⛈' },
};

function PlantSparkQR({ url, size = 220 }: { url: string; size?: number }) {
  // Render the QR via a tiny inline data-URI generator. We use the
  // qrcode-generator package the project already depends on.
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

export default function KioskPage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [weather, setWeather] = useState<Weather | null>(null);
  const lastHeartbeatOk = useRef<number>(Date.now());

  // Tick the wall clock every 30s.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
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

  // Open-Meteo for Oulu (no API key, free, EU-hosted).
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=65.06&longitude=25.47&current=temperature_2m,weather_code&timezone=Europe%2FHelsinki',
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          current: { temperature_2m: number; weather_code: number };
        };
        const code = j.current.weather_code;
        const meta = WEATHER_LABELS[code] ?? { fi: '—', icon: '🌡' };
        setWeather({
          temp: Math.round(j.current.temperature_2m),
          code,
          label: meta.fi,
          icon: meta.icon,
        });
      } catch {
        /* offline — fine */
      }
    }
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => clearInterval(t);
  }, []);

  const featured = feed?.featured ?? feed?.blooming?.[0] ?? null;
  const story = featured?.story?.fi ?? featured?.story?.en ?? '';
  const featuredLink = featured ? `${WEB_URL}/fi/plants/${featured.slug}?from=kiosk` : '';

  return (
    <main
      style={{
        background: 'var(--forest-deep, #1F3C2D)',
        color: 'var(--cream, #FAF7EE)',
        minHeight: '100vh',
        padding: '32px 48px',
        fontFamily:
          "'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative glows */}
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
                Tervetuloa.
              </div>
              <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#A8C060', marginTop: 4 }}>
                Lobby kiosk · Romeo & Julia entrance
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 32 }}>
                {now.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#A8C060' }}>
                {now.toLocaleDateString('fi-FI', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </div>
            </div>
            {weather && (
              <span
                style={{
                  padding: '10px 18px',
                  borderRadius: 999,
                  background: 'rgba(250,247,238,0.12)',
                  border: '1px solid rgba(250,247,238,0.18)',
                  fontSize: 14,
                }}
              >
                {weather.icon} {weather.temp} °C · {weather.label}
              </span>
            )}
          </div>
        </header>

        {/* Main grid */}
        <section
          style={{
            marginTop: 32,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)',
            gap: 24,
          }}
        >
          {/* Blooming today */}
          <article
            style={{
              background:
                'linear-gradient(160deg, rgba(250,247,238,0.06) 0%, rgba(250,247,238,0.02) 100%)',
              borderRadius: 16,
              border: '1px solid rgba(250,247,238,0.12)',
              padding: 32,
              position: 'relative',
              minHeight: 380,
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#A8C060' }}>
              Blooming today
            </div>
            {featured ? (
              <>
                <h2
                  style={{
                    fontFamily: "'Fraunces', serif",
                    fontSize: 56,
                    marginTop: 16,
                    fontStyle: 'italic',
                  }}
                >
                  {featured.taxon?.latinName ?? featured.nameEn}
                </h2>
                <div
                  style={{
                    fontFamily: "'Fraunces', serif",
                    fontSize: 22,
                    color: '#A8C060',
                    marginTop: 4,
                  }}
                >
                  {featured.nameFi} · {featured.nameEn.toLowerCase()}
                </div>
                <p
                  style={{
                    fontSize: 17,
                    color: 'rgba(250,247,238,0.78)',
                    lineHeight: 1.5,
                    marginTop: 20,
                    maxWidth: 480,
                  }}
                >
                  {story}
                </p>
              </>
            ) : (
              <p style={{ marginTop: 24, color: 'rgba(250,247,238,0.6)' }}>
                Loading today's feature…
              </p>
            )}
          </article>

          {/* QR launcher */}
          <article
            style={{
              background: '#FAF7EE',
              color: '#18271E',
              borderRadius: 16,
              padding: 32,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#2D5440' }}>
              Begin your visit
            </div>
            <h3
              style={{
                fontFamily: "'Fraunces', serif",
                fontSize: 32,
                marginTop: 12,
              }}
            >
              Scan any plant.
            </h3>
            <p style={{ marginTop: 8, fontSize: 13, color: '#5C6E60' }}>
              3-language audio narration. Free, no login.
            </p>
            <div style={{ marginTop: 24, alignSelf: 'center' }}>
              {featuredLink ? <PlantSparkQR url={featuredLink} /> : null}
            </div>
            <div style={{ marginTop: 16, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#5C6E60', textAlign: 'center' }}>
              Scan with your phone camera
            </div>
          </article>

          {/* AskTheGarden */}
          <article
            style={{
              background:
                'linear-gradient(160deg, #A8C060 0%, #5FB0A0 100%)',
              color: '#1F3C2D',
              borderRadius: 16,
              padding: 32,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase' }}>
                Ask the Garden
              </div>
              <h3
                style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: 30,
                  marginTop: 12,
                }}
              >
                What would you like to know?
              </h3>
              <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.5, color: 'rgba(31,60,45,0.8)' }}>
                Trained on the Garden's own science. Every answer cites its source.
              </p>
            </div>
            <div style={{ marginTop: 20 }}>
              {[
                "What's blooming this week?",
                'Where are the endangered plants?',
                'When does the water lily bloom?',
              ].map((q) => (
                <a
                  key={q}
                  href={`${WEB_URL}/fi/ask?q=${encodeURIComponent(q)}`}
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
                  "{q}"
                </a>
              ))}
            </div>
          </article>
        </section>

        {/* Adopter wall */}
        <section style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#A8C060' }}>
            Recent adoptions
          </div>
          <h3
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 28,
              marginTop: 8,
              marginBottom: 16,
            }}
          >
            People keeping Finland in bloom
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            {(feed?.recentAdoptions ?? []).slice(0, 10).map((a) => (
              <div
                key={a.id}
                style={{
                  padding: 14,
                  background: 'rgba(250,247,238,0.05)',
                  border: '1px solid rgba(250,247,238,0.10)',
                  borderRadius: 10,
                }}
              >
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18 }}>
                  {a.publicName}
                </div>
                <div style={{ fontSize: 12, color: '#A8C060', marginTop: 4 }}>
                  → <em>{a.plantNameEn}</em>
                </div>
                <div style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(250,247,238,0.5)', marginTop: 6 }}>
                  {a.tierName}
                </div>
              </div>
            ))}
            {!feed?.recentAdoptions?.length && (
              <p style={{ gridColumn: '1 / -1', color: 'rgba(250,247,238,0.5)', fontStyle: 'italic' }}>
                Be the first to adopt today.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
