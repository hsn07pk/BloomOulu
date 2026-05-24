/**
 * Settings — overview / search across every SystemSetting and FeatureFlag.
 *
 * For day-to-day work, curators land on the dedicated config pages
 * (Garden Identity, Payment Providers, Adoption, …) which present the
 * same SystemSetting rows with rich help, examples, and live previews.
 *
 * This page is the fallback / power-user surface: it lists *every* row,
 * groups them by namespace, lets you search across keys + descriptions,
 * and (for primitive values) edits them inline. JSON values get a
 * collapsed-by-default code editor with parse validation, so a mis-typed
 * brace is caught before the save round-trip.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ApiClient } from 'adminjs';
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
  StickyActionBar,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface Setting {
  key: string;
  value: unknown;
  description?: string;
  category?: string;
}

interface Flag {
  key: string;
  enabled: boolean;
  description?: string;
}

const api = new ApiClient();

const CATEGORY_LABELS: Record<string, string> = {
  payments: 'Payments',
  paytrail: 'Paytrail',
  mobilepay: 'MobilePay',
  bankTransfer: 'Bank transfer',
  vat: 'VAT & receipts',
  receipts: 'Receipts',
  gdpr: 'GDPR',
  features: 'Feature flags',
  ask: 'AskTheGarden',
  enrichment: 'Plant enrichment',
  adoption: 'Adoption flow',
  garden: 'Garden identity',
  qrLabel: 'QR labels',
  kiosk: 'Kiosk',
  rag: 'RAG corpus',
  other: 'Uncategorised',
};

const CATEGORY_HINTS: Record<string, string> = {
  payments: 'Master toggles for Paytrail, MobilePay, and bank-transfer rails.',
  paytrail: 'Paytrail merchant ID + sandbox/live hints. Real secrets live in .env.',
  mobilepay: 'Vipps MobilePay merchant serial + API target.',
  bankTransfer: 'IBAN, BIC, beneficiary name shown on the donor’s bank-transfer page.',
  vat: 'VAT rates per line type (donation / perk / gift-wrap).',
  receipts: 'PDF receipt template variables and numbering scheme.',
  gdpr: 'Data-erasure SLA, anonymisation policy, export bundle contents.',
  features: 'Boolean kill-switches consumed by the public site and admin.',
  ask: 'AskTheGarden behaviour: confidence floor, curator escalation, fallback links.',
  enrichment: '24/7 open-data backfill cadence and per-field auto-apply policy.',
  adoption: 'Donor checkout knobs: billing intervals, gift wrap, plaque tiers.',
  garden: 'Public name, postal address, VAT identifier.',
  qrLabel: 'Plant tag print dimensions and label fields.',
  kiosk: 'Lobby display settings and tracking.',
  rag: 'Retrieval pipeline knobs (top-k, reranker threshold).',
  other: 'Settings without a clear namespace prefix yet.',
};

function inferType(value: unknown): 'boolean' | 'number' | 'string' | 'object' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  return 'object';
}

function valueTone(value: unknown): React.ReactNode {
  if (value === null) return <code style={{ color: colors.inkFaint }}>null</code>;
  if (value === undefined) return <code style={{ color: colors.inkFaint }}>—</code>;
  if (typeof value === 'boolean')
    return value ? <StatusPill tone="success">true</StatusPill> : <StatusPill tone="neutral">false</StatusPill>;
  if (typeof value === 'number')
    return (
      <code style={{ fontFamily: font.mono, color: colors.forest, fontVariantNumeric: 'tabular-nums' }}>
        {value.toLocaleString()}
      </code>
    );
  if (typeof value === 'string') return <span>{value}</span>;
  return (
    <code style={{ fontFamily: font.mono, color: colors.inkSoft, fontSize: 12 }}>
      {JSON.stringify(value)}
    </code>
  );
}

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [dirty, setDirty] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const reload = async () => {
    setLoading(true);
    try {
      const [s, f] = await Promise.all([
        api.resourceAction({
          resourceId: 'SystemSetting',
          actionName: 'list',
          params: { perPage: 500 },
        }),
        api.resourceAction({
          resourceId: 'FeatureFlag',
          actionName: 'list',
          params: { perPage: 500 },
        }),
      ]);
      setSettings(
        (s as unknown as { data: { records: Array<{ params: Setting }> } }).data.records.map(
          (r) => r.params,
        ),
      );
      setFlags(
        (f as unknown as { data: { records: Array<{ params: Flag }> } }).data.records.map(
          (r) => r.params,
        ),
      );
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const set = (key: string, value: unknown) => {
    setDirty((d) => ({ ...d, [key]: value }));
  };

  const revertOne = (key: string) =>
    setDirty((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  const save = async () => {
    setSaving(true);
    setOkMsg(null);
    setErr(null);
    try {
      for (const [key, value] of Object.entries(dirty)) {
        if (key.startsWith('flag:')) {
          await api.recordAction({
            resourceId: 'FeatureFlag',
            recordId: key.slice(5),
            actionName: 'edit',
            // AdminJS' typed `params` is restrictive; the runtime accepts a
            // free-form payload that becomes the record's update body.
            payload: { enabled: value },
          } as unknown as Parameters<typeof api.recordAction>[0]);
        } else {
          await api.recordAction({
            resourceId: 'SystemSetting',
            recordId: key,
            actionName: 'edit',
            payload: { value },
          } as unknown as Parameters<typeof api.recordAction>[0]);
        }
      }
      const count = Object.keys(dirty).length;
      setDirty({});
      setOkMsg(
        `Saved ${count} change${count === 1 ? '' : 's'}. Live across the platform within seconds.`,
      );
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Group settings by category prefix.
  const grouped = useMemo(() => {
    return settings.reduce<Record<string, Setting[]>>((acc, s) => {
      const key = s.key.split('.')[0] ?? 'other';
      acc[key] = acc[key] ?? [];
      acc[key]!.push(s);
      return acc;
    }, {});
  }, [settings]);

  // Apply search + category filter.
  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(grouped)
      .filter(([cat]) => activeCategory === 'all' || activeCategory === cat)
      .map(([cat, list]) => {
        const filtered = list.filter((s) => {
          if (!q) return true;
          return (
            s.key.toLowerCase().includes(q) ||
            (s.description ?? '').toLowerCase().includes(q) ||
            String(s.value).toLowerCase().includes(q)
          );
        });
        return [cat, filtered] as const;
      })
      .filter(([, list]) => list.length > 0);
  }, [grouped, query, activeCategory]);

  const visibleFlags = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (activeCategory !== 'all' && activeCategory !== 'features') return [];
    return flags.filter((f) => {
      if (!q) return true;
      return (
        f.key.toLowerCase().includes(q) ||
        (f.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [flags, query, activeCategory]);

  const dirtyCount = Object.keys(dirty).length;
  const visibleSettingCount = visibleGroups.reduce((n, [, list]) => n + list.length, 0);
  const totalCount = settings.length + flags.length;

  const categoryOptions = useMemo(() => {
    const cats = Object.keys(grouped).sort();
    return [{ value: 'all', label: 'All' }, ...cats.map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c }))];
  }, [grouped]);

  return (
    <Page>
      <PageHeader
        kicker="System settings"
        title="Settings & feature flags"
        lede="Every business-decision value, grouped by area. For most tasks the dedicated pages (Garden Identity, Payment Providers, Adoption Knobs…) are friendlier — use this overview to search for a specific key or flip a flag in a hurry."
      />

      <HelpBanner
        id="settings-power-user"
        title="When to use this page vs. the dedicated panels"
      >
        Edits here are <strong>raw</strong> — the value you type is saved as-is. The dedicated
        panels (e.g. <em>Garden Identity</em>) add validation, examples, and live previews. Search
        below to jump to any setting; if you’re unsure, the equivalent friendly panel is linked at
        the top of each group.
      </HelpBanner>

      <SearchFilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search by key, description, or current value…"
        searchHint="Matches anywhere in the setting name, the documentation, or the saved value."
        filters={
          <>
            {categoryOptions.map((opt) => (
              <FilterChip
                key={opt.value}
                active={activeCategory === opt.value}
                label={opt.label}
                count={
                  opt.value === 'all'
                    ? settings.length + flags.length
                    : opt.value === 'features'
                      ? flags.length
                      : (grouped[opt.value]?.length ?? 0)
                }
                onClick={() => setActiveCategory(opt.value)}
              />
            ))}
          </>
        }
        activeFilterCount={
          (query ? 1 : 0) + (activeCategory !== 'all' ? 1 : 0)
        }
        onClearAll={() => {
          setQuery('');
          setActiveCategory('all');
        }}
        resultCount={visibleSettingCount + visibleFlags.length}
        totalCount={totalCount}
        resultLabel="settings"
      />

      {err && (
        <Notice tone="danger" title="Couldn't load settings" onDismiss={() => setErr(null)}>
          {err}
        </Notice>
      )}
      {okMsg && (
        <Notice tone="success" onDismiss={() => setOkMsg(null)}>
          {okMsg}
        </Notice>
      )}

      {loading ? (
        <Card>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <Skeleton height={20} width="40%" />
              <div style={{ marginTop: 8 }}>
                <Skeleton height={36} />
              </div>
            </div>
          ))}
        </Card>
      ) : visibleGroups.length === 0 && visibleFlags.length === 0 ? (
        <Card>
          <EmptyState
            variant={query || activeCategory !== 'all' ? 'no-filter-match' : 'idle'}
            title={
              query || activeCategory !== 'all'
                ? `Nothing matches your filters`
                : 'No settings yet'
            }
            description={
              query || activeCategory !== 'all'
                ? 'Try a broader keyword or clear the category filter.'
                : 'Seeded settings load from `packages/db/prisma/seed`. Run `pnpm db:seed` from the production root.'
            }
            action={
              (query || activeCategory !== 'all') && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery('');
                    setActiveCategory('all');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          {visibleFlags.length > 0 && (
            <Card
              title="Feature flags"
              description="Boolean kill-switches read by the public site and admin. Toggling a flag here propagates within seconds via the Redis pub/sub channel — no restart required."
            >
              <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {visibleFlags.map((f) => {
                  const dirtyValue = dirty[`flag:${f.key}`];
                  const current = dirtyValue !== undefined ? Boolean(dirtyValue) : f.enabled;
                  const isDirty = dirtyValue !== undefined;
                  return (
                    <div
                      key={f.key}
                      role="listitem"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 16,
                        alignItems: 'center',
                        padding: '12px 14px',
                        borderRadius: radius.md,
                        background: isDirty ? colors.warningBg : 'transparent',
                        border: `1px solid ${isDirty ? colors.warningLine : 'transparent'}`,
                        transition: 'all 150ms ease',
                      }}
                    >
                      <div>
                        <code
                          style={{
                            fontFamily: font.mono,
                            fontSize: fontSize.base,
                            color: colors.forest,
                            fontWeight: 600,
                          }}
                        >
                          {f.key}
                        </code>
                        {f.description && (
                          <div
                            style={{
                              fontSize: fontSize.sm,
                              color: colors.inkMute,
                              marginTop: 4,
                              lineHeight: 1.5,
                            }}
                          >
                            {f.description}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isDirty && (
                          <button
                            type="button"
                            onClick={() => revertOne(`flag:${f.key}`)}
                            title="Discard this change"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: colors.inkMute,
                              cursor: 'pointer',
                              padding: 4,
                              fontSize: 12,
                              textDecoration: 'underline',
                            }}
                          >
                            revert
                          </button>
                        )}
                        <BoolToggle
                          value={current}
                          onChange={(v) => set(`flag:${f.key}`, v)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {visibleGroups.map(([cat, list]) => (
            <Card
              key={cat}
              kicker={CATEGORY_LABELS[cat] ?? cat}
              title={`${list.length} setting${list.length === 1 ? '' : 's'} · ${cat}.*`}
              description={CATEGORY_HINTS[cat]}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map((s) => {
                  const dirtyValue = dirty[s.key];
                  const current = dirtyValue !== undefined ? dirtyValue : s.value;
                  const isDirty = dirtyValue !== undefined;
                  const t = inferType(s.value);
                  return (
                    <div
                      key={s.key}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(220px, 320px) 1fr auto',
                        gap: 16,
                        alignItems: 'flex-start',
                        padding: '12px 14px',
                        borderRadius: radius.md,
                        background: isDirty ? colors.warningBg : 'transparent',
                        border: `1px solid ${isDirty ? colors.warningLine : 'transparent'}`,
                        transition: 'all 150ms ease',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <code
                            style={{
                              fontFamily: font.mono,
                              fontSize: fontSize.sm,
                              color: colors.forest,
                              fontWeight: 600,
                              wordBreak: 'break-all',
                            }}
                          >
                            {s.key}
                          </code>
                          {t === 'object' && <InfoTooltip label="This value is stored as JSON. Edit the text and a parse-error message will appear if the syntax is wrong." />}
                        </div>
                        {s.description && (
                          <div
                            style={{
                              fontSize: fontSize.sm,
                              color: colors.inkMute,
                              marginTop: 4,
                              lineHeight: 1.5,
                            }}
                          >
                            {s.description}
                          </div>
                        )}
                      </div>
                      <div>
                        <SmartValueEditor
                          rawType={t}
                          value={current}
                          onChange={(v) => set(s.key, v)}
                        />
                        {!isDirty && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: colors.inkFaint,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span>Currently:</span> {valueTone(s.value)}
                          </div>
                        )}
                      </div>
                      <div>
                        {isDirty && (
                          <button
                            type="button"
                            onClick={() => revertOne(s.key)}
                            title="Discard this change"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: colors.inkMute,
                              cursor: 'pointer',
                              padding: 4,
                              fontSize: 12,
                              textDecoration: 'underline',
                            }}
                          >
                            revert
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </>
      )}

      <StickyActionBar
        visible={!loading && dirtyCount > 0}
        message={`${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}.`}
      >
        <Button
          variant="secondary"
          onClick={() => {
            setDirty({});
            setOkMsg(null);
          }}
          disabled={saving}
        >
          Discard all
        </Button>
        <Button variant="primary" onClick={save} loading={saving}>
          {saving ? 'Saving…' : `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}`}
        </Button>
      </StickyActionBar>
    </Page>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Inline editors
// ─────────────────────────────────────────────────────────────────────

const BoolToggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({
  value,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={value}
    onClick={() => onChange(!value)}
    style={{
      width: 48,
      height: 28,
      borderRadius: 14,
      background: value ? colors.forestMid : colors.line,
      border: 'none',
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 180ms ease',
      flexShrink: 0,
      padding: 0,
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: 2,
        left: value ? 22 : 2,
        width: 24,
        height: 24,
        borderRadius: '50%',
        background: colors.paper,
        transition: 'left 180ms ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }}
    />
  </button>
);

const SmartValueEditor: React.FC<{
  rawType: 'boolean' | 'number' | 'string' | 'object';
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ rawType, value, onChange }) => {
  const [jsonError, setJsonError] = useState<string | null>(null);

  if (rawType === 'boolean') {
    return (
      <BoolToggle
        value={Boolean(value)}
        onChange={onChange}
      />
    );
  }
  if (rawType === 'number') {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : Number(value) || 0}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        style={{
          width: '100%',
          maxWidth: 260,
          padding: '8px 12px',
          border: `1px solid ${colors.line}`,
          borderRadius: radius.sm,
          background: colors.cream,
          fontSize: fontSize.base,
          fontFamily: font.mono,
          color: colors.ink,
          boxSizing: 'border-box',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    );
  }
  if (rawType === 'string') {
    const v = typeof value === 'string' ? value : String(value ?? '');
    return (
      <input
        type="text"
        value={v}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: `1px solid ${colors.line}`,
          borderRadius: radius.sm,
          background: colors.cream,
          fontSize: fontSize.base,
          fontFamily: font.body,
          color: colors.ink,
          boxSizing: 'border-box',
        }}
      />
    );
  }
  // JSON object/array. `JSON.stringify(undefined, …)` returns undefined,
  // which would crash the textarea — fall back to an empty string so the
  // row still renders and the curator can type a valid value.
  const json = JSON.stringify(value, null, 2) ?? '';
  return (
    <div>
      <textarea
        value={json}
        rows={Math.min(10, Math.max(3, (json || '').split('\n').length))}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
            setJsonError(null);
          } catch (err) {
            setJsonError((err as Error).message);
            // Still propagate raw string so the textarea reflects typing;
            // save will keep the *last parseable* value.
          }
        }}
        style={{
          width: '100%',
          padding: '10px 12px',
          border: `1px solid ${jsonError ? colors.dangerLine : colors.line}`,
          borderRadius: radius.sm,
          background: colors.cream,
          fontSize: fontSize.sm,
          fontFamily: font.mono,
          color: colors.ink,
          boxSizing: 'border-box',
          resize: 'vertical',
          lineHeight: 1.5,
        }}
      />
      {jsonError && (
        <div
          role="alert"
          style={{
            color: colors.dangerFg,
            fontSize: fontSize.sm,
            marginTop: 4,
            fontFamily: font.mono,
          }}
        >
          ⚠ {jsonError}
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
