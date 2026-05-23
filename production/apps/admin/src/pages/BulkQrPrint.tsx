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

// Standard label-sheet formats, mostly Avery / L7xxx. Adding a new preset
// here is the right place — every label printed in the garden eventually
// goes through one of these.
const PRESETS: LabelPreset[] = [
  {
    id: 'l7159',
    name: 'A4 · 21 labels (L7159 · 63.5×38.1mm)',
    sheetW: 210,
    sheetH: 297,
    cols: 3,
    rows: 7,
    labelW: 63.5,
    labelH: 38.1,
    marginT: 15.1,
    marginR: 7,
    marginB: 15.1,
    marginL: 7,
    gutterX: 2.5,
    gutterY: 0,
    qrSize: 30,
    note: 'DECAdry / Avery — most common multipurpose label sheet in EU.',
  },
  {
    id: 'l7163',
    name: 'A4 · 14 labels (L7163 · 99.1×38.1mm)',
    sheetW: 210,
    sheetH: 297,
    cols: 2,
    rows: 7,
    labelW: 99.1,
    labelH: 38.1,
    marginT: 15.1,
    marginR: 4.6,
    marginB: 15.1,
    marginL: 4.6,
    gutterX: 2.5,
    gutterY: 0,
    qrSize: 32,
    note: 'Wide labels — good when you also want common name + zone.',
  },
  {
    id: 'l7173',
    name: 'A4 · 10 labels (L7173 · 99.1×57mm)',
    sheetW: 210,
    sheetH: 297,
    cols: 2,
    rows: 5,
    labelW: 99.1,
    labelH: 57,
    marginT: 13.5,
    marginR: 4.6,
    marginB: 13.5,
    marginL: 4.6,
    gutterX: 2.5,
    gutterY: 0,
    qrSize: 45,
    note: 'Large labels — biggest QR, best for outdoor signage.',
  },
  {
    id: 'l7160',
    name: 'A4 · 24 labels (L7160 · 63.5×33.9mm)',
    sheetW: 210,
    sheetH: 297,
    cols: 3,
    rows: 8,
    labelW: 63.5,
    labelH: 33.9,
    marginT: 13.5,
    marginR: 7,
    marginB: 13.5,
    marginL: 7,
    gutterX: 2.5,
    gutterY: 0,
    qrSize: 26,
    note: 'Compact — fits more plants per sheet for high-density beds.',
  },
  {
    id: 'l7651',
    name: 'A4 · 65 labels (L7651 · 38.1×21.2mm)',
    sheetW: 210,
    sheetH: 297,
    cols: 5,
    rows: 13,
    labelW: 38.1,
    labelH: 21.2,
    marginT: 11,
    marginR: 4.7,
    marginB: 11,
    marginL: 4.7,
    gutterX: 2.5,
    gutterY: 0,
    qrSize: 18,
    note: 'Tiny — herbarium / cuttings only. QR readable but harder to scan from far.',
  },
  {
    id: 'a4-cut-3x6',
    name: 'A4 plain · cut marks · 3×6 (70×40mm)',
    sheetW: 210,
    sheetH: 297,
    cols: 3,
    rows: 6,
    labelW: 70,
    labelH: 40,
    marginT: 14,
    marginR: 5,
    marginB: 14,
    marginL: 5,
    gutterX: 5,
    gutterY: 5,
    qrSize: 32,
    note: 'No precut — print on plain A4 stock, follow the dashed lines with a guillotine.',
  },
  {
    id: 'a4-cut-2x4',
    name: 'A4 plain · cut marks · 2×4 (90×60mm)',
    sheetW: 210,
    sheetH: 297,
    cols: 2,
    rows: 4,
    labelW: 90,
    labelH: 60,
    marginT: 25,
    marginR: 10,
    marginB: 25,
    marginL: 10,
    gutterX: 10,
    gutterY: 10,
    qrSize: 50,
    note: 'Larger plain-paper labels — good for greenhouse plates.',
  },
  {
    id: 'us-5160',
    name: 'US Letter · 30 labels (Avery 5160 · 66.7×25.4mm)',
    sheetW: 215.9,
    sheetH: 279.4,
    cols: 3,
    rows: 10,
    labelW: 66.7,
    labelH: 25.4,
    marginT: 12.7,
    marginR: 4.8,
    marginB: 12.7,
    marginL: 4.8,
    gutterX: 3.2,
    gutterY: 0,
    qrSize: 22,
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

const RED_LIST_OPTIONS: Array<{ value: '' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC'; label: string }> = [
  { value: '', label: 'Any status' },
  { value: 'CR', label: 'CR · Critically Endangered' },
  { value: 'EN', label: 'EN · Endangered' },
  { value: 'VU', label: 'VU · Vulnerable' },
  { value: 'NT', label: 'NT · Near Threatened' },
  { value: 'LC', label: 'LC · Least Concern' },
];

const BulkQrPrint: React.FC = () => {
  const [query, setQuery] = useState('');
  const [redList, setRedList] = useState<'' | 'CR' | 'EN' | 'VU' | 'NT' | 'LC'>('');
  const [results, setResults] = useState<Plant[]>([]);
  const [searching, setSearching] = useState(false);
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
    } catch {/* ignore */}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ selection }));
    } catch {/* ignore */}
  }, [selection]);

  // Debounced server-side plant search.
  useEffect(() => {
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ limit: '60' });
        if (query.trim()) params.set('q', query.trim());
        if (redList) params.set('redList', redList);
        const r = await fetch(`/admin/plants/search?${params}`);
        if (r.ok) {
          const data = (await r.json()) as { items: Plant[] };
          setResults(data.items ?? []);
        }
      } catch {/* keep previous */}
      finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, redList]);

  const selectedSlugs = useMemo(() => new Set(selection.map((s) => s.slug)), [selection]);
  const totalLabels = selection.length * repeat;

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
    // Web base — prefer the runtime-injected value, fall back to /admin's
    // own origin minus the port (most prod deployments serve admin on
    // 4100 and web on 3000 on the same host).
    const win = window as unknown as { BLOOMOULU_WEB_URL?: string };
    const webBase =
      win.BLOOMOULU_WEB_URL ??
      (window.location.origin.replace(/:\d+$/, ':3000'));
    const url = `${webBase}/${locale}/plants/print-bulk?${params}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1400, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, margin: 0 }}>Bulk QR print</h1>
        <p style={{ color: '#555', margin: '8px 0 0' }}>
          Search the catalog, pick the plants you want labels for, choose a label preset, and open a
          print-ready sheet in a new tab. The sheet auto-paginates if your selection won't fit on one
          page. Every QR encodes the public plant URL with <code>?qr=1</code> so scans are tracked.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* ── LEFT: search + results ─────────────────────────────────── */}
        <section>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or Latin…"
              style={{
                flex: '1 1 240px',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #d9d2bb',
                fontSize: 14,
              }}
            />
            <select
              value={redList}
              onChange={(e) => setRedList(e.target.value as typeof redList)}
              style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #d9d2bb' }}
            >
              {RED_LIST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={addAllVisible}
              disabled={results.length === 0}
              style={{ padding: '8px 14px', borderRadius: 6 }}
            >
              + Add all {results.length} visible
            </button>
          </div>
          <div style={{ color: '#666', fontSize: 12, marginBottom: 6 }}>
            {searching ? 'Searching…' : `${results.length} matches`}
          </div>
          <div
            style={{
              border: '1px solid #e0d9bb',
              borderRadius: 8,
              maxHeight: 560,
              overflowY: 'auto',
              background: '#fff',
            }}
          >
            {results.map((p) => {
              const isSelected = selectedSlugs.has(p.slug);
              return (
                <label
                  key={p.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 1fr 60px',
                    gap: 10,
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderBottom: '1px solid #f0ebd9',
                    background: isSelected ? '#eaf3e3' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(p)}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontStyle: 'italic', fontSize: 14 }}>
                      {p.taxon?.latinName ?? p.nameEn}
                    </div>
                    <div style={{ fontSize: 11, color: '#666' }}>
                      {p.nameEn} {p.gardenZone ? `· 📍 ${p.gardenZone}` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: '#1F3A2C', textAlign: 'right' }}>
                    {p.redListStatus}
                  </span>
                </label>
              );
            })}
            {results.length === 0 && !searching && (
              <div style={{ padding: 16, color: '#888', fontSize: 13 }}>No plants match your filters.</div>
            )}
          </div>
        </section>

        {/* ── RIGHT: selection + config ──────────────────────────────── */}
        <aside
          style={{
            position: 'sticky',
            top: 16,
            alignSelf: 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <section style={{ background: '#fff', border: '1px solid #d9d2bb', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>{selection.length} selected · {totalLabels} labels</strong>
              {selection.length > 0 && (
                <button type="button" onClick={clearAll} style={{ fontSize: 12 }}>
                  Clear all
                </button>
              )}
            </div>
            <div
              style={{
                maxHeight: 220,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {selection.length === 0 && (
                <span style={{ fontSize: 12, color: '#888' }}>
                  Pick plants from the list to build a sheet.
                </span>
              )}
              {selection.map((s) => (
                <div
                  key={s.slug}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 6,
                    alignItems: 'center',
                    fontSize: 12,
                    padding: '4px 6px',
                    borderBottom: '1px dotted #ece5d2',
                  }}
                >
                  <span style={{ fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.latinName}
                  </span>
                  <button type="button" onClick={() => removeFromSelection(s.slug)} aria-label={`remove ${s.slug}`}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section style={{ background: '#fff', border: '1px solid #d9d2bb', borderRadius: 10, padding: 14 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>Sheet preset</h2>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 6, marginBottom: 10 }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: '#666', margin: '0 0 8px' }}>{preset.note}</p>
            <details>
              <summary style={{ fontSize: 12, cursor: 'pointer', color: '#1F3A2C' }}>
                Customise dimensions
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, fontSize: 11, marginTop: 8 }}>
                {(['sheetW', 'sheetH', 'cols', 'rows', 'labelW', 'labelH', 'marginT', 'marginR', 'marginB', 'marginL', 'gutterX', 'gutterY', 'qrSize'] as const).map((k) => (
                  <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{k}</span>
                    <input
                      type="number"
                      value={(cfg as unknown as Record<string, number>)[k]}
                      onChange={(e) => setCfg((c) => ({ ...c, [k]: Number(e.target.value) }))}
                      style={{ padding: '4px 6px', borderRadius: 4, border: '1px solid #d9d2bb' }}
                    />
                  </label>
                ))}
              </div>
            </details>
          </section>

          <section style={{ background: '#fff', border: '1px solid #d9d2bb', borderRadius: 10, padding: 14 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>What to print on each label</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <label><input type="checkbox" checked={showLatin} onChange={(e) => setShowLatin(e.target.checked)} /> Latin name</label>
              <label><input type="checkbox" checked={showCommon} onChange={(e) => setShowCommon(e.target.checked)} /> Common name</label>
              <label><input type="checkbox" checked={showRedList} onChange={(e) => setShowRedListField(e.target.checked)} /> Red List badge</label>
              <label><input type="checkbox" checked={showZone} onChange={(e) => setShowZone(e.target.checked)} /> Garden zone</label>
              <label><input type="checkbox" checked={showSlug} onChange={(e) => setShowSlug(e.target.checked)} /> Slug (QA only)</label>
              <label><input type="checkbox" checked={cutMarks} onChange={(e) => setCutMarks(e.target.checked)} /> Dashed cut marks</label>
            </div>
          </section>

          <section style={{ background: '#fff', border: '1px solid #d9d2bb', borderRadius: 10, padding: 14 }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>Tracking + material</h2>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, marginBottom: 8 }}>
              <span>Kiosk / location tag (baked into QR URL)</span>
              <input
                type="text"
                value={kiosk}
                onChange={(e) => setKiosk(e.target.value)}
                placeholder="e.g. greenhouse-north"
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d9d2bb' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, marginBottom: 8 }}>
              <span>Material</span>
              <select value={material} onChange={(e) => setMaterial(e.target.value as typeof material)} style={{ padding: '6px 8px', borderRadius: 6 }}>
                <option value="paper">Paper</option>
                <option value="wood">Wood (transfer paper)</option>
                <option value="aluminum">Aluminum (sublimation)</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, marginBottom: 8 }}>
              <span>Copies per plant</span>
              <input
                type="number"
                min={1}
                max={20}
                value={repeat}
                onChange={(e) => setRepeat(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d9d2bb' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span>Locale (for common name)</span>
              <select value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)} style={{ padding: '6px 8px', borderRadius: 6 }}>
                <option value="en">English</option>
                <option value="fi">Suomi</option>
                <option value="sv">Svenska</option>
              </select>
            </label>
          </section>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={selection.length === 0}
              onClick={() => openPrintPreview(false)}
              style={{
                flex: 1,
                background: '#1F3A2C',
                color: '#fff',
                border: 0,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 14,
                cursor: selection.length === 0 ? 'not-allowed' : 'pointer',
                opacity: selection.length === 0 ? 0.5 : 1,
              }}
            >
              Open print preview
            </button>
            <button
              type="button"
              disabled={selection.length === 0}
              onClick={() => openPrintPreview(true)}
              style={{
                background: 'transparent',
                color: '#1F3A2C',
                border: '1px solid #1F3A2C',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 14,
                cursor: selection.length === 0 ? 'not-allowed' : 'pointer',
                opacity: selection.length === 0 ? 0.5 : 1,
              }}
            >
              Print now
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default BulkQrPrint;
