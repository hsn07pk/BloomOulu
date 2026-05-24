/**
 * Bulk QR print — garden-staff workflow.
 *
 * One page that lets staff:
 *   1. Search/filter the plant catalog (debounced API search + Red-List
 *      facet + garden zone filter).
 *   2. Multi-select plants with checkboxes (sticky basket on the right
 *      with running count + remove buttons + "Clear all").
 *   3. Pick a label-sheet preset (Avery 5160 US, L7159 EU A4, …) OR
 *      type custom dimensions for a custom sheet.
 *   4. Toggle which fields to print + cut marks + kiosk tracking id.
 *   5. Open the print preview in a new tab — the preview honours every
 *      knob set here and lays out a print-ready PDF-via-browser sheet.
 *
 * The preview lives at /<locale>/plants/print-bulk on the public web app.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  FilterChip,
  HelpBanner,
  InfoTooltip,
  Notice,
  Page,
  PageHeader,
  SearchFilterBar,
  Skeleton,
  StatusPill,
  useDebouncedValue,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface Plant {
  id: string;
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  gardenZone?: string | null;
  adopterCount?: number;
  taxon?: { latinName?: string | null } | null;
}

interface LabelPreset {
  id: string;
  name: string;
  sheetW: number;
  sheetH: number;
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
  marginT: number;
  marginR: number;
  marginB: number;
  marginL: number;
  gutterX: number;
  gutterY: number;
  qrSize: number;
  note: string;
}

const PRESETS: LabelPreset[] = [
  {
    id: 'l7159',
    name: 'A4 · 21 labels (L7159 · 63.5×38.1mm)',
    sheetW: 210, sheetH: 297, cols: 3, rows: 7,
    labelW: 63.5, labelH: 38.1,
    marginT: 15.1, marginR: 7, marginB: 15.1, marginL: 7,
    gutterX: 2.5, gutterY: 0, qrSize: 30,
    note: 'DECAdry / Avery — most common multipurpose label sheet in EU.',
  },
  {
    id: 'l7163',
    name: 'A4 · 14 labels (L7163 · 99.1×38.1mm)',
    sheetW: 210, sheetH: 297, cols: 2, rows: 7,
    labelW: 99.1, labelH: 38.1,
    marginT: 15.1, marginR: 4.6, marginB: 15.1, marginL: 4.6,
    gutterX: 2.5, gutterY: 0, qrSize: 32,
    note: 'Wide labels — good when you also want common name + zone.',
  },
  {
    id: 'l7173',
    name: 'A4 · 10 labels (L7173 · 99.1×57mm)',
    sheetW: 210, sheetH: 297, cols: 2, rows: 5,
    labelW: 99.1, labelH: 57,
    marginT: 13.5, marginR: 4.6, marginB: 13.5, marginL: 4.6,
    gutterX: 2.5, gutterY: 0, qrSize: 45,
    note: 'Large labels — biggest QR, best for outdoor signage.',
  },
  {
    id: 'l7160',
    name: 'A4 · 24 labels (L7160 · 63.5×33.9mm)',
    sheetW: 210, sheetH: 297, cols: 3, rows: 8,
    labelW: 63.5, labelH: 33.9,
    marginT: 13.5, marginR: 7, marginB: 13.5, marginL: 7,
    gutterX: 2.5, gutterY: 0, qrSize: 26,
    note: 'Compact — fits more plants per sheet for high-density beds.',
  },
  {
    id: 'l7651',
    name: 'A4 · 65 labels (L7651 · 38.1×21.2mm)',
    sheetW: 210, sheetH: 297, cols: 5, rows: 13,
    labelW: 38.1, labelH: 21.2,
    marginT: 11, marginR: 4.7, marginB: 11, marginL: 4.7,
    gutterX: 2.5, gutterY: 0, qrSize: 18,
    note: 'Tiny — herbarium / cuttings only. QR readable but harder to scan from far.',
  },
  {
    id: 'a4-cut-3x6',
    name: 'A4 plain · cut marks · 3×6 (70×40mm)',
    sheetW: 210, sheetH: 297, cols: 3, rows: 6,
    labelW: 70, labelH: 40,
    marginT: 14, marginR: 5, marginB: 14, marginL: 5,
    gutterX: 5, gutterY: 5, qrSize: 32,
    note: 'No precut — print on plain A4 stock, follow the dashed lines with a guillotine.',
  },
  {
    id: 'a4-cut-2x4',
    name: 'A4 plain · cut marks · 2×4 (90×60mm)',
    sheetW: 210, sheetH: 297, cols: 2, rows: 4,
    labelW: 90, labelH: 60,
    marginT: 25, marginR: 10, marginB: 25, marginL: 10,
    gutterX: 10, gutterY: 10, qrSize: 50,
    note: 'Larger plain-paper labels — good for greenhouse plates.',
  },
  {
    id: 'us-5160',
    name: 'US Letter · 30 labels (Avery 5160 · 66.7×25.4mm)',
    sheetW: 215.9, sheetH: 279.4, cols: 3, rows: 10,
    labelW: 66.7, labelH: 25.4,
    marginT: 12.7, marginR: 4.8, marginB: 12.7, marginL: 4.8,
    gutterX: 3.2, gutterY: 0, qrSize: 22,
    note: 'Standard US Letter Avery sheet — for international garden partners.',
  },
];

interface Selection {
  slug: string;
  latinName: string;
  commonName: string;
  redListStatus: string;
}

const STORAGE_KEY = 'bloomoulu.adminBulkQr.v1';

const RED_LIST_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'CR', label: 'CR' },
  { value: 'EN', label: 'EN' },
  { value: 'VU', label: 'VU' },
  { value: 'NT', label: 'NT' },
  { value: 'LC', label: 'LC' },
] as const;

const BulkQrPrint: React.FC = () => {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [redList, setRedList] = useState<'all' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC'>('all');
  const [results, setResults] = useState<Plant[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection[]>([]);

  // Preset state
  const [presetId, setPresetId] = useState<string>('l7159');
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const [cfg, setCfg] = useState<LabelPreset>(preset);
  useEffect(() => {
    const next = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!;
    setCfg(next);
  }, [presetId]);

  // Field toggles + tracking
  const [showLatin, setShowLatin] = useState(true);
  const [showCommon, setShowCommon] = useState(true);
  const [showRedList, setShowRedListField] = useState(true);
  const [showZone, setShowZone] = useState(false);
  const [showSlug, setShowSlug] = useState(false);
  const [cutMarks, setCutMarks] = useState(true);
  const [kiosk, setKiosk] = useState('');
  const [repeat, setRepeat] = useState(1);
  const [material, setMaterial] = useState<'paper' | 'wood' | 'aluminum'>('paper');
  const [locale, setLocale] = useState<'en' | 'fi' | 'sv'>('en');

  // Restore selection from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { selection?: Selection[] };
        if (Array.isArray(parsed.selection)) setSelection(parsed.selection);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ selection }));
    } catch {
      /* ignore */
    }
  }, [selection]);

  // Debounced server-side plant search.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSearching(true);
      setSearchErr(null);
      try {
        const params = new URLSearchParams({ limit: '60' });
        if (debouncedQuery.trim()) params.set('q', debouncedQuery.trim());
        if (redList !== 'all') params.set('redList', redList);
        const r = await fetch(`/admin/plants/search?${params}`, { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { items: Plant[] };
        if (!cancelled) setResults(data.items ?? []);
      } catch (e) {
        if (!cancelled) setSearchErr((e as Error).message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, redList]);

  const selectedSlugs = useMemo(() => new Set(selection.map((s) => s.slug)), [selection]);
  const totalLabels = selection.length * repeat;
  const sheetsNeeded = Math.max(1, Math.ceil(totalLabels / (cfg.cols * cfg.rows)));

  function toggle(p: Plant) {
    setSelection((prev) => {
      if (prev.some((s) => s.slug === p.slug)) {
        return prev.filter((s) => s.slug !== p.slug);
      }
      return [
        ...prev,
        {
          slug: p.slug,
          latinName: p.taxon?.latinName ?? p.nameEn,
          commonName: p.nameEn,
          redListStatus: p.redListStatus,
        },
      ];
    });
  }
  function addAllVisible() {
    setSelection((prev) => {
      const map = new Map(prev.map((s) => [s.slug, s]));
      for (const p of results) {
        if (!map.has(p.slug)) {
          map.set(p.slug, {
            slug: p.slug,
            latinName: p.taxon?.latinName ?? p.nameEn,
            commonName: p.nameEn,
            redListStatus: p.redListStatus,
          });
        }
      }
      return Array.from(map.values());
    });
  }
  function removeFromSelection(slug: string) {
    setSelection((prev) => prev.filter((s) => s.slug !== slug));
  }
  function clearAll() {
    setSelection([]);
  }

  function openPrintPreview(autoprint = false) {
    if (selection.length === 0) return;
    const slugs = selection.map((s) => s.slug).join(',');
    const params = new URLSearchParams({
      slugs,
      sheetW: String(cfg.sheetW),
      sheetH: String(cfg.sheetH),
      cols: String(cfg.cols),
      rows: String(cfg.rows),
      labelW: String(cfg.labelW),
      labelH: String(cfg.labelH),
      marginT: String(cfg.marginT),
      marginR: String(cfg.marginR),
      marginB: String(cfg.marginB),
      marginL: String(cfg.marginL),
      gutterX: String(cfg.gutterX),
      gutterY: String(cfg.gutterY),
      qrSize: String(cfg.qrSize),
      cutMarks: cutMarks ? '1' : '0',
      showLatin: showLatin ? '1' : '0',
      showCommon: showCommon ? '1' : '0',
      showRedList: showRedList ? '1' : '0',
      showZone: showZone ? '1' : '0',
      showSlug: showSlug ? '1' : '0',
      kiosk,
      repeat: String(repeat),
      material,
    });
    if (autoprint) params.set('autoprint', '1');
    const win = window as unknown as { BLOOMOULU_WEB_URL?: string };
    const webBase =
      win.BLOOMOULU_WEB_URL ?? window.location.origin.replace(/:\d+$/, ':3000');
    const url = `${webBase}/${locale}/plants/print-bulk?${params}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <Page>
      <PageHeader
        kicker="Print workflow"
        title="Bulk QR labels"
        lede="Search the catalogue, build a selection, choose a sheet preset, and open a print-ready page. Your selection persists across reloads so you can come back later."
      />

      <HelpBanner id="bulk-qr-intro" title="Three steps">
        <strong>1.</strong> Search and tick the plants you need labels for.
        &nbsp;<strong>2.</strong> Pick a label-sheet preset that matches your sticker paper (or
        the “cut marks” option for plain A4). &nbsp;<strong>3.</strong> Click <em>Open print
        preview</em> — your browser handles the rest. Every QR encodes the public plant URL with
        <code>?qr=1</code> so scans are tracked.
      </HelpBanner>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 400px',
          gap: space[6],
          alignItems: 'flex-start',
        }}
      >
        {/* ── LEFT: search + results ─────────────────────────────────── */}
        <div>
          <SearchFilterBar
            search={query}
            onSearch={setQuery}
            searchPlaceholder="Search by Latin or common name…"
            searchHint="Live search across English, Finnish, Swedish, Latin, and the URL slug."
            filters={
              <>
                {RED_LIST_OPTIONS.map((opt) => (
                  <FilterChip
                    key={opt.value}
                    active={redList === opt.value}
                    label={opt.label}
                    onClick={() => setRedList(opt.value as typeof redList)}
                  />
                ))}
                {results.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={addAllVisible}>
                    + Add all {results.length} visible
                  </Button>
                )}
              </>
            }
            activeFilterCount={(query ? 1 : 0) + (redList !== 'all' ? 1 : 0)}
            onClearAll={() => {
              setQuery('');
              setRedList('all');
            }}
            resultCount={results.length}
            resultLabel={searching ? 'searching…' : 'plants'}
          />

          {searchErr && (
            <Notice tone="danger" title="Couldn't fetch plants" onDismiss={() => setSearchErr(null)}>
              {searchErr}
            </Notice>
          )}

          <Card flush>
            {searching && results.length === 0 ? (
              <div style={{ padding: space[5] }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <Skeleton height={48} />
                  </div>
                ))}
              </div>
            ) : results.length === 0 ? (
              <EmptyState
                variant="no-results"
                title="No plants match your filters"
                description="Try a broader keyword, or change the Red List status filter."
                action={
                  (query || redList !== 'all') && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery('');
                        setRedList('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  )
                }
              />
            ) : (
              <div style={{ maxHeight: 620, overflowY: 'auto' }}>
                {results.map((p) => {
                  const isSelected = selectedSlugs.has(p.slug);
                  return (
                    <label
                      key={p.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px 1fr auto',
                        gap: 12,
                        alignItems: 'center',
                        padding: `${space[3]} ${space[4]}`,
                        borderBottom: `1px solid ${colors.lineSoft}`,
                        background: isSelected ? colors.sage : colors.paper,
                        cursor: 'pointer',
                        transition: 'background 120ms ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          (e.currentTarget as HTMLLabelElement).style.background = colors.sagePale;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          (e.currentTarget as HTMLLabelElement).style.background = colors.paper;
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(p)}
                        style={{ width: 18, height: 18, accentColor: colors.forestMid }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontStyle: 'italic',
                            fontSize: fontSize.base,
                            color: colors.forestDeep,
                            fontWeight: isSelected ? 600 : 500,
                          }}
                        >
                          {p.taxon?.latinName ?? p.nameEn}
                        </div>
                        <div
                          style={{
                            fontSize: fontSize.sm,
                            color: colors.inkMute,
                            marginTop: 2,
                          }}
                        >
                          {p.nameEn}
                          {p.gardenZone && (
                            <>
                              {' · '}
                              <span style={{ color: colors.inkFaint }}>📍 {p.gardenZone}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <StatusPill
                        tone={p.redListStatus && p.redListStatus !== 'LC' ? 'warn' : 'neutral'}
                        dot={false}
                      >
                        {p.redListStatus || '—'}
                      </StatusPill>
                    </label>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ── RIGHT: sticky basket + config ──────────────────────────── */}
        <aside
          style={{
            position: 'sticky',
            top: space[4],
            alignSelf: 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            gap: space[3],
          }}
        >
          <Card
            kicker="Your selection"
            title={`${selection.length} plant${selection.length === 1 ? '' : 's'} · ${totalLabels} label${totalLabels === 1 ? '' : 's'}`}
            description={
              selection.length > 0
                ? `≈ ${sheetsNeeded} sheet${sheetsNeeded === 1 ? '' : 's'} of this preset.`
                : undefined
            }
            actions={
              selection.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear all
                </Button>
              ) : undefined
            }
          >
            <div
              style={{
                maxHeight: 200,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {selection.length === 0 ? (
                <span style={{ fontSize: fontSize.sm, color: colors.inkMute }}>
                  Pick plants from the list to build a sheet.
                </span>
              ) : (
                selection.map((s) => (
                  <div
                    key={s.slug}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 6,
                      alignItems: 'center',
                      fontSize: fontSize.sm,
                      padding: '6px 0',
                      borderBottom: `1px dotted ${colors.lineSoft}`,
                    }}
                  >
                    <span
                      style={{
                        fontStyle: 'italic',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: colors.forest,
                      }}
                    >
                      {s.latinName}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromSelection(s.slug)}
                      aria-label={`Remove ${s.slug}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: colors.inkMute,
                        cursor: 'pointer',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 14,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card title="Sheet preset" description={preset.note}>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: radius.sm,
                border: `1px solid ${colors.line}`,
                background: colors.cream,
                fontSize: fontSize.base,
                fontFamily: font.body,
                color: colors.ink,
                marginBottom: space[2],
                boxSizing: 'border-box',
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <details>
              <summary
                style={{
                  fontSize: fontSize.sm,
                  cursor: 'pointer',
                  color: colors.moss,
                  marginBottom: space[2],
                }}
              >
                Customise dimensions
              </summary>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 8,
                  fontSize: 11,
                  marginTop: space[2],
                }}
              >
                {(
                  [
                    'sheetW',
                    'sheetH',
                    'cols',
                    'rows',
                    'labelW',
                    'labelH',
                    'marginT',
                    'marginR',
                    'marginB',
                    'marginL',
                    'gutterX',
                    'gutterY',
                    'qrSize',
                  ] as const
                ).map((k) => (
                  <label
                    key={k}
                    style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                  >
                    <span style={{ color: colors.inkMute }}>{k}</span>
                    <input
                      type="number"
                      value={(cfg as unknown as Record<string, number>)[k]}
                      onChange={(e) =>
                        setCfg((c) => ({ ...c, [k]: Number(e.target.value) }))
                      }
                      style={{
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: `1px solid ${colors.line}`,
                        background: colors.cream,
                        fontFamily: font.mono,
                        fontSize: 11,
                        color: colors.ink,
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
          </Card>

          <Card title="Fields on each label">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: fontSize.base }}>
              <Checkbox checked={showLatin} onChange={setShowLatin} label="Latin (scientific) name" />
              <Checkbox checked={showCommon} onChange={setShowCommon} label="Common name" />
              <Checkbox checked={showRedList} onChange={setShowRedListField} label="Red List badge" />
              <Checkbox
                checked={showZone}
                onChange={setShowZone}
                label="Garden zone"
                hint="Internal zone code. Leave off for public-facing labels."
              />
              <Checkbox
                checked={showSlug}
                onChange={setShowSlug}
                label="Slug"
                hint="QA only — exposes the internal URL slug. Donor labels should hide it."
              />
              <Checkbox checked={cutMarks} onChange={setCutMarks} label="Dashed cut marks (plain paper)" />
            </div>
          </Card>

          <Card title="Tracking & material">
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: fontSize.sm,
                marginBottom: space[3],
              }}
            >
              <span style={{ color: colors.forest, fontWeight: 500 }}>
                Kiosk tag <InfoTooltip label="Baked into the QR URL. Useful when you want to split scans by sticker location (e.g. greenhouse-north vs. main-path)." />
              </span>
              <input
                type="text"
                value={kiosk}
                onChange={(e) => setKiosk(e.target.value)}
                placeholder="e.g. greenhouse-north"
                style={inputStyle}
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: fontSize.sm,
                marginBottom: space[3],
              }}
            >
              <span style={{ color: colors.forest, fontWeight: 500 }}>Material</span>
              <select
                value={material}
                onChange={(e) => setMaterial(e.target.value as typeof material)}
                style={inputStyle}
              >
                <option value="paper">Paper</option>
                <option value="wood">Wood (transfer paper)</option>
                <option value="aluminum">Aluminum (sublimation)</option>
              </select>
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: fontSize.sm,
                marginBottom: space[3],
              }}
            >
              <span style={{ color: colors.forest, fontWeight: 500 }}>Copies per plant</span>
              <input
                type="number"
                min={1}
                max={20}
                value={repeat}
                onChange={(e) =>
                  setRepeat(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                }
                style={inputStyle}
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontSize: fontSize.sm,
              }}
            >
              <span style={{ color: colors.forest, fontWeight: 500 }}>Locale (common name)</span>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as typeof locale)}
                style={inputStyle}
              >
                <option value="en">English</option>
                <option value="fi">Suomi</option>
                <option value="sv">Svenska</option>
              </select>
            </label>
          </Card>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              size="lg"
              disabled={selection.length === 0}
              onClick={() => openPrintPreview(false)}
              style={{ flex: 1 }}
            >
              Open print preview
            </Button>
            <Button
              variant="secondary"
              size="lg"
              disabled={selection.length === 0}
              onClick={() => openPrintPreview(true)}
              title="Open the preview and immediately trigger Cmd+P"
            >
              Print now
            </Button>
          </div>
        </aside>
      </div>
    </Page>
  );
};

const Checkbox: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}> = ({ checked, onChange, label, hint }) => (
  <label
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      color: colors.forest,
      cursor: 'pointer',
    }}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      style={{ width: 16, height: 16, accentColor: colors.forestMid }}
    />
    {label}
    {hint && <InfoTooltip label={hint} />}
  </label>
);

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.cream,
  fontSize: fontSize.base,
  fontFamily: font.body,
  color: colors.ink,
  boxSizing: 'border-box',
};

export default BulkQrPrint;
