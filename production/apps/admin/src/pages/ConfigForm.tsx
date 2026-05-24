/**
 * ConfigForm — shared building block for the BloomOulu admin's
 * config pages (Garden Identity, Payment Providers, Tier Pricing,
 * Curator, Adoption Knobs).
 *
 * Each parent page declares a SCHEMA (sections + fields). This
 * component:
 *   - GETs current values from `/admin/settings/batch?keys=...`
 *   - Renders the right input per field type (string / number /
 *     currency-cents / boolean / multiselect / textarea)
 *   - Shows tooltips and help copy for non-technical staff
 *   - Saves the whole form via `POST /admin/settings/batch`
 *   - Shows a per-section "saved" indicator
 *   - Lets the user search across labels/help so 50-field pages
 *     remain navigable.
 *
 * Design intent: a non-technical curator should be able to land on
 * any page, read the descriptions, edit, and save — no docs needed.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  HelpBanner,
  InfoTooltip,
  Notice,
  Page,
  PageHeader,
  SearchFilterBar,
  Skeleton,
  StickyActionBar,
  useDirtyTracker,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

export type FieldType =
  | { kind: 'string'; placeholder?: string; maxLength?: number }
  | { kind: 'textarea'; rows?: number; placeholder?: string; maxLength?: number }
  | { kind: 'number'; min?: number; max?: number; step?: number; suffix?: string }
  | { kind: 'cents'; suffix?: string }
  | { kind: 'boolean'; trueLabel?: string; falseLabel?: string }
  | {
      kind: 'multiselect';
      options: Array<{ value: string; label: string; description?: string }>;
      stored?: 'array' | 'csv';
    }
  | { kind: 'select'; options: Array<{ value: string; label: string }> }
  | { kind: 'password'; placeholder?: string }
  | { kind: 'url'; placeholder?: string };

export interface Field {
  key: string;
  label: string;
  help?: string;
  /** Tooltip shown via the (i) icon next to the label. Short hint; longer prose goes in `help`. */
  hint?: string;
  type: FieldType;
  /** Optional default to seed the input if the key has no row yet. */
  default?: unknown;
  /** Visible note rendered under the field — italic muted. */
  example?: string;
}

export interface ConfigSection {
  title: string;
  description?: string;
  fields: Field[];
}

export interface ConfigSchema {
  title: string;
  intro?: string;
  /** Short uppercase kicker shown above the title — e.g. "Configuration". */
  kicker?: string;
  /** One-paragraph help banner shown above the form on first visit. */
  helpBannerId?: string;
  helpBannerTitle?: string;
  helpBanner?: React.ReactNode;
  sections: ConfigSection[];
  /** Optional live preview component shown at the top. */
  Preview?: React.ComponentType<{ values: Record<string, unknown> }>;
}

async function loadValues(keys: string[]): Promise<Record<string, unknown>> {
  const res = await fetch(`/admin/settings/batch?keys=${encodeURIComponent(keys.join(','))}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const data = (await res.json()) as { values: Record<string, unknown> };
  return data.values ?? {};
}

async function saveValues(values: Record<string, unknown>): Promise<void> {
  const res = await fetch('/admin/settings/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `Save failed: ${res.status}`);
  }
}

function fieldMatchesQuery(field: Field, sectionTitle: string, q: string): boolean {
  if (!q) return true;
  const hay = [
    field.label,
    field.help ?? '',
    field.hint ?? '',
    field.example ?? '',
    field.key,
    sectionTitle,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

const ConfigForm: React.FC<{ schema: ConfigSchema }> = ({ schema }) => {
  const allKeys = useMemo(
    () => schema.sections.flatMap((s) => s.fields.map((f) => f.key)),
    [schema],
  );
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const dirty = useDirtyTracker(initialValues, values);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await loadValues(allKeys);
        if (cancelled) return;
        const seeded: Record<string, unknown> = { ...fetched };
        for (const sec of schema.sections) {
          for (const f of sec.fields) {
            if (seeded[f.key] === undefined && f.default !== undefined) {
              seeded[f.key] = f.default;
            }
          }
        }
        setInitialValues(seeded);
        setValues(seeded);
        setLoaded(true);
      } catch (err) {
        setMsg({ kind: 'err', text: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schema, allKeys]);

  const set = (key: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await saveValues(values);
      setInitialValues(values);
      setMsg({ kind: 'ok', text: 'Saved. Changes are live everywhere — refresh any open donor page to verify.' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    setValues(initialValues);
    setMsg(null);
  };

  // Build the filtered section list — fields that don't match get hidden,
  // and entirely-empty sections collapse out so the page rewards search.
  const visibleSections = useMemo(() => {
    if (!query) return schema.sections.map((s) => ({ section: s, fields: s.fields }));
    return schema.sections
      .map((section) => ({
        section,
        fields: section.fields.filter((f) => fieldMatchesQuery(f, section.title, query)),
      }))
      .filter((s) => s.fields.length > 0);
  }, [schema, query]);

  const totalFieldCount = schema.sections.reduce((n, s) => n + s.fields.length, 0);
  const visibleFieldCount = visibleSections.reduce((n, s) => n + s.fields.length, 0);

  return (
    <Page narrow>
      <PageHeader
        kicker={schema.kicker ?? 'Configuration'}
        title={schema.title}
        lede={schema.intro}
      />

      {schema.helpBanner && (
        <HelpBanner
          id={schema.helpBannerId ?? `config-${schema.title}`}
          title={schema.helpBannerTitle ?? 'Before you start'}
        >
          {schema.helpBanner}
        </HelpBanner>
      )}

      {schema.Preview && loaded && (
        <Card
          kicker="Live preview · what your donors see"
          tone="sage"
        >
          <schema.Preview values={values} />
        </Card>
      )}

      {totalFieldCount > 6 && (
        <SearchFilterBar
          search={query}
          onSearch={setQuery}
          searchPlaceholder="Search settings on this page…"
          searchHint="Type any word from a label, help text, or example to jump to it."
          resultCount={query ? visibleFieldCount : undefined}
          totalCount={totalFieldCount}
          resultLabel="settings"
        />
      )}

      {!loaded ? (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18 }}>
                <Skeleton height={14} width={180} />
                <Skeleton height={36} />
              </div>
            ))}
          </div>
        </Card>
      ) : visibleSections.length === 0 ? (
        <Card>
          <EmptyState
            variant="no-results"
            title={`Nothing matches "${query}"`}
            description="Try a different keyword, or clear the search to see every setting."
            action={
              <Button variant="secondary" onClick={() => setQuery('')}>
                Clear search
              </Button>
            }
          />
        </Card>
      ) : (
        visibleSections.map(({ section, fields }, sIdx) => (
          <Card
            key={sIdx}
            title={section.title}
            description={section.description}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {fields.map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  onChange={(v) => set(f.key, v)}
                  highlight={query}
                />
              ))}
            </div>
          </Card>
        ))
      )}

      {msg?.kind === 'err' && (
        <Notice tone="danger" title="Couldn't save" onDismiss={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}
      {msg?.kind === 'ok' && !dirty && (
        <Notice tone="success" onDismiss={() => setMsg(null)}>
          {msg.text}
        </Notice>
      )}

      <StickyActionBar
        visible={loaded && dirty}
        message="You have unsaved changes."
      >
        <Button variant="secondary" onClick={revert} disabled={saving}>
          Revert
        </Button>
        <Button variant="primary" onClick={save} loading={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </StickyActionBar>
    </Page>
  );
};

interface RowProps {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  highlight?: string;
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark
        style={{
          background: colors.highlight,
          color: colors.forestDeep,
          padding: '0 2px',
          borderRadius: 2,
        }}
      >
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

const FieldRow: React.FC<RowProps> = ({ field, value, onChange, highlight }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 280px) 1fr',
        gap: 24,
        alignItems: 'start',
      }}
    >
      <div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontWeight: 600,
            color: colors.forest,
            fontSize: fontSize.base,
            lineHeight: 1.35,
            fontFamily: font.body,
          }}
        >
          {highlightText(field.label, highlight ?? '')}
          {field.hint && <InfoTooltip label={field.hint} />}
        </label>
        {field.help && (
          <div
            style={{
              fontSize: fontSize.sm,
              color: colors.inkMute,
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {highlightText(field.help, highlight ?? '')}
          </div>
        )}
        {field.example && (
          <div
            style={{
              fontSize: 11,
              color: colors.inkFaint,
              marginTop: 4,
              fontStyle: 'italic',
              fontFamily: font.mono,
            }}
          >
            e.g. {field.example}
          </div>
        )}
      </div>
      <div>
        <FieldInput field={field} value={value} onChange={onChange} />
      </div>
    </div>
  );
};

const inputBaseStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: radius.sm,
  border: `1px solid ${colors.line}`,
  background: colors.cream,
  fontSize: fontSize.base,
  fontFamily: font.body,
  color: colors.ink,
  boxSizing: 'border-box',
  transition: 'border-color 150ms ease, box-shadow 150ms ease',
};

const FieldInput: React.FC<RowProps> = ({ field, value, onChange }) => {
  const t = field.type;
  if (t.kind === 'string' || t.kind === 'url') {
    return (
      <input
        type={t.kind === 'url' ? 'url' : 'text'}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'placeholder' in t ? t.placeholder : undefined}
        maxLength={'maxLength' in t ? t.maxLength : undefined}
        style={inputBaseStyle}
      />
    );
  }
  if (t.kind === 'password') {
    return (
      <input
        type="password"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.placeholder}
        autoComplete="new-password"
        style={{ ...inputBaseStyle, fontFamily: font.mono }}
      />
    );
  }
  if (t.kind === 'textarea') {
    return (
      <textarea
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        rows={t.rows ?? 4}
        placeholder={t.placeholder}
        maxLength={t.maxLength}
        style={{ ...inputBaseStyle, fontFamily: font.body, resize: 'vertical', lineHeight: 1.55 }}
      />
    );
  }
  if (t.kind === 'number') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          min={t.min}
          max={t.max}
          step={t.step ?? 1}
          style={{ ...inputBaseStyle, maxWidth: 200, fontVariantNumeric: 'tabular-nums' }}
        />
        {t.suffix && (
          <span style={{ color: colors.inkMute, fontSize: fontSize.sm }}>{t.suffix}</span>
        )}
      </div>
    );
  }
  if (t.kind === 'cents') {
    const cents =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? parseInt(value, 10) || 0
          : 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: radius.sm,
            border: `1px solid ${colors.line}`,
            background: colors.cream,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              padding: '0 10px',
              fontSize: fontSize.lg,
              color: colors.forest,
              background: colors.whisper,
              borderRight: `1px solid ${colors.line}`,
              height: 38,
              display: 'inline-flex',
              alignItems: 'center',
              fontFamily: font.display,
            }}
          >
            €
          </span>
          <input
            type="number"
            value={(cents / 100).toFixed(2)}
            onChange={(e) => onChange(Math.round(parseFloat(e.target.value || '0') * 100))}
            min={0}
            step={0.01}
            style={{
              ...inputBaseStyle,
              border: 'none',
              borderRadius: 0,
              maxWidth: 140,
              background: 'transparent',
              fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>
        {t.suffix && (
          <span style={{ color: colors.inkMute, fontSize: fontSize.sm }}>{t.suffix}</span>
        )}
        <span
          style={{
            color: colors.inkFaint,
            fontSize: 11,
            fontFamily: font.mono,
          }}
        >
          stored as {cents.toLocaleString()} cents
        </span>
      </div>
    );
  }
  if (t.kind === 'boolean') {
    const on = value === true || value === 'true';
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 16px 6px 6px',
          borderRadius: 999,
          border: `1px solid ${on ? colors.forestMid : colors.line}`,
          background: on ? colors.sage : colors.cream,
          cursor: 'pointer',
          fontSize: fontSize.base,
          color: colors.forest,
          fontFamily: font.body,
          transition: 'all 180ms ease',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 36,
            height: 22,
            borderRadius: 999,
            background: on ? colors.forestMid : colors.line,
            position: 'relative',
            transition: 'background 180ms ease',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: on ? 16 : 2,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: colors.paper,
              transition: 'left 180ms ease',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          />
        </span>
        <span style={{ fontWeight: 500 }}>
          {on ? (t.trueLabel ?? 'Enabled') : (t.falseLabel ?? 'Disabled')}
        </span>
      </button>
    );
  }
  if (t.kind === 'select') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        style={inputBaseStyle}
      >
        {t.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  if (t.kind === 'multiselect') {
    const stored = t.stored ?? 'array';
    const current: string[] = Array.isArray(value)
      ? (value as string[])
      : typeof value === 'string'
        ? value.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const toggle = (v: string) => {
      const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
      onChange(stored === 'csv' ? next.join(',') : next);
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {t.options.map((opt) => {
          const on = current.includes(opt.value);
          return (
            <button
              type="button"
              key={opt.value}
              onClick={() => toggle(opt.value)}
              aria-pressed={on}
              style={{
                textAlign: 'left',
                padding: '10px 14px',
                borderRadius: radius.md,
                border: on ? `2px solid ${colors.forestMid}` : `1px solid ${colors.line}`,
                background: on ? colors.sage : colors.cream,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                fontFamily: font.body,
                transition: 'all 150ms ease',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: `2px solid ${on ? colors.forestMid : colors.line}`,
                  background: on ? colors.forestMid : 'transparent',
                  color: colors.paper,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {on ? '✓' : ''}
              </span>
              <span style={{ flex: 1 }}>
                <span
                  style={{
                    fontWeight: on ? 600 : 500,
                    color: colors.forest,
                    fontSize: fontSize.base,
                  }}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <span
                    style={{
                      color: colors.inkMute,
                      fontSize: fontSize.sm,
                      display: 'block',
                      marginTop: 2,
                      lineHeight: 1.4,
                    }}
                  >
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return null;
};

export default ConfigForm;
