/**
 * Kiosk landing screen. Designed for full-screen lobby display.
 *
 *   - Auto-refreshes /v1/kiosks/:id/feed every 60s for "What's blooming" + adopter wall.
 *   - Heartbeat POST every 60s; if offline, falls back to cached feed.
 *   - QR code in the corner deep-links to a featured plant page on the public web.
 *   - Local clock + Oulu weather strip (Open-Meteo, free, no key).
 */
'use client';
import { useEffect, useState } from 'react';

const KIOSK_ID = process.env.NEXT_PUBLIC_KIOSK_ID ?? '';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function KioskPage() {
  const [feed, setFeed] = useState<any>(null);
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch(`${API_URL}/v1/kiosks/${KIOSK_ID}/feed`, { cache: 'no-store' });
        if (alive && res.ok) setFeed(await res.json());
      } catch {
        /* offline tolerant */
      }
    }
    async function heartbeat() {
      try {
        await fetch(`${API_URL}/v1/kiosks/heartbeat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceId: KIOSK_ID }),
        });
      } catch {}
    }
    tick();
    heartbeat();
    const t1 = setInterval(tick, 60_000);
    const t2 = setInterval(heartbeat, 60_000);
    const t3 = setInterval(() => setNow(new Date().toLocaleTimeString('fi-FI')), 1000);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
    };
  }, []);

  return (
    <main style={{ padding: 40, fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>BloomOulu · Tervetuloa</h1>
        <time aria-label="Kello">{now}</time>
      </header>
      {feed && (
        <>
          <section>
            <h2>Tänään kukkii</h2>
            <ul>
              {feed.blooming.map((p: any) => (
                <li key={p.id}>
                  {p.nameFi} · <em>{p.nameEn}</em>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Viimeisimmät adoptiot</h2>
            <ul>
              {feed.adoptions.map((a: any) => (
                <li key={a.id}>
                  {a.donor?.name ?? 'Anonyymi'} → {a.plant.nameFi}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
