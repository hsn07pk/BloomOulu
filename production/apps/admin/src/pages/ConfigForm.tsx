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
 *
 * Design intent: a non-technical curator should be able to land on
 * any page, read the descriptions, edit, and save — no docs needed.
 */
import React, { useEffect, useState } from 'react';

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
  /** Tooltip shown on hover. Short hint; longer prose goes in `help`. */
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
  sections: ConfigSection[];
  /** Optional live preview component shown at the top. */
  Preview?: React.ComponentType<{ values: Record<string, unknown> }>;
}

const COLORS = {
  forest: '#1F3C2D',
  forestMid: '#2D5440',
  forestDeep: '#16301F',
  sage: '#E8EEDE',
  sagePale: '#F2F0E8',
  cream: '#FAF7EE',
  paper: '#FFFFFF',
  line: '#E5E2D8',
  ink: '#1F3C2D',
  inkMute: '#6B7560',
  inkSoft: '#88897C',
  ok: '#2D5440',
  err: '#B8513A',
  warn: '#E8C66A',
};

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

const ConfigForm: React.FC<{ schema: ConfigSchema }> = ({ schema }) => {
  const allKeys = schema.sections.flatMap((s) => s.fields.map((f) => f.key));
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
        setValues(seeded);
        setLoaded(true);
      } catch (err) {
        setMsg({ kind: 'err', text: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };

  }, [schema]);

  const set = (key: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await saveValues(values);
      setMsg({ kind: 'ok', text: 'Saved. Changes are live everywhere.' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div style={{ padding: 32, color: COLORS.inkMute, fontFamily: 'system-ui, sans-serif' }}>
        Loading current settings…
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 'clamp(24px, 4vw, 40px)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        maxWidth: 980,
        margin: '0 auto',
        color: COLORS.ink,
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 600,
            margin: '0 0 10px',
            color: COLORS.forest,
            letterSpacing: '-0.01em',
          }}
        >
          {schema.title}
        </h1>
        {schema.intro && (
          <p style={{ color: COLORS.inkMute, fontSize: 15, lineHeight: 1.55, maxWidth: 720, margin: 0 }}>
            {schema.intro}
          </p>
        )}
      </header>

      {schema.Preview && (
        <section
          style={{
            background: COLORS.sage,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 14,
            padding: 18,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: COLORS.inkMute,
              marginBottom: 8,
            }}
          >
            Live preview · what your donors see
          </div>
          <schema.Preview values={values} />
        </section>
      )}

      {schema.sections.map((sec, sIdx) => (
        <section
          key={sIdx}
          style={{
            background: COLORS.paper,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 14,
            padding: '22px 24px 18px',
            marginBottom: 18,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 6px', color: COLORS.forestDeep }}>
            {sec.title}
          </h2>
          {sec.description && (
            <p style={{ color: COLORS.inkMute, fontSize: 13, lineHeight: 1.5, margin: '0 0 18px' }}>
              {sec.description}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sec.fields.map((f) => (
              <FieldRow key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </section>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            padding: '12px 24px',
            background: saving ? COLORS.inkSoft : COLORS.forestMid,
            color: 'white',
            border: 'none',
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 500,
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save all changes'}
        </button>
        {msg && (
          <span
            role="status"
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              background: msg.kind === 'ok' ? COLORS.sage : '#FFF3EE',
              color: msg.kind === 'ok' ? COLORS.ok : COLORS.err,
              fontSize: 13,
              border: `1px solid ${msg.kind === 'ok' ? COLORS.forestMid : COLORS.err}`,
            }}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
};

interface RowProps {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}
const FieldRow: React.FC<RowProps> = ({ field, value, onChange }) => {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        gap: 18,
        alignItems: 'start',
      }}
    >
      <div>
        <div
          title={field.hint}
          style={{ fontWeight: 500, color: COLORS.forest, fontSize: 14, lineHeight: 1.35 }}
        >
          {field.label}
        </div>
        {field.help && (
          <div style={{ fontSize: 12, color: COLORS.inkMute, marginTop: 4, lineHeight: 1.45 }}>
            {field.help}
          </div>
        )}
        {field.example && (
          <div
            style={{
              fontSize: 11,
              color: COLORS.inkSoft,
              marginTop: 4,
              fontStyle: 'italic',
              fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
            }}
          >
            {field.example}
          </div>
        )}
      </div>
      <div>
        <FieldInput field={field} value={value} onChange={onChange} />
      </div>
    </label>
  );
};

const inputBaseStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: `1px solid ${COLORS.line}`,
  background: COLORS.cream,
  fontSize: 14,
  fontFamily: 'inherit',
  color: COLORS.ink,
  boxSizing: 'border-box',
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
        style={{ ...inputBaseStyle, fontFamily: 'ui-monospace, monospace' }}
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
        style={{ ...inputBaseStyle, fontFamily: 'inherit', resize: 'vertical' }}
      />
    );
  }
  if (t.kind === 'number') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          min={t.min}
          max={t.max}
          step={t.step ?? 1}
          style={{ ...inputBaseStyle, maxWidth: 200 }}
        />
        {t.suffix && <span style={{ color: COLORS.inkMute, fontSize: 13 }}>{t.suffix}</span>}
      </div>
    );
  }
  if (t.kind === 'cents') {
    const cents = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) || 0 : 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18, color: COLORS.forest }}>€</span>
        <input
          type="number"
          value={(cents / 100).toFixed(2)}
          onChange={(e) => onChange(Math.round(parseFloat(e.target.value || '0') * 100))}
          min={0}
          step={0.01}
          style={{ ...inputBaseStyle, maxWidth: 160 }}
        />
        {t.suffix && <span style={{ color: COLORS.inkMute, fontSize: 13 }}>{t.suffix}</span>}
        <span style={{ color: COLORS.inkSoft, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
          ({cents} cents)
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
          padding: '6px 14px 6px 6px',
          borderRadius: 999,
          border: `1px solid ${on ? COLORS.forestMid : COLORS.line}`,
          background: on ? COLORS.sage : COLORS.cream,
          cursor: 'pointer',
          fontSize: 14,
          color: COLORS.forest,
        }}
      >
        <span
          style={{
            width: 36,
            height: 22,
            borderRadius: 999,
            background: on ? COLORS.forestMid : COLORS.line,
            position: 'relative',
            transition: 'background 0.12s',
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
              background: 'white',
              transition: 'left 0.12s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          />
        </span>
        <span>{on ? (t.trueLabel ?? 'Enabled') : (t.falseLabel ?? 'Disabled')}</span>
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
                padding: '10px 12px',
                borderRadius: 8,
                border: on ? `2px solid ${COLORS.forestMid}` : `1px solid ${COLORS.line}`,
                background: on ? COLORS.sage : COLORS.cream,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: `2px solid ${on ? COLORS.forestMid : COLORS.line}`,
                  background: on ? COLORS.forestMid : 'transparent',
                  color: 'white',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on ? '✓' : ''}
              </span>
              <span style={{ fontWeight: on ? 600 : 500, color: COLORS.forest, fontSize: 14 }}>
                {opt.label}
              </span>
              {opt.description && (
                <span style={{ color: COLORS.inkMute, fontSize: 12, marginLeft: 'auto' }}>
                  {opt.description}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
  return null;
};

export default ConfigForm;
