'use client';

/**
 * Plant detail — ported from demo-design/screens-plant.jsx.
 *
 * Captures the full visitor flow: QR scan → audio narration with synced
 * captions → mode switch (adult/kid/school) → tabbed deep-dives → adopt
 * CTAs → similar plants. Map + quiz are stubbed as follow-ups (DB doesn't
 * yet seed microLat/microLng for every plant).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import qrcode from 'qrcode-generator';
import {
  getBrowserApiUrl,
  pickInitialInterval,
  suggestedTierId as sharedSuggestedTierId,
  type BillingInterval,
  type Locale as SharedLocale,
  type TierId,
} from '@bloomoulu/constants';
import { useCart } from '../../../../lib/cart.client';

/** Secondary "Add to cart" CTA so visitors can queue multiple plants
 *  before checkout. The primary adopt path on this page routes the donor
 *  directly into the /adopt wizard (single canonical adoption flow).
 *  Toggles between "Add to cart" and "✓ In cart" with a "View cart" link
 *  so the visitor can keep browsing without losing the selection. */
function AddToCartButton({
  slug,
  tierId,
  locale,
}: {
  slug: string;
  tierId: TierId;
  locale: string;
}) {
  const { add, has, hydrated } = useCart();
  const baseStyle: React.CSSProperties = {
    marginTop: 12,
    background: 'transparent',
    border: '1px solid var(--line)',
    color: 'var(--forest-deep)',
  };
  if (!hydrated) {
    return (
      <button
        type="button"
        disabled
        className="btn btn-block"
        style={{ ...baseStyle, opacity: 0.6 }}
      >
        🌱 …
      </button>
    );
  }
  const inCart = has(slug);
  if (inCart) {
    return (
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          disabled
          className="btn btn-block"
          style={{
            flex: 1,
            background: 'var(--sage-pale)',
            color: 'var(--forest-deep)',
            border: '1px solid var(--forest-mid)',
            cursor: 'default',
          }}
        >
          ✓ {locale === 'fi' ? 'Lisätty koriin' : locale === 'sv' ? 'I korgen' : 'In your cart'}
        </button>
        <Link
          href={`/${locale}/cart`}
          className="btn btn-secondary"
          style={{ whiteSpace: 'nowrap' }}
        >
          {locale === 'fi' ? 'Koriin →' : locale === 'sv' ? 'Till korg →' : 'View cart →'}
        </Link>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => add(slug, tierId)}
      className="btn btn-block"
      style={baseStyle}
    >
      🌱{' '}
      {locale === 'fi'
        ? 'Lisää koriin (adoptoi useita)'
        : locale === 'sv'
          ? 'Lägg i korg (adoptera flera)'
          : 'Add to cart (adopt several)'}
    </button>
  );
}

// Leaflet bundles browser APIs (window) — never SSR. Loaded lazily so the
// page-chunk stays small if the user never opens the map modal.
const PlantMap = dynamic(() => import('../../../../components/PlantMap.client').then((m) => m.PlantMap), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 360,
        borderRadius: 14,
        background: 'rgba(31,58,44,0.06)',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--ink-mute)',
        fontSize: 13,
      }}
    >
      Loading map…
    </div>
  ),
});

type Mode = 'adult' | 'kid' | 'school';
type Tab = 'story' | 'data' | 'citations';
type Locale = SharedLocale;

interface Plant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  bloomSeason: string;
  bloomWindow?: string | null;
  origin: string;
  habitat: string;
  biome: string;
  gardenZone?: string | null;
  microLat?: number | string | null;
  microLng?: number | string | null;
  story: Record<string, string>;
  quickFacts?: Array<{ labelKey: string; value: string }> | unknown;
  adopterCount?: number;
  fundedCents?: number;
  targetCents?: number;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string; attribution?: string } | null;
  images?: Array<{ id: string; url: string; altEn: string; altFi: string; altSv: string; attribution?: string }>;
  taxon?: { latinName: string; family: string } | null;
  narrations?: Array<{ locale: string; audioUrl: string; durationMs: number; transcript: string }>;
  citations?: Array<{ citation: { displayTitle: string; authors?: string | null; year?: number | null; url?: string | null } }>;
}

interface SimilarPlant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  adopterCount?: number;
  primaryImage?: { url: string; altEn: string; altFi: string; altSv: string } | null;
  taxon?: { latinName: string } | null;
}

interface Tier {
  id: TierId;
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
  monthlyPriceCents?: number | null;
  sortOrder?: number;
}

interface PlantPageClientProps {
  plant: Plant;
  similarPlants: SimilarPlant[];
  tiers: Tier[];
  /** Whitelist of billing intervals the donor sees. Set in /admin →
   *  SystemSetting → adoption.intervalsEnabled. Defaults to
   *  monthly + one_time; annual hidden until enabled. */
  intervalsEnabled: readonly BillingInterval[];
  locale: Locale;
  apiUrl: string;
  signedIn?: boolean;
}

// Red-list → suggested tier mapping lives in @bloomoulu/constants/redlist;
// alias here so the local code reads naturally without exposing the
// "shared" naming everywhere.
const suggestedTierId = sharedSuggestedTierId;

function localisedName(p: { nameEn: string; nameFi: string; nameSv: string }, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

function localisedAlt(
  img: { altEn: string; altFi: string; altSv: string } | null | undefined,
  locale: string,
  fallback: string,
): string {
  if (!img) return fallback;
  if (locale === 'fi') return img.altFi || img.altEn || fallback;
  if (locale === 'sv') return img.altSv || img.altEn || fallback;
  return img.altEn || fallback;
}

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Suppress placeholder strings the legacy seed/enrich scripts wrote into
 * the DB. The plant detail page must NEVER render these — show the field
 * only when there's real data behind it.
 *
 * Known placeholders:
 *   • "(see taxon)" — legacy family fallback (enrich-legacy-garden.ts)
 *   • "Origin pending" / anything ending in "pending"/"pending." —
 *     unfilled origin/curator copy
 *   • "all" — bloom-season default that reads as a placeholder
 *   • "Curator description pending." — story fallback
 *   • Empty / whitespace-only strings
 *
 * Returns the cleaned value or null. When null, the caller should skip
 * rendering the field entirely.
 */
function cleanField(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === '(see taxon)' || lower === 'see taxon') return null;
  if (lower === 'all') return null;
  if (lower.endsWith('pending') || lower.endsWith('pending.')) return null;
  if (lower === '—' || lower === '-' || lower === 'n/a') return null;
  return trimmed;
}

/** Legacy story placeholders we never want to show — these were written
 *  by import/enrich scripts when a curator hadn't filled in the public
 *  copy yet. Match leniently (lowercase, trimmed) and across locales. */
const LEGACY_STORY_PLACEHOLDERS = [
  "imported from the garden's legacy accession database. curator to write the public story.",
  "imported from the garden's legacy accession database. curator to write the public story",
  'curator description pending.',
  'curator description pending',
];

/** Pick the localised story text for a plant, suppressing the curator
 *  placeholder so the story section can be hidden when there's no real
 *  copy. */
function plantStory(plant: { story?: Record<string, string> }, locale: string): string | null {
  const raw = plant.story?.[locale] || plant.story?.en || '';
  const cleaned = cleanField(raw);
  if (!cleaned) return null;
  if (LEGACY_STORY_PLACEHOLDERS.includes(cleaned.toLowerCase())) return null;
  return cleaned;
}

function makeQrDataUrl(text: string, size = 280): string {
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 0);
}

const SAVED_KEY = 'bloom_saved_plants';
const CAPTIONS_KEY = 'bloom_captions';

export function PlantPageClient({ plant, similarPlants, tiers, intervalsEnabled, locale, apiUrl: _apiUrl, signedIn = false }: PlantPageClientProps) {
  const t = useTranslations('Plant');
  const tc = useTranslations('Common');
  const searchParams = useSearchParams();
  // QR entry detection: kiosk-style QR codes encode a URL with ?qr=1 (and
  // optionally &kiosk=<terminal-id>) so we can tell a browse visit from a
  // physical-label scan and only show the "Scanned via QR" chip + record a
  // PlantScan event when the donor actually walked up to the plant.
  const arrivedViaQr = searchParams?.get('qr') === '1';
  const qrKioskId = searchParams?.get('kiosk') ?? null;
  // Fire-and-forget scan ping. Useffect runs once per slug change; the
  // backend's idempotency is loose by design (we want a count per visit).
  const scanPingedRef = useRef(false);
  useEffect(() => {
    if (!arrivedViaQr || scanPingedRef.current) return;
    scanPingedRef.current = true;
    const api = getBrowserApiUrl().replace(/\/$/, '');
    void fetch(`${api}/v1/plants/${encodeURIComponent(plant.slug)}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, kioskId: qrKioskId }),
      keepalive: true,
    }).catch(() => {
      /* analytics ping — never block the page on a failure */
    });
  }, [arrivedViaQr, plant.slug, locale, qrKioskId]);
  const [mode, setMode] = useState<Mode>('adult');
  const [tab, setTab] = useState<Tab>('story');
  const hasCitations = (plant.citations?.length ?? 0) > 0;
  // If the citations tab was selected but the plant has no citations
  // (e.g. they were removed since the page first loaded), fall back to
  // the story tab so the page doesn't render an empty panel.
  useEffect(() => {
    if (tab === 'citations' && !hasCitations) setTab('story');
  }, [tab, hasCitations]);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioCurrent, setAudioCurrent] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const name = localisedName(plant, locale);
  const latin = plant.taxon?.latinName ?? plant.nameEn;
  // Real data only — cleanField suppresses placeholders the seed/enrich
  // scripts wrote ("(see taxon)", "Origin pending", "all", curator-
  // pending story copy, etc.) so the UI doesn't render meaningless
  // values. Anything `null` here means "hide the field"; anything truthy
  // is real plant data ready to display.
  const story = plantStory(plant, locale);
  const cleanFamily = cleanField(plant.taxon?.family);
  const cleanOrigin = cleanField(plant.origin);
  const cleanHabitat = cleanField(plant.habitat);
  const cleanBiome = cleanField(plant.biome);
  const cleanGardenZone = cleanField(plant.gardenZone);
  const cleanBloom = cleanField(plant.bloomWindow) ?? cleanField(plant.bloomSeason);
  // Best available "where in the garden" string — the donor cares about
  // the specific zone if we have it, falling back to the country of
  // origin only when both are real data.
  const cleanLocation = cleanGardenZone ?? cleanOrigin;
  const narration = plant.narrations?.find((n) => n.locale === locale) ?? plant.narrations?.[0];
  const transcript = narration?.transcript ?? '';
  const audioProgress = audioDuration > 0 ? (audioCurrent / audioDuration) * 100 : 0;
  const altText = localisedAlt(plant.primaryImage, locale, name);

  // ── Tier + interval state, driven by the tiers prop (single source
  //    of truth = /v1/tiers, edited from /admin → Tier). The default
  //    tier is suggested from the plant's Red-List status; the donor
  //    can override before adding to cart.
  const suggestedId = suggestedTierId(plant.redListStatus);
  const sortedTiers = [...tiers].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const [selectedTierId, setSelectedTierId] = useState<Tier['id']>(suggestedId);
  // Initial-interval policy lives in @bloomoulu/constants/billing — see
  // pickInitialInterval. The plant page has no preset, so we pass null.
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(
    pickInitialInterval(null, intervalsEnabled),
  );
  const selectedTier = sortedTiers.find((t) => t.id === selectedTierId)
    ?? sortedTiers.find((t) => t.id === suggestedId)
    ?? sortedTiers[0];
  const tierName = (t: Tier) => (locale === 'fi' ? t.nameFi : locale === 'sv' ? t.nameSv : t.name);
  const intervalCents = (t: Tier | undefined): number => {
    if (!t) return 0;
    if (billingInterval === 'monthly' && t.monthlyPriceCents) return t.monthlyPriceCents;
    return t.annualPriceCents;
  };
  const intervalSuffix =
    billingInterval === 'monthly' && selectedTier?.monthlyPriceCents
      ? (locale === 'fi' ? '/kk' : locale === 'sv' ? '/mån' : '/mo')
    : billingInterval === 'one_time'
      ? ''
    : (locale === 'fi' ? '/vuosi' : locale === 'sv' ? '/år' : '/yr');

  // Initial bookmark + captions state from localStorage. If signed in,
  // also sync the localStorage shadow into the user's server-side
  // bookmark list (one-shot bulk merge) and then read the server list
  // for the current plant's authoritative state.
  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as string[];
      setSaved(list.includes(plant.slug));
      setCaptionsOn(localStorage.getItem(CAPTIONS_KEY) === '1');
      if (signedIn) {
        // Best-effort sync of any localStorage shadow into the server.
        if (list.length > 0) {
          void fetch('/api/me/saved', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slugs: list }),
          }).catch(() => undefined);
        }
        // Then check the server's authoritative state for this plant.
        void fetch('/api/me/saved', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : { items: [] }))
          .then((data: { items?: Array<{ plant?: { slug?: string } }> }) => {
            const onServer = (data.items ?? []).some((it) => it.plant?.slug === plant.slug);
            if (onServer) setSaved(true);
          })
          .catch(() => undefined);
      }
    } catch {
      /* ignore — first-visit / quota errors */
    }
  }, [plant.id, plant.slug, signedIn]);

  // Persist captions state
  useEffect(() => {
    try {
      localStorage.setItem(CAPTIONS_KEY, captionsOn ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [captionsOn]);

  // Reset audio when narration changes (locale switch)
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    try {
      a.load();
    } catch {
      /* ignore */
    }
    setAudioPlaying(false);
    setAudioCurrent(0);
    setAudioDuration(0);
  }, [narration?.audioUrl]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!shareToast) return;
    const id = setTimeout(() => setShareToast(null), 2200);
    return () => clearTimeout(id);
  }, [shareToast]);

  const toggleAudio = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play()
        .then(() => setAudioPlaying(true))
        .catch(() => setAudioPlaying(false));
    } else {
      a.pause();
      setAudioPlaying(false);
    }
  };

  const toggleSave = () => {
    // Optimistic UI: flip state immediately, persist to both localStorage
    // and (when signed in) the server. On server failure, leave the
    // localStorage shadow updated and surface the error toast — next time
    // they sign in, the sync endpoint will reconcile.
    let nextSaved = saved;
    try {
      const list = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as string[];
      const slug = plant.slug;
      const next = list.includes(slug) ? list.filter((x) => x !== slug) : [...list, slug];
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      nextSaved = next.includes(slug);
      setSaved(nextSaved);
    } catch {
      nextSaved = !saved;
      setSaved(nextSaved);
    }
    setShareToast(
      nextSaved
        ? locale === 'fi'
          ? 'Tallennettu omaan puutarhaan'
          : locale === 'sv'
            ? 'Sparat i din trädgård'
            : 'Saved to My Garden'
        : locale === 'fi'
          ? 'Poistettu omasta puutarhasta'
          : locale === 'sv'
            ? 'Borttagen från din trädgård'
            : 'Removed from My Garden',
    );
    if (signedIn) {
      void fetch(`/api/me/saved/${encodeURIComponent(plant.slug)}`, {
        method: nextSaved ? 'PUT' : 'DELETE',
      }).catch(() => undefined);
    }
  };

  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = `${latin} · BloomOulu`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        setShareToast(
          locale === 'fi' ? 'Jaettu' : locale === 'sv' ? 'Delat' : 'Shared',
        );
        return;
      } catch {
        /* fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareToast(
        locale === 'fi'
          ? 'Linkki kopioitu leikepöydälle'
          : locale === 'sv'
            ? 'Länk kopierad till urklipp'
            : 'Link copied to clipboard',
      );
    } catch {
      setShareToast(
        locale === 'fi' ? 'Ei voitu jakaa' : locale === 'sv' ? 'Kunde inte dela' : 'Could not share',
      );
    }
  };

  const qrUrl = typeof window !== 'undefined' ? window.location.href : '';
  const qrDataUrl = useMemo(() => (qrUrl ? makeQrDataUrl(qrUrl) : ''), [qrUrl]);

  const quickFacts: Array<[string, string]> = (() => {
    // The seed stores either [['origin', 'Northern fell'], ...] (tuples) or
    // [{ labelKey: 'origin', value: '...' }, ...] (objects). Handle both.
    const raw = Array.isArray(plant.quickFacts) ? plant.quickFacts as unknown[] : [];
    const labelMap: Record<string, string> = {
      origin: locale === 'fi' ? 'Alkuperä' : locale === 'sv' ? 'Ursprung' : 'Origin',
      bloom: locale === 'fi' ? 'Kukinta' : locale === 'sv' ? 'Blomning' : 'Bloom',
      habitat: locale === 'fi' ? 'Elinympäristö' : locale === 'sv' ? 'Habitat' : 'Habitat',
      biome: locale === 'fi' ? 'Kasvuvyöhyke' : locale === 'sv' ? 'Biom' : 'Biome',
      redList: locale === 'fi' ? 'Uhanalaisuus' : locale === 'sv' ? 'Hotstatus' : 'Red List',
      family: locale === 'fi' ? 'Heimo' : locale === 'sv' ? 'Familj' : 'Family',
    };
    const tr = (key: string) => labelMap[key] ?? key;
    if (raw.length > 0) {
      return raw
        .slice(0, 4)
        .map((q): [string, string | null] => {
          if (Array.isArray(q) && q.length >= 2) return [tr(String(q[0])), cleanField(String(q[1]))];
          if (q && typeof q === 'object' && 'labelKey' in q && 'value' in q) {
            return [tr(String((q as { labelKey: unknown }).labelKey)), cleanField(String((q as { value: unknown }).value))];
          }
          return ['', null];
        })
        .filter((entry): entry is [string, string] => Boolean(entry[0]) && entry[1] !== null);
    }
    // Auto-fallback when the seed didn't supply quickFacts: pull from
    // the plant's own columns, but only include fields with real data
    // so we never render "Origin pending" / "(see taxon)" placeholders.
    return ([
      [labelMap.origin!, cleanOrigin],
      [labelMap.habitat!, cleanHabitat],
      [labelMap.biome!, cleanBiome],
      [labelMap.redList!, cleanField(plant.redListStatus)],
    ] as Array<[string, string | null]>).filter((entry): entry is [string, string] => entry[1] !== null);
  })();

  return (
    <article className="fade-in">
      {/* ── STICKY BACK BAR ─────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--paper)',
          borderBottom: '1px solid var(--line)',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }}
      >
        <div
          className="container"
          style={{ padding: '14px 32px', display: 'flex', alignItems: 'center', gap: 16 }}
        >
          <Link
            href={`/${locale}/plants`}
            className="btn btn-ghost small"
            aria-label={locale === 'fi' ? 'Takaisin kasvilistaan' : locale === 'sv' ? 'Tillbaka till växtlistan' : 'Back to plants'}
          >
            ← {locale === 'fi' ? 'Kasvit' : locale === 'sv' ? 'Växter' : 'Plants'}
          </Link>
          {arrivedViaQr && (
            <span
              className="tiny"
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--sage-pale)',
                border: '1px solid var(--forest-mid)',
                color: 'var(--forest-deep)',
              }}
            >
              📷{' '}
              {locale === 'fi' ? 'Skannattu QR-koodilla' : locale === 'sv' ? 'Skannad via QR' : 'Scanned via QR'}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowQR(true)}
              aria-label={t('shareQr')}
              title={t('shareQr')}
            >
              <span aria-hidden="true">▥</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleSave}
              aria-label={
                saved
                  ? locale === 'fi'
                    ? 'Poista kirjanmerkki'
                    : locale === 'sv'
                      ? 'Ta bort bokmärke'
                      : 'Remove bookmark'
                  : locale === 'fi'
                    ? 'Tallenna omaan puutarhaan'
                    : locale === 'sv'
                      ? 'Spara i din trädgård'
                      : 'Save to My Garden'
              }
              aria-pressed={saved}
              style={{
                background: saved ? 'var(--forest-deep)' : 'var(--paper)',
                color: saved ? 'var(--sage-bright)' : 'var(--ink-soft)',
                borderColor: saved ? 'var(--forest-deep)' : 'var(--line)',
              }}
            >
              <span aria-hidden="true">{saved ? '★' : '☆'}</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={handleShare}
              aria-label={locale === 'fi' ? 'Jaa tämä kasvi' : locale === 'sv' ? 'Dela denna växt' : 'Share this plant'}
            >
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      </div>

      <div
        className="container"
        style={{
          paddingTop: 32,
          paddingBottom: 64,
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gap: 48,
        }}
      >
        {/* ── LEFT COLUMN ─────────────────────────────────────────── */}
        <div>
          {/* Hero card */}
          <div
            className="card"
            style={{
              background: 'var(--sage-pale)',
              padding: 0,
              overflow: 'hidden',
              borderRadius: 24,
              position: 'relative',
              aspectRatio: '16/10',
            }}
          >
            {plant.primaryImage?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={plant.primaryImage.url}
                alt={altText}
                style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
                loading="eager"
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 96,
                }}
                aria-hidden="true"
              >
                🌿
              </div>
            )}
            <div
              style={{
                position: 'absolute',
                top: 20,
                left: 20,
                right: 20,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span className={`badge badge-${plant.redListStatus.toLowerCase()}`}>
                {plant.redListStatus}
              </span>
              {cleanFamily && (
                <span
                  className="badge"
                  style={{ background: 'rgba(255,255,255,0.85)', color: 'var(--ink-2)' }}
                >
                  {cleanFamily}
                </span>
              )}
            </div>

            {/* Audio overlay (only when narration present) */}
            {narration && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 20,
                  right: 20,
                  display: 'flex',
                  alignItems: 'end',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    background: 'rgba(255,255,255,0.92)',
                    padding: '12px 16px',
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <audio
                    ref={audioRef}
                    key={narration.audioUrl}
                    src={narration.audioUrl}
                    preload="metadata"
                    onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
                    onTimeUpdate={(e) => setAudioCurrent(e.currentTarget.currentTime)}
                    onEnded={() => {
                      setAudioPlaying(false);
                      setAudioCurrent(0);
                    }}
                  />
                  <button
                    type="button"
                    onClick={toggleAudio}
                    className="btn btn-primary"
                    style={{ width: 44, height: 44, padding: 0, borderRadius: '50%' }}
                    aria-label={audioPlaying ? (locale === 'fi' ? 'Tauko' : 'Pause') : (locale === 'fi' ? 'Toista' : 'Play')}
                  >
                    {audioPlaying ? '❚❚' : '▶'}
                  </button>
                  <div style={{ minWidth: 180 }}>
                    <div className="tiny" style={{ color: 'var(--ink-2)' }}>
                      {t('audio')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <div
                        style={{
                          flex: 1,
                          height: 4,
                          background: 'rgba(31,58,44,0.12)',
                          borderRadius: 999,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${audioProgress}%`,
                            height: '100%',
                            background: 'var(--forest)',
                          }}
                        />
                      </div>
                      <span
                        className="mono small"
                        style={{ color: 'var(--ink-2)', fontFamily: 'var(--f-mono)' }}
                      >
                        {fmtTime(audioCurrent)} / {fmtTime(audioDuration)}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setCaptionsOn((c) => !c)}
                  aria-pressed={captionsOn}
                  aria-label={
                    captionsOn
                      ? locale === 'fi'
                        ? 'Piilota tekstitykset'
                        : locale === 'sv'
                          ? 'Dölj undertexter'
                          : 'Hide captions'
                      : locale === 'fi'
                        ? 'Näytä tekstitykset'
                        : locale === 'sv'
                          ? 'Visa undertexter'
                          : 'Show captions'
                  }
                  style={{
                    background: captionsOn ? 'var(--forest)' : 'rgba(255,255,255,0.92)',
                    color: captionsOn ? 'var(--cream)' : 'var(--ink-2)',
                    borderColor: captionsOn ? 'var(--forest)' : 'var(--line)',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  CC
                </button>
              </div>
            )}
          </div>

          {/* Captions panel */}
          {captionsOn && transcript && (
            <div
              role="region"
              aria-label={locale === 'fi' ? 'Äänen tekstitys' : locale === 'sv' ? 'Ljudtranskription' : 'Audio transcript'}
              style={{
                marginTop: 18,
                padding: '16px 20px',
                background: 'var(--forest-deep)',
                color: 'var(--cream)',
                borderRadius: 14,
                fontSize: 15,
                lineHeight: 1.6,
              }}
            >
              <div
                className="tiny"
                style={{ color: 'var(--sage-bright)', marginBottom: 8, letterSpacing: '0.12em' }}
              >
                {audioPlaying
                  ? `▶ ${locale === 'fi' ? 'Toistetaan nyt' : locale === 'sv' ? 'Spelar nu' : 'Now playing'}`
                  : locale === 'fi'
                    ? 'Litterointi'
                    : locale === 'sv'
                      ? 'Transkription'
                      : 'Transcript'}{' '}
                · {locale.toUpperCase()}
              </div>
              <p lang={locale} style={{ margin: 0, color: 'rgba(250,247,238,0.92)' }}>
                {transcript}
              </p>
            </div>
          )}

          {/* Title block */}
          <div
            style={{
              marginTop: 32,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 32,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
                {plant.nameFi} · {plant.nameSv}
              </div>
              <h1
                className="serif"
                style={{
                  fontSize: 'clamp(40px, 5.5vw, 64px)',
                  fontStyle: 'italic',
                  marginTop: 8,
                  lineHeight: 1,
                }}
              >
                {latin}
              </h1>
              <div className="muted" style={{ marginTop: 12, fontSize: 16 }}>
                {name}{cleanFamily ? ` · ${cleanFamily}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
              {/* The pill only renders as a clickable map button when we
                  actually have a location to plot — either the garden zone
                  the plant is staked in OR microLat/microLng coordinates.
                  When all we have is the descriptive "Native to …" origin
                  text, render it as a plain span so the curator doesn't
                  promise a map and then open an unrelated dialog. */}
              {cleanLocation && (cleanGardenZone || (plant.microLat != null && plant.microLng != null)) ? (
                <button
                  type="button"
                  className="pill"
                  onClick={() => setShowMap(true)}
                  style={{ cursor: 'pointer', border: 0 }}
                  aria-label={t('showOnMap')}
                >
                  <span aria-hidden="true">📍</span> {cleanLocation}
                </button>
              ) : cleanOrigin ? (
                <span
                  className="pill"
                  title={
                    locale === 'fi'
                      ? 'Luonnonalkuperä — kuvaileva teksti, ei karttalinkki.'
                      : locale === 'sv'
                        ? 'Naturligt ursprung — beskrivande text, ingen karta.'
                        : 'Native origin — descriptive text; no map link.'
                  }
                  style={{ cursor: 'default' }}
                >
                  <span aria-hidden="true">🌍</span> {cleanOrigin}
                </span>
              ) : null}
              {cleanBloom && (
                <span className="pill">
                  <span aria-hidden="true">🌸</span> {cleanBloom}
                </span>
              )}
            </div>
          </div>

          {/* Mode-specific intro */}
          {mode === 'kid' ? (
            <KidIntro plant={plant} name={name} locale={locale} />
          ) : mode === 'school' ? (
            <SchoolIntro plant={plant} locale={locale} onStartQuiz={() => setShowQuiz(true)} />
          ) : story ? (
            <div
              style={{
                marginTop: 32,
                padding: '24px 28px',
                background: 'var(--paper)',
                borderRadius: 18,
                borderLeft: '3px solid var(--forest)',
              }}
            >
              <span
                aria-hidden="true"
                style={{ fontSize: 20, color: 'var(--forest)' }}
              >
                ❝
              </span>
              <p
                className="serif"
                style={{ fontSize: 22, lineHeight: 1.4, marginTop: 8, color: 'var(--ink)' }}
              >
                {story.split(/\n\n/)[0]}
              </p>
            </div>
          ) : null}

          {/* Quick facts strip */}
          <div
            data-grid-mobile="2"
            style={{
              marginTop: 32,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 0,
              borderTop: '1px solid var(--line)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            {quickFacts.map(([k, v], i) => (
              <div
                key={`${k}-${i}`}
                style={{
                  padding: '20px 24px 20px 0',
                  borderRight: i < quickFacts.length - 1 ? '1px solid var(--line)' : 'none',
                  paddingLeft: i > 0 ? 24 : 0,
                }}
              >
                <div className="tiny">{k}</div>
                <div className="serif" style={{ fontSize: 20, marginTop: 6 }}>
                  {v}
                </div>
              </div>
            ))}
          </div>

          {/* Tabs — only render tabs that have content to show.
              "Cited papers" is hidden entirely when the plant has no
              citations rather than rendering an empty-state apology
              that adds noise to the page. */}
          <div
            role="tablist"
            aria-label={locale === 'fi' ? 'Lisätietoja' : locale === 'sv' ? 'Mer information' : 'More info'}
            style={{ marginTop: 40, display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' }}
          >
            {(
              [
                ['story', locale === 'fi' ? 'Tarina' : locale === 'sv' ? 'Berättelse' : 'The story'],
                ['data', locale === 'fi' ? 'Aksessio-data' : locale === 'sv' ? 'Accessionsdata' : 'Accession data'],
                ...(plant.citations && plant.citations.length > 0
                  ? ([['citations', locale === 'fi' ? 'Lähteet' : locale === 'sv' ? 'Källor' : 'Cited papers']] as const)
                  : []),
              ] as ReadonlyArray<readonly [Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                style={{
                  padding: '12px 18px',
                  color: tab === id ? 'var(--ink)' : 'var(--ink-mute)',
                  fontWeight: tab === id ? 600 : 400,
                  fontSize: 14,
                  borderBottom: tab === id ? '2px solid var(--forest)' : '2px solid transparent',
                  marginBottom: -1,
                  background: 'transparent',
                  border: 'none',
                  borderBottomWidth: 2,
                  borderBottomStyle: 'solid',
                  borderBottomColor: tab === id ? 'var(--forest)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ paddingTop: 28 }} role="tabpanel">
            {tab === 'story' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {story ? (
                  <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--ink-soft)', whiteSpace: 'pre-line' }}>
                    {story}
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
                    {locale === 'fi'
                      ? 'Kuraattori ei ole vielä kirjoittanut tämän kasvin tarinaa — kysy puutarhalta lisää alta.'
                      : locale === 'sv'
                        ? 'Kuratorn har inte skrivit en berättelse för den här växten än — fråga trädgården nedan.'
                        : "The curator hasn't written a story for this plant yet — ask the Garden below."}
                  </p>
                )}
                <Link
                  href={`/${locale}/ask?plant=${plant.slug}`}
                  className="btn btn-secondary"
                  style={{ alignSelf: 'flex-start', marginTop: 12 }}
                >
                  🤖{' '}
                  {locale === 'fi'
                    ? 'Kysy puutarhalta tästä kasvista'
                    : locale === 'sv'
                      ? 'Fråga trädgården om denna växt'
                      : 'Ask the Garden about this plant'}
                </Link>
              </div>
            )}
            {tab === 'data' && (
              <div className="card card-pad" style={{ background: 'var(--paper)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {(
                      [
                        [locale === 'fi' ? 'Alkuperä' : locale === 'sv' ? 'Ursprung' : 'Origin', cleanOrigin],
                        [locale === 'fi' ? 'Elinympäristö' : locale === 'sv' ? 'Habitat' : 'Habitat', cleanHabitat],
                        [locale === 'fi' ? 'Kasvuvyöhyke' : locale === 'sv' ? 'Biom' : 'Biome', cleanBiome],
                        [locale === 'fi' ? 'Kukinta-aika' : locale === 'sv' ? 'Blomningstid' : 'Blooms', cleanBloom],
                        [locale === 'fi' ? 'Uhanalaisuusluokka' : locale === 'sv' ? 'Rödlistningsstatus' : 'Red-List status', cleanField(plant.redListStatus)],
                        [locale === 'fi' ? 'Heimo' : locale === 'sv' ? 'Familj' : 'Family', cleanFamily],
                        [locale === 'fi' ? 'Tieteellinen nimi' : locale === 'sv' ? 'Vetenskapligt namn' : 'Latin name', latin],
                        [locale === 'fi' ? 'Puutarha-alue' : locale === 'sv' ? 'Trädgårdsområde' : 'Garden zone', cleanGardenZone],
                      ] as ReadonlyArray<readonly [string, string | null]>
                    ).filter((row): row is [string, string] => row[1] !== null && row[1] !== '').map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td
                          style={{
                            padding: '12px 0',
                            color: 'var(--ink-mute)',
                            fontSize: 13,
                            width: '40%',
                          }}
                        >
                          {k}
                        </td>
                        <td style={{ padding: '12px 0', fontSize: 14 }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'citations' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plant.citations && plant.citations.length > 0 ? (
                  plant.citations.slice(0, 8).map((c, i) => (
                    <div
                      key={i}
                      className="card"
                      style={{ padding: 18, display: 'flex', gap: 16, alignItems: 'flex-start' }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 44,
                          background: 'var(--forest)',
                          color: 'var(--sage-bright)',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontFamily: 'var(--f-mono)',
                          flexShrink: 0,
                        }}
                      >
                        {c.citation.year ?? '—'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="tiny">{c.citation.authors ?? ''}</div>
                        <div className="serif" style={{ fontSize: 17, marginTop: 4 }}>
                          {c.citation.url ? (
                            <a
                              href={c.citation.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'inherit', textDecoration: 'none' }}
                            >
                              {c.citation.displayTitle}
                            </a>
                          ) : (
                            c.citation.displayTitle
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    {locale === 'fi'
                      ? 'Ei lähteitä tällä kasvilla vielä.'
                      : locale === 'sv'
                        ? 'Inga källor för denna växt ännu.'
                        : 'No citations recorded for this plant yet.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN: STICKY CTA + SIMILAR PLANTS ─────────────── */}
        <div style={{ position: 'sticky', top: 100, alignSelf: 'flex-start' }}>
          <div className="card" style={{ overflow: 'hidden', borderRadius: 24 }}>
            {/* Mode toggle */}
            <div
              role="group"
              aria-label={locale === 'fi' ? 'Tila' : locale === 'sv' ? 'Läge' : 'Mode'}
              style={{
                display: 'flex',
                padding: 6,
                background: 'var(--paper)',
                margin: 16,
                borderRadius: 999,
              }}
            >
              {(
                [
                  ['adult', t('modeAdult')],
                  ['kid', t('modeKid')],
                  ['school', t('modeSchool')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  aria-pressed={mode === id}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    borderRadius: 999,
                    fontSize: 13,
                    background: mode === id ? 'var(--forest)' : 'transparent',
                    color: mode === id ? 'var(--cream)' : 'var(--ink-2)',
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ padding: '0 24px 24px' }}>
              <div className="tiny">
                {locale === 'fi' ? 'Adoptiotila' : locale === 'sv' ? 'Adoptionsstatus' : 'Adoption status'}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginTop: 8,
                  gap: 12,
                }}
              >
                <div>
                  <div className="serif" style={{ fontSize: 36, lineHeight: 1 }}>
                    {plant.adopterCount ?? 0}
                  </div>
                  <div className="tiny" style={{ marginTop: 4 }}>
                    {locale === 'fi' ? 'Adoptoijia' : locale === 'sv' ? 'Adoptanter' : 'Adopters'}
                  </div>
                </div>
                <div className="small muted" style={{ textAlign: 'right' }}>
                  {plant.targetCents && plant.targetCents > 0
                    ? `${Math.min(100, Math.round(((plant.fundedCents ?? 0) / plant.targetCents) * 100))}% ${
                        locale === 'fi' ? 'rahoitettu' : locale === 'sv' ? 'finansierat' : 'funded'
                      }`
                    : ''}
                </div>
              </div>
              {plant.targetCents && plant.targetCents > 0 ? (
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'rgba(31,58,44,0.08)',
                    overflow: 'hidden',
                    marginTop: 8,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, ((plant.fundedCents ?? 0) / plant.targetCents) * 100)}%`,
                      height: '100%',
                      background: 'var(--forest)',
                    }}
                  />
                </div>
              ) : null}

              <div
                style={{
                  marginTop: 24,
                  padding: 16,
                  background: 'var(--paper)',
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                }}
              >
                <div className="tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)' }}>
                  {locale === 'fi' ? 'Adoptiotaso' : locale === 'sv' ? 'Adoptionsnivå' : 'Adoption tier'}
                </div>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div className="serif" style={{ fontSize: 40, lineHeight: 1, color: 'var(--forest-deep)' }}>
                    €{(intervalCents(selectedTier) / 100).toFixed(0)}
                    <span style={{ fontSize: 14, color: 'var(--ink-mute)' }}>{intervalSuffix}</span>
                  </div>
                  {selectedTier && (
                    <div className="small muted">{tierName(selectedTier)}</div>
                  )}
                </div>

                {/* Tier picker — every row from /v1/tiers shows up; the
                    suggested tier is highlighted by Red-List status. */}
                <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
                  {sortedTiers.map((t) => {
                    const active = t.id === selectedTierId;
                    const cents = intervalCents(t);
                    const isSuggested = t.id === suggestedId;
                    return (
                      <button
                        type="button"
                        key={t.id}
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelectedTierId(t.id)}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: active ? '2px solid var(--forest)' : '1px solid var(--line)',
                          background: active ? 'var(--sage-pale)' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          fontSize: 14,
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: active ? 600 : 500, color: 'var(--forest-deep)' }}>
                            {tierName(t)}
                          </span>
                          {isSuggested && !active && (
                            <span
                              className="tiny"
                              style={{
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: 'var(--sage-pale)',
                                color: 'var(--forest)',
                                border: '1px solid var(--forest-mid)',
                              }}
                            >
                              {locale === 'fi' ? 'Suositus' : locale === 'sv' ? 'Förslag' : 'Suggested'}
                            </span>
                          )}
                        </span>
                        <span className="small" style={{ color: 'var(--ink-mute)', fontFamily: 'ui-monospace, monospace' }}>
                          €{(cents / 100).toFixed(0)}{intervalSuffix}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Billing-interval pills (one-time / annual / monthly).
                    Display order is fixed; admin's intervalsEnabled list
                    controls which appear. Matches the wizard step 1
                    layout exactly. */}
                <div role="radiogroup" style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  {(['one_time', 'annual', 'monthly'] as BillingInterval[])
                    .filter((iv) => (intervalsEnabled as BillingInterval[]).includes(iv))
                    .map((iv) => {
                    const active = billingInterval === iv;
                    const label =
                      iv === 'monthly' ? (locale === 'fi' ? 'Kuukausi' : locale === 'sv' ? 'Månad' : 'Monthly')
                      : iv === 'annual' ? (locale === 'fi' ? 'Vuosi' : locale === 'sv' ? 'År' : 'Annual')
                      : (locale === 'fi' ? 'Kerran' : locale === 'sv' ? 'Engång' : 'One-time');
                    return (
                      <button
                        type="button"
                        key={iv}
                        role="radio"
                        aria-checked={active}
                        onClick={() => setBillingInterval(iv)}
                        style={{
                          flex: 1,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: active ? '2px solid var(--forest)' : '1px solid var(--line)',
                          background: active ? 'var(--sage-pale)' : 'transparent',
                          color: active ? 'var(--forest-deep)' : 'var(--ink)',
                          fontSize: 13,
                          fontWeight: active ? 600 : 400,
                          cursor: 'pointer',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Single canonical adoption path: every CTA here routes
                  into the /adopt wizard with the donor's tier + interval
                  + plant preselected. Intent (self / gift / memorial /
                  class) is chosen in the wizard's step 3 — the buttons
                  below are just shortcuts that pre-fill it. The cart is
                  kept as a separate "queue several plants" workflow. */}
              <Link
                href={`/${locale}/adopt?plant=${plant.slug}&tier=${selectedTierId}&interval=${billingInterval}`}
                className="btn btn-primary btn-block btn-lg"
                style={{ marginTop: 16 }}
              >
                🌱{' '}
                {locale === 'fi'
                  ? 'Adoptoi tämä kasvi →'
                  : locale === 'sv'
                    ? 'Adoptera denna växt →'
                    : 'Adopt this plant →'}
              </Link>
              <div className="tiny muted" style={{ marginTop: 14, textAlign: 'center' }}>
                {locale === 'fi'
                  ? 'Tai adoptoi:'
                  : locale === 'sv'
                    ? 'Eller adoptera som:'
                    : 'Or adopt as:'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Link
                  href={`/${locale}/adopt?plant=${plant.slug}&tier=${selectedTierId}&interval=${billingInterval}&intent=gift`}
                  className="btn btn-ghost small"
                  style={{ flex: 1, border: '1px solid var(--line)', textAlign: 'center' }}
                >
                  🎁{' '}
                  {locale === 'fi' ? 'Lahja' : locale === 'sv' ? 'Gåva' : 'Gift'}
                </Link>
                <Link
                  href={`/${locale}/adopt?plant=${plant.slug}&tier=${selectedTierId}&interval=${billingInterval}&intent=memorial`}
                  className="btn btn-ghost small"
                  style={{ flex: 1, border: '1px solid var(--line)', textAlign: 'center' }}
                >
                  💗{' '}
                  {locale === 'fi' ? 'Muistolahja' : locale === 'sv' ? 'Minnesgåva' : 'Memorial'}
                </Link>
                <Link
                  href={`/${locale}/adopt?plant=${plant.slug}&tier=${selectedTierId}&interval=${billingInterval}&intent=class`}
                  className="btn btn-ghost small"
                  style={{ flex: 1, border: '1px solid var(--line)', textAlign: 'center' }}
                >
                  🎓{' '}
                  {locale === 'fi' ? 'Luokka' : locale === 'sv' ? 'Klass' : 'Class'}
                </Link>
              </div>
              <AddToCartButton slug={plant.slug} tierId={selectedTierId} locale={locale} />
            </div>

            <div
              style={{
                borderTop: '1px solid var(--line)',
                padding: 20,
                background: 'rgba(31,58,44,0.03)',
              }}
            >
              <div className="tiny">
                {locale === 'fi'
                  ? 'Mihin rahasi käytetään'
                  : locale === 'sv'
                    ? 'Vart dina pengar går'
                    : 'Where your money goes'}
              </div>
              <p className="small" style={{ marginTop: 8, color: 'var(--ink-2)' }}>
                {locale === 'fi'
                  ? 'Jokaisesta 100 €:sta: 62 € ex-situ-työ, 18 € Luomus-siemenpankki, 12 € puutarhan toiminta, 8 € alusta.'
                  : locale === 'sv'
                    ? 'Av varje 100 €: 62 € ex-situ-arbete, 18 € till Luomus-fröbank, 12 € trädgårdsdrift, 8 € plattform.'
                    : 'Of every €100: €62 direct ex-situ work, €18 to Luomus seed bank, €12 garden operations, €8 platform.'}
              </p>
            </div>
          </div>

          {/* Similar plants */}
          {similarPlants.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="tiny">
                {locale === 'fi' ? 'Samankaltaisia kasveja' : locale === 'sv' ? 'Liknande växter' : 'Similar plants'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {similarPlants.slice(0, 3).map((p) => (
                  <Link
                    key={p.id}
                    href={`/${locale}/plants/${p.slug}`}
                    className="card"
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: 12,
                      alignItems: 'center',
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        background: 'var(--sage-pale)',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      {p.primaryImage?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.primaryImage.url}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          loading="lazy"
                        />
                      ) : (
                        <span aria-hidden="true" style={{ fontSize: 22 }}>🌿</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="serif" style={{ fontSize: 16, fontStyle: 'italic' }}>
                        {p.taxon?.latinName ?? p.nameEn}
                      </div>
                      <div className="small muted">
                        {p.redListStatus} · {p.adopterCount ?? 0}{' '}
                        {locale === 'fi' ? 'adoptoijaa' : locale === 'sv' ? 'adoptanter' : 'adopters'}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* QR MODAL */}
      {showQR && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('shareQr')}
          onClick={() => setShowQR(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(5,10,7,0.78)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--cream)',
              color: 'var(--ink)',
              borderRadius: 18,
              padding: 24,
              maxWidth: 380,
              width: '100%',
              boxShadow: 'var(--shadow-deep)',
              position: 'relative',
              textAlign: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => setShowQR(false)}
              className="icon-btn"
              aria-label={tc('close')}
              style={{ position: 'absolute', top: 14, right: 14 }}
            >
              ✕
            </button>
            <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
              {t('shareQr')}
            </div>
            <h3 className="serif" style={{ fontSize: 22, marginTop: 8, fontStyle: 'italic' }}>
              {latin}
            </h3>
            <div className="small muted" style={{ marginTop: 4 }}>
              {name}
            </div>
            {qrDataUrl && (
              <div
                style={{
                  marginTop: 18,
                  padding: 16,
                  background: 'var(--paper)',
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                  display: 'inline-block',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt={`QR · ${latin}`} width={220} height={220} />
              </div>
            )}
            <p className="small muted" style={{ marginTop: 14, lineHeight: 1.5 }}>
              {locale === 'fi'
                ? 'Tulosta tämä kasvin fyysiseen kylttiin. Kävijät skannaavat sen puhelimen kameralla avatakseen tämän sivun.'
                : locale === 'sv'
                  ? 'Skriv ut detta på växtens fysiska skylt. Besökare skannar det med telefonens kamera.'
                  : "Print this on the plant's physical label. Visitors scan it with their phone camera to open this exact page."}
            </p>
            <div
              style={{
                marginTop: 16,
                padding: 10,
                background: 'rgba(31,58,44,0.06)',
                borderRadius: 8,
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                color: 'var(--ink-soft)',
                wordBreak: 'break-all',
              }}
            >
              {qrUrl}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 14,
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(qrUrl);
                    setShareToast(
                      locale === 'fi'
                        ? 'Linkki kopioitu leikepöydälle'
                        : locale === 'sv'
                          ? 'Länk kopierad'
                          : 'Link copied to clipboard',
                    );
                  } catch {
                    /* ignore */
                  }
                }}
              >
                {locale === 'fi' ? 'Kopioi linkki' : locale === 'sv' ? 'Kopiera länk' : 'Copy link'}
              </button>
              <a
                href={`/${locale}/plants/${plant.slug}/print${arrivedViaQr && qrKioskId ? `?kiosk=${encodeURIComponent(qrKioskId)}` : ''}`}
                target="_blank"
                rel="noopener"
                className="btn btn-secondary small"
              >
                {tc('print')} →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* QUIZ MODAL (school mode) */}
      {showQuiz && (
        <QuizModal slug={plant.slug} locale={locale} onClose={() => setShowQuiz(false)} />
      )}

      {/* MAP MODAL */}
      {showMap && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('showOnMap')}
          onClick={() => setShowMap(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(5,10,7,0.78)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--cream)',
              color: 'var(--ink)',
              borderRadius: 18,
              padding: 22,
              maxWidth: 760,
              width: '100%',
              boxShadow: 'var(--shadow-deep)',
              position: 'relative',
            }}
          >
            <button
              type="button"
              onClick={() => setShowMap(false)}
              className="icon-btn"
              aria-label={tc('close')}
              style={{ position: 'absolute', top: 14, right: 14 }}
            >
              ✕
            </button>
            <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
              {locale === 'fi' ? 'Puutarhan kartta' : locale === 'sv' ? 'Trädgårdens karta' : 'Garden map'}
            </div>
            <h3 className="serif" style={{ fontSize: 24, marginTop: 8, fontStyle: 'italic' }}>
              {latin}
            </h3>
            {cleanLocation && (
              <div className="small muted" style={{ marginTop: 4 }}>
                {cleanLocation}
              </div>
            )}
            <div style={{ marginTop: 14 }}>
              <PlantMap
                lat={plant.microLat == null ? null : Number(plant.microLat)}
                lng={plant.microLng == null ? null : Number(plant.microLng)}
                redListStatus={plant.redListStatus}
                zone={plant.gardenZone}
                label={latin}
                height={360}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              {plant.microLat != null && plant.microLng != null && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${plant.microLat}&mlon=${plant.microLng}&zoom=18`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary small"
                >
                  🗺️{' '}
                  {locale === 'fi'
                    ? 'Avaa OpenStreetMapissa'
                    : locale === 'sv'
                      ? 'Öppna i OpenStreetMap'
                      : 'Open in OpenStreetMap'}
                </a>
              )}
              <button
                type="button"
                className="btn btn-secondary small"
                onClick={() => setShowMap(false)}
              >
                {tc('close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {shareToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--forest-deep)',
            color: 'var(--cream)',
            padding: '12px 20px',
            borderRadius: 999,
            fontSize: 14,
            boxShadow: 'var(--shadow-deep)',
            zIndex: 250,
          }}
        >
          {shareToast}
        </div>
      )}
    </article>
  );
}

function KidIntro({
  plant,
  name,
  locale,
}: {
  plant: Plant;
  name: string;
  locale: Locale;
}) {
  const latin = plant.taxon?.latinName ?? plant.nameEn;
  const location = cleanField(plant.gardenZone) ?? cleanField(plant.origin);
  const bloom = cleanField(plant.bloomWindow) ?? cleanField(plant.bloomSeason);
  const cleanRedList = cleanField(plant.redListStatus);
  const cards: Array<[string, string, string]> = [];
  const cleanedOrigin = cleanField(plant.origin);
  if (cleanedOrigin) {
    cards.push(['🌍', locale === 'fi' ? 'Mistä olen kotoisin' : locale === 'sv' ? 'Var jag kommer från' : "Where I'm from", cleanedOrigin]);
  }
  if (bloom) {
    cards.push(['🌸', locale === 'fi' ? 'Milloin kukin' : locale === 'sv' ? 'När jag blommar' : 'When I bloom', bloom]);
  }
  if (cleanRedList) {
    cards.push(['🛡️', locale === 'fi' ? 'Miten voin' : locale === 'sv' ? 'Hur jag mår' : "How I'm doing", cleanRedList]);
  }
  return (
    <div
      style={{
        marginTop: 24,
        padding: '26px 28px',
        background: 'linear-gradient(135deg, var(--sage-pale) 0%, var(--paper) 100%)',
        borderRadius: 22,
        border: '2px solid var(--forest)',
      }}
    >
      <div className="tiny" style={{ color: 'var(--forest)', marginBottom: 8 }}>
        🌱{' '}
        {locale === 'fi' ? 'Lapsen tila' : locale === 'sv' ? 'Barnläge' : 'Kid mode'}
      </div>
      <h2 className="serif" style={{ fontSize: 30, lineHeight: 1.1, color: 'var(--ink)', margin: 0 }}>
        {locale === 'fi'
          ? `Hei! Olen ${name}.`
          : locale === 'sv'
            ? `Hej! Jag är ${name}.`
            : `Hi! I'm ${name}.`}
      </h2>
      <p style={{ marginTop: 12, fontSize: 17, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
        {(() => {
          const base = locale === 'fi'
            ? `Tieteellinen nimeni on ${latin}.`
            : locale === 'sv'
              ? `Mitt vetenskapliga namn är ${latin}.`
              : `My scientific name is ${latin}.`;
          if (!location) return base;
          const findMe = locale === 'fi'
            ? ` Etsi minut puutarhasta — olen ${location}-alueella.`
            : locale === 'sv'
              ? ` Hitta mig i trädgården — jag är i ${location}.`
              : ` Find me in the garden — I'm in ${location}.`;
          return base + findMe;
        })()}
      </p>
      {cards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 12, marginTop: 16 }}>
          {cards.map(([emoji, label, value]) => (
            <div
              key={label}
              style={{
                padding: 14,
                background: 'var(--paper)',
                borderRadius: 12,
                border: '1px solid var(--line)',
              }}
            >
              <div style={{ fontSize: 24 }} aria-hidden="true">{emoji}</div>
              <div className="tiny" style={{ marginTop: 6 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SchoolIntro({
  plant,
  locale,
  onStartQuiz,
}: {
  plant: Plant;
  locale: Locale;
  onStartQuiz: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 24,
        padding: '26px 28px',
        background: 'var(--sage-pale)',
        borderRadius: 22,
        border: '2px solid var(--forest)',
      }}
    >
      <div className="tiny" style={{ color: 'var(--forest)', marginBottom: 8 }}>
        🎓{' '}
        {locale === 'fi' ? 'Koulutila' : locale === 'sv' ? 'Skolläge' : 'School mode'}
      </div>
      <h2 className="serif" style={{ fontSize: 28, lineHeight: 1.15, color: 'var(--ink)', margin: 0 }}>
        {locale === 'fi' ? 'Mitä opit?' : locale === 'sv' ? 'Vad du lär dig' : 'What will you learn?'}
      </h2>
      {(() => {
        // Only list facts the DB actually has — placeholders are silently
        // dropped so the school-mode summary never reads "Habitat: pending".
        const rows: Array<[string, string]> = [];
        const r = cleanField(plant.redListStatus);
        if (r) rows.push([locale === 'fi' ? 'Lajin uhanalaisuusluokka' : locale === 'sv' ? 'Artens hotstatus' : 'Red-List status', r]);
        const h = cleanField(plant.habitat);
        if (h) rows.push([locale === 'fi' ? 'Elinympäristö' : 'Habitat', h]);
        const b = cleanField(plant.biome);
        if (b) rows.push([locale === 'fi' ? 'Kasvuvyöhyke' : locale === 'sv' ? 'Biom' : 'Biome', b]);
        const bl = cleanField(plant.bloomWindow) ?? cleanField(plant.bloomSeason);
        if (bl) rows.push([locale === 'fi' ? 'Kukinta-aika' : locale === 'sv' ? 'Blomningstid' : 'Bloom', bl]);
        if (rows.length === 0) {
          return (
            <p className="muted" style={{ marginTop: 14, fontSize: 14 }}>
              {locale === 'fi'
                ? 'Tämän kasvin tietoja täydennetään parhaillaan.'
                : locale === 'sv'
                  ? 'Information om denna växt fylls fortfarande på.'
                  : "We're still filling in details for this plant."}
            </p>
          );
        }
        return (
          <ul
            style={{
              marginTop: 14,
              paddingLeft: 20,
              lineHeight: 1.7,
              color: 'var(--ink-soft)',
              fontSize: 15,
            }}
          >
            {rows.map(([label, value]) => (
              <li key={label}>{label}: {value}</li>
            ))}
          </ul>
        );
      })()}
      <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={onStartQuiz}>
          🎯{' '}
          {locale === 'fi' ? 'Aloita visa' : locale === 'sv' ? 'Starta quiz' : 'Start quiz'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
          🖨️{' '}
          {locale === 'fi'
            ? 'Tulosta tehtäväarkki'
            : locale === 'sv'
              ? 'Skriv ut uppgiftsblad'
              : 'Print worksheet'}
        </button>
      </div>
    </div>
  );
}

interface QuizQuestionRow {
  id: string;
  prompt: string;
  options: string[];
  difficulty: string;
  orderIndex: number;
}
interface QuizResult {
  score: number;
  total: number;
  results: Array<{ questionId: string; yourAnswer: number; correct: boolean; correctIndex: number; explanation: string }>;
}

function QuizModal({
  slug,
  locale,
  onClose,
}: {
  slug: string;
  locale: Locale;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<QuizQuestionRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(Date.now());
  const api = process.env.NEXT_PUBLIC_API_URL ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${api}/v1/plants/${encodeURIComponent(slug)}/quiz?locale=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { questions: QuizQuestionRow[] }) => {
        if (cancelled) return;
        setQuestions(data.questions ?? []);
        setAnswers({});
        setResult(null);
        startedAt.current = Date.now();
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, slug, locale]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${api}/v1/plants/${encodeURIComponent(slug)}/quiz/attempt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale,
          answers,
          durationMs: Date.now() - startedAt.current,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as QuizResult;
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const tryAgain = () => {
    setAnswers({});
    setResult(null);
    startedAt.current = Date.now();
  };

  const allAnswered = questions.length > 0 && questions.every((q) => typeof answers[q.id] === 'number');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={locale === 'fi' ? 'Visa' : locale === 'sv' ? 'Quiz' : 'Quiz'}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(5,10,7,0.78)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--cream)',
          color: 'var(--ink)',
          borderRadius: 18,
          padding: 28,
          maxWidth: 600,
          width: '100%',
          boxShadow: 'var(--shadow-deep)',
          position: 'relative',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="icon-btn"
          aria-label={locale === 'fi' ? 'Sulje' : locale === 'sv' ? 'Stäng' : 'Close'}
          style={{ position: 'absolute', top: 14, right: 14 }}
        >
          ✕
        </button>
        <div className="tiny" style={{ color: 'var(--rust-on-light)' }}>
          🎯 {locale === 'fi' ? 'Koulutilan visa' : locale === 'sv' ? 'Skolläges-quiz' : 'School-mode quiz'}
        </div>
        <h3 className="serif" style={{ fontSize: 24, marginTop: 8 }}>
          {locale === 'fi'
            ? 'Kolme nopeaa kysymystä'
            : locale === 'sv'
              ? 'Tre snabba frågor'
              : 'Three quick questions'}
        </h3>

        {loading && <p className="muted" style={{ marginTop: 18 }}>{locale === 'fi' ? 'Ladataan…' : locale === 'sv' ? 'Laddar…' : 'Loading…'}</p>}
        {error && (
          <p role="alert" style={{ marginTop: 12, color: 'var(--rust-on-light)' }}>
            {error}
          </p>
        )}

        {!loading && !error && !result && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (allAnswered) submit();
            }}
            style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            {questions.map((q, qi) => (
              <fieldset key={q.id} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="serif" style={{ fontSize: 17, lineHeight: 1.35 }}>
                  {qi + 1}. {q.prompt}
                </legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {q.options.map((opt, oi) => {
                    const id = `q-${q.id}-${oi}`;
                    const checked = answers[q.id] === oi;
                    return (
                      <label
                        key={id}
                        htmlFor={id}
                        style={{
                          padding: '10px 14px',
                          borderRadius: 10,
                          border: `1px solid ${checked ? 'var(--forest)' : 'var(--line)'}`,
                          background: checked ? 'var(--sage-pale)' : 'var(--paper)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          cursor: 'pointer',
                          fontSize: 14,
                        }}
                      >
                        <input
                          type="radio"
                          id={id}
                          name={q.id}
                          checked={checked}
                          onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!allAnswered || submitting}
              style={{ alignSelf: 'flex-start', minWidth: 160 }}
            >
              {submitting
                ? locale === 'fi' ? 'Lähetetään…' : locale === 'sv' ? 'Skickar…' : 'Submitting…'
                : locale === 'fi' ? 'Tarkista' : locale === 'sv' ? 'Rätta' : 'Check'}
            </button>
          </form>
        )}

        {result && (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              className="card card-pad"
              style={{
                background: 'var(--sage-pale)',
                textAlign: 'center',
                padding: '20px 16px',
              }}
            >
              <div className="serif" style={{ fontSize: 36 }}>
                {result.score} / {result.total}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {result.score === result.total
                  ? locale === 'fi'
                    ? 'Täysi pistemäärä — hienosti!'
                    : locale === 'sv'
                      ? 'Full pott — bra jobbat!'
                      : 'Perfect score — well done!'
                  : locale === 'fi'
                    ? 'Hyvä yritys — lue selitykset alta.'
                    : locale === 'sv'
                      ? 'Bra försök — läs förklaringarna nedan.'
                      : 'Good try — read the explanations below.'}
              </div>
            </div>
            {questions.map((q, qi) => {
              const r = result.results.find((x) => x.questionId === q.id);
              if (!r) return null;
              return (
                <div
                  key={q.id}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 10,
                    border: `1px solid ${r.correct ? 'var(--forest)' : 'var(--rust)'}`,
                    background: r.correct ? 'rgba(45,84,64,0.05)' : 'rgba(184,81,58,0.05)',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {qi + 1}. {q.prompt}
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    {locale === 'fi' ? 'Vastauksesi: ' : locale === 'sv' ? 'Ditt svar: ' : 'Your answer: '}
                    <strong>{r.yourAnswer >= 0 ? q.options[r.yourAnswer] : '—'}</strong>{' '}
                    {r.correct ? '✓' : '✗'}
                  </div>
                  {!r.correct && (
                    <div className="small" style={{ marginTop: 4 }}>
                      {locale === 'fi' ? 'Oikea vastaus: ' : locale === 'sv' ? 'Rätt svar: ' : 'Correct: '}
                      <strong>{q.options[r.correctIndex]}</strong>
                    </div>
                  )}
                  {r.explanation && (
                    <p className="small muted" style={{ marginTop: 6, lineHeight: 1.5 }}>{r.explanation}</p>
                  )}
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary" onClick={tryAgain}>
                {locale === 'fi' ? 'Yritä uudelleen' : locale === 'sv' ? 'Försök igen' : 'Try again'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                {locale === 'fi' ? 'Sulje' : locale === 'sv' ? 'Stäng' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
