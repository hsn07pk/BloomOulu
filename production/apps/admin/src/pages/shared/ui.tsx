/**
 * BloomOulu Admin · Shared UI primitives.
 *
 * Every custom admin page composes from this file. The primitives encode
 * the visual system (tokens.ts + ../../styles/global.css) so individual
 * pages can stay short and focused on data flow.
 *
 * Design intent:
 *   • Non-technical curators read prose, not jargon. Every primitive
 *     supports `hint`/`help` props so the surrounding context can be
 *     written in plain language.
 *   • Every interactive primitive is keyboard- and screen-reader-
 *     friendly: roles, labels, focus rings, aria attributes.
 *   • Loading, empty and error states are first-class — pages never
 *     render bare spinners.
 */
import React, { useEffect, useId, useState } from 'react';
import { colors, font, fontSize, radius, shadow, space } from './tokens';

// ────────────────────────────────────────────────────────────────────────
// Page chrome
// ────────────────────────────────────────────────────────────────────────

export interface PageHeaderProps {
  /** Short uppercase label above the title (group / section). */
  kicker?: string;
  /** Page title. */
  title: string;
  /** One-paragraph plain-language intro. */
  lede?: string;
  /** Right-aligned actions (buttons, dropdowns). */
  actions?: React.ReactNode;
  /** Optional icon glyph rendered before the title. */
  icon?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  kicker,
  title,
  lede,
  actions,
  icon,
}) => (
  <header
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: space[6],
      paddingBottom: space[6],
      borderBottom: `1px solid ${colors.lineSoft}`,
      marginBottom: space[6],
      flexWrap: 'wrap',
    }}
  >
    <div style={{ flex: '1 1 360px', minWidth: 280 }}>
      {kicker && (
        <div
          style={{
            fontSize: fontSize.xs,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: colors.moss,
            marginBottom: space[2],
          }}
        >
          {kicker}
        </div>
      )}
      <h1
        style={{
          fontFamily: font.display,
          fontSize: 'clamp(28px, 3.2vw, 36px)',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: colors.forestDeep,
          margin: 0,
          lineHeight: 1.1,
          display: 'flex',
          alignItems: 'center',
          gap: space[3],
        }}
      >
        {icon && (
          <span
            aria-hidden="true"
            style={{
              fontSize: '0.8em',
              color: colors.teal,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {icon}
          </span>
        )}
        {title}
      </h1>
      {lede && (
        <p
          style={{
            color: colors.inkMute,
            fontSize: fontSize.md,
            lineHeight: 1.55,
            maxWidth: 760,
            margin: `${space[3]} 0 0`,
          }}
        >
          {lede}
        </p>
      )}
    </div>
    {actions && (
      <div
        style={{
          display: 'flex',
          gap: space[2],
          flexShrink: 0,
          alignItems: 'center',
        }}
      >
        {actions}
      </div>
    )}
  </header>
);

// ────────────────────────────────────────────────────────────────────────
// Page container
// ────────────────────────────────────────────────────────────────────────

export const Page: React.FC<{
  children: React.ReactNode;
  narrow?: boolean;
}> = ({ children, narrow }) => (
  <div className={`bo-page ${narrow ? 'bo-page--narrow' : ''}`}>{children}</div>
);

// ────────────────────────────────────────────────────────────────────────
// Card / Section
// ────────────────────────────────────────────────────────────────────────

export interface CardProps {
  title?: string;
  description?: string;
  kicker?: string;
  actions?: React.ReactNode;
  tone?: 'paper' | 'sage' | 'cream';
  flush?: boolean;
  children: React.ReactNode;
  id?: string;
}

export const Card: React.FC<CardProps> = ({
  title,
  description,
  kicker,
  actions,
  tone = 'paper',
  flush,
  children,
  id,
}) => {
  const bg =
    tone === 'sage' ? colors.sage : tone === 'cream' ? colors.cream : colors.paper;
  return (
    <section
      id={id}
      style={{
        background: bg,
        border: `1px solid ${colors.line}`,
        borderRadius: radius.lg,
        padding: flush ? 0 : `${space[5]} ${space[6]}`,
        marginBottom: space[5],
        boxShadow: shadow.sm,
        overflow: flush ? 'hidden' : 'visible',
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: space[4],
            padding: flush ? `${space[5]} ${space[6]} 0` : 0,
            marginBottom: description ? space[2] : space[4],
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {kicker && (
              <div
                style={{
                  fontSize: fontSize.xs,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  color: colors.moss,
                  marginBottom: space[1],
                }}
              >
                {kicker}
              </div>
            )}
            {title && (
              <h2
                style={{
                  fontFamily: font.display,
                  fontSize: fontSize.xl,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: colors.forestDeep,
                  margin: 0,
                }}
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                style={{
                  color: colors.inkMute,
                  fontSize: fontSize.base,
                  lineHeight: 1.55,
                  margin: `${space[1]} 0 0`,
                }}
              >
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div
              style={{
                display: 'flex',
                gap: space[2],
                flexShrink: 0,
                alignItems: 'center',
              }}
            >
              {actions}
            </div>
          )}
        </header>
      )}
      <div
        style={
          flush
            ? { padding: 0 }
            : { paddingTop: title ? space[1] : 0 }
        }
      >
        {children}
      </div>
    </section>
  );
};

// ────────────────────────────────────────────────────────────────────────
// HelpBanner — dismissible inline guide
// ────────────────────────────────────────────────────────────────────────

export const HelpBanner: React.FC<{
  id: string; // localStorage key
  title: string;
  children: React.ReactNode;
}> = ({ id, title, children }) => {
  const storageKey = `bo.help.${id}.dismissed`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  if (dismissed) return null;
  return (
    <div
      role="region"
      aria-label={`Help: ${title}`}
      style={{
        display: 'flex',
        gap: space[4],
        background: `linear-gradient(135deg, ${colors.sage} 0%, ${colors.sagePale} 100%)`,
        border: `1px solid ${colors.olive}`,
        borderRadius: radius.lg,
        padding: `${space[4]} ${space[5]}`,
        marginBottom: space[5],
        alignItems: 'flex-start',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: colors.paper,
          color: colors.forest,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: font.display,
          fontSize: 22,
          border: `1px solid ${colors.olive}`,
        }}
      >
        ✿
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontWeight: 600,
            color: colors.forestDeep,
            fontFamily: font.display,
            fontSize: fontSize.lg,
            marginBottom: space[1],
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: colors.inkSoft,
            fontSize: fontSize.base,
            lineHeight: 1.55,
          }}
        >
          {children}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss help"
        title="Dismiss this help banner. It won't show again on this device."
        onClick={() => {
          try {
            localStorage.setItem(storageKey, '1');
          } catch {
            /* ignore */
          }
          setDismissed(true);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: colors.inkMute,
          fontSize: 22,
          cursor: 'pointer',
          padding: space[1],
          lineHeight: 1,
          borderRadius: radius.sm,
        }}
      >
        ×
      </button>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// InfoTooltip — small (?) icon with hover/focus explanation
// ────────────────────────────────────────────────────────────────────────

export const InfoTooltip: React.FC<{
  label: string;
  /** Optional ariaLabel override. */
  ariaLabel?: string;
}> = ({ label, ariaLabel }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 4,
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel ?? `Explain: ${label.slice(0, 60)}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((x) => !x)}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: colors.whisper,
          border: `1px solid ${colors.line}`,
          color: colors.inkMute,
          fontSize: 11,
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'help',
          padding: 0,
          lineHeight: 1,
        }}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: colors.forestDeep,
            color: colors.paper,
            padding: `${space[2]} ${space[3]}`,
            borderRadius: radius.sm,
            fontSize: fontSize.sm,
            lineHeight: 1.4,
            width: 'max-content',
            maxWidth: 280,
            zIndex: 100,
            boxShadow: shadow.md,
            pointerEvents: 'none',
            whiteSpace: 'normal',
            fontFamily: font.body,
            fontWeight: 400,
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
};

// ────────────────────────────────────────────────────────────────────────
// EmptyState
// ────────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  variant?: 'idle' | 'no-results' | 'no-filter-match' | 'error' | 'loading' | 'all-done' | 'coming-soon';
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

const EMPTY_ICONS: Record<NonNullable<EmptyStateProps['variant']>, string> = {
  idle: '✿',
  'no-results': '⌕',
  'no-filter-match': '⌥',
  error: '!',
  loading: '◐',
  'all-done': '✓',
  'coming-soon': '☼',
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  variant = 'idle',
  title,
  description,
  action,
  icon,
}) => {
  const color =
    variant === 'error' ? colors.accent : variant === 'all-done' ? colors.olive : colors.moss;
  const bg =
    variant === 'error' ? colors.accentSoft : variant === 'all-done' ? colors.sage : colors.whisper;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: `${space[10]} ${space[6]}`,
        gap: space[3],
        animation: 'bo-fade-in 220ms ease',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: bg,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: font.display,
          fontSize: 28,
          border: `1px solid ${color}`,
        }}
      >
        {icon ?? EMPTY_ICONS[variant]}
      </div>
      <div
        style={{
          fontFamily: font.display,
          fontSize: fontSize.xl,
          fontWeight: 600,
          color: colors.forestDeep,
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            color: colors.inkMute,
            fontSize: fontSize.base,
            lineHeight: 1.55,
            maxWidth: 460,
          }}
        >
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: space[2] }}>{action}</div>}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// SearchFilterBar
// ────────────────────────────────────────────────────────────────────────

export interface SearchFilterBarProps {
  search?: string;
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  searchHint?: string;
  filters?: React.ReactNode;
  /** Render at the very right — e.g. result counts, view toggles. */
  right?: React.ReactNode;
  /** When >0, a "Clear all" pill appears. */
  activeFilterCount?: number;
  onClearAll?: () => void;
  resultCount?: number;
  totalCount?: number;
  resultLabel?: string;
}

export const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  searchHint,
  filters,
  right,
  activeFilterCount = 0,
  onClearAll,
  resultCount,
  totalCount,
  resultLabel = 'results',
}) => {
  const id = useId();
  return (
    <div
      style={{
        background: colors.paper,
        border: `1px solid ${colors.line}`,
        borderRadius: radius.lg,
        padding: `${space[3]} ${space[4]}`,
        marginBottom: space[4],
        boxShadow: shadow.sm,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: space[3],
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {onSearch && (
          <div
            style={{
              position: 'relative',
              flex: '1 1 280px',
              minWidth: 220,
            }}
          >
            <label htmlFor={id} className="bo-sr-only">
              Search
            </label>
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: colors.inkFaint,
                fontSize: 14,
                pointerEvents: 'none',
              }}
            >
              ⌕
            </span>
            <input
              id={id}
              type="search"
              value={search ?? ''}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              title={searchHint}
              style={{
                width: '100%',
                padding: `9px 36px 9px 34px`,
                border: `1px solid ${colors.line}`,
                borderRadius: radius.md,
                background: colors.cream,
                fontSize: fontSize.base,
                fontFamily: font.body,
                color: colors.ink,
                boxSizing: 'border-box',
              }}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearch('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: colors.whisper,
                  border: `1px solid ${colors.line}`,
                  borderRadius: '50%',
                  width: 20,
                  height: 20,
                  fontSize: 12,
                  color: colors.inkMute,
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ×
              </button>
            )}
          </div>
        )}
        {filters && (
          <div
            style={{
              display: 'flex',
              gap: space[2],
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {filters}
          </div>
        )}
        {activeFilterCount > 0 && onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            style={{
              background: colors.accentSoft,
              color: colors.accent,
              border: `1px solid ${colors.accent}`,
              borderRadius: radius.pill,
              padding: '4px 12px',
              fontSize: fontSize.sm,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} ×
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: space[3] }}>
          {typeof resultCount === 'number' && (
            <span
              style={{
                fontSize: fontSize.sm,
                color: colors.inkMute,
                fontFamily: font.body,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <strong style={{ color: colors.forest }}>{resultCount}</strong>
              {typeof totalCount === 'number' && totalCount !== resultCount && (
                <> of {totalCount}</>
              )}{' '}
              {resultLabel}
            </span>
          )}
          {right}
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// FilterChip / FilterSelect
// ────────────────────────────────────────────────────────────────────────

export const FilterChip: React.FC<{
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
  tone?: 'default' | 'accent';
}> = ({ active, label, count, onClick, tone = 'default' }) => {
  const activeBg = tone === 'accent' ? colors.accentSoft : colors.sage;
  const activeFg = tone === 'accent' ? colors.accent : colors.forestDeep;
  const activeBorder = tone === 'accent' ? colors.accent : colors.olive;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        borderRadius: radius.pill,
        background: active ? activeBg : colors.cream,
        color: active ? activeFg : colors.inkSoft,
        border: `1px solid ${active ? activeBorder : colors.line}`,
        fontSize: fontSize.sm,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: font.body,
        transition: 'all 150ms ease',
      }}
    >
      {label}
      {typeof count === 'number' && (
        <span
          style={{
            background: active ? colors.paper : colors.whisper,
            color: active ? activeFg : colors.inkMute,
            borderRadius: radius.pill,
            padding: '0 6px',
            fontSize: 11,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
};

export const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  hint?: string;
}> = ({ label, value, onChange, options, hint }) => {
  const id = useId();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 4px 2px 10px',
        borderRadius: radius.pill,
        background: value && value !== 'all' ? colors.sage : colors.cream,
        border: `1px solid ${value && value !== 'all' ? colors.olive : colors.line}`,
        fontSize: fontSize.sm,
        color: colors.inkSoft,
      }}
      title={hint}
    >
      <label htmlFor={id} style={{ fontSize: fontSize.sm, color: colors.inkMute }}>
        {label}:
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: fontSize.sm,
          color: colors.forest,
          fontWeight: 500,
          padding: '4px 8px 4px 4px',
          cursor: 'pointer',
          fontFamily: font.body,
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </span>
  );
};

// ────────────────────────────────────────────────────────────────────────
// StatusPill
// ────────────────────────────────────────────────────────────────────────

export type StatusTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

export const StatusPill: React.FC<{
  tone: StatusTone;
  children: React.ReactNode;
  /** Optional bullet dot before the label. */
  dot?: boolean;
}> = ({ tone, children, dot = true }) => {
  const map: Record<StatusTone, { bg: string; fg: string; line: string }> = {
    success: { bg: colors.successBg, fg: colors.successFg, line: colors.successLine },
    warn: { bg: colors.warningBg, fg: colors.warningFg, line: colors.warningLine },
    danger: { bg: colors.dangerBg, fg: colors.dangerFg, line: colors.dangerLine },
    info: { bg: colors.infoBg, fg: colors.infoFg, line: colors.infoLine },
    neutral: { bg: colors.whisper, fg: colors.inkMute, line: colors.line },
  };
  const s = map[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: radius.pill,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.line}`,
        fontSize: fontSize.sm,
        fontWeight: 500,
        lineHeight: 1.4,
        fontFamily: font.body,
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: s.line,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
};

// ────────────────────────────────────────────────────────────────────────
// Button
// ────────────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const buttonStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: colors.forestMid,
    color: colors.paper,
    border: `1px solid ${colors.forest}`,
  },
  secondary: {
    background: colors.cream,
    color: colors.forest,
    border: `1px solid ${colors.line}`,
  },
  ghost: {
    background: 'transparent',
    color: colors.forest,
    border: '1px solid transparent',
  },
  danger: {
    background: colors.accentSoft,
    color: colors.accent,
    border: `1px solid ${colors.accent}`,
  },
};

const buttonSizes: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '5px 12px', fontSize: fontSize.sm, borderRadius: radius.sm },
  md: { padding: '8px 16px', fontSize: fontSize.base, borderRadius: radius.md },
  lg: { padding: '11px 22px', fontSize: fontSize.md, borderRadius: radius.md },
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading,
  leftIcon,
  rightIcon,
  children,
  disabled,
  style,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontWeight: 500,
      fontFamily: font.body,
      cursor: loading ? 'wait' : disabled ? 'not-allowed' : 'pointer',
      opacity: disabled && !loading ? 0.55 : 1,
      transition: 'all 150ms ease',
      lineHeight: 1.3,
      ...buttonSizes[size],
      ...buttonStyles[variant],
      ...style,
    }}
  >
    {loading ? (
      <Spinner size={14} />
    ) : (
      leftIcon && <span aria-hidden="true">{leftIcon}</span>
    )}
    {children}
    {!loading && rightIcon && <span aria-hidden="true">{rightIcon}</span>}
  </button>
);

// ────────────────────────────────────────────────────────────────────────
// Spinner
// ────────────────────────────────────────────────────────────────────────

export const Spinner: React.FC<{ size?: number; tone?: 'light' | 'dark' }> = ({
  size = 16,
  tone = 'dark',
}) => (
  <span
    aria-label="Loading"
    role="status"
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      border: `2px solid ${
        tone === 'light' ? 'rgba(255,255,255,0.32)' : 'rgba(31,60,45,0.18)'
      }`,
      borderTopColor: tone === 'light' ? colors.paper : colors.forestMid,
      borderRadius: '50%',
      animation: 'bo-spin 0.6s linear infinite',
    }}
  />
);

// Inject the keyframes once.
if (typeof document !== 'undefined') {
  const existing = document.getElementById('bo-keyframes');
  if (!existing) {
    const style = document.createElement('style');
    style.id = 'bo-keyframes';
    style.textContent = `
      @keyframes bo-spin { to { transform: rotate(360deg); } }
      @keyframes bo-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes bo-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
    `;
    document.head.appendChild(style);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Skeleton
// ────────────────────────────────────────────────────────────────────────

export const Skeleton: React.FC<{
  height?: number | string;
  width?: number | string;
  radius?: number | string;
}> = ({ height = 14, width = '100%', radius: r = 6 }) => (
  <div
    aria-hidden="true"
    style={{
      height,
      width,
      borderRadius: r,
      background:
        `linear-gradient(90deg, ${colors.whisper} 0%, ${colors.sagePale} 50%, ${colors.whisper} 100%)`,
      backgroundSize: '800px 100%',
      animation: 'bo-shimmer 1.4s linear infinite',
    }}
  />
);

// ────────────────────────────────────────────────────────────────────────
// Toast / Notice (inline message)
// ────────────────────────────────────────────────────────────────────────

export const Notice: React.FC<{
  tone: StatusTone;
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
  compact?: boolean;
}> = ({ tone, title, children, onDismiss, compact }) => {
  const map: Record<StatusTone, { bg: string; fg: string; line: string; icon: string }> = {
    success: { bg: colors.successBg, fg: colors.successFg, line: colors.successLine, icon: '✓' },
    warn: { bg: colors.warningBg, fg: colors.warningFg, line: colors.warningLine, icon: '!' },
    danger: { bg: colors.dangerBg, fg: colors.dangerFg, line: colors.dangerLine, icon: '!' },
    info: { bg: colors.infoBg, fg: colors.infoFg, line: colors.infoLine, icon: 'i' },
    neutral: { bg: colors.whisper, fg: colors.inkMute, line: colors.line, icon: '•' },
  };
  const s = map[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'}
      style={{
        display: 'flex',
        gap: space[3],
        padding: compact ? `${space[2]} ${space[3]}` : `${space[3]} ${space[4]}`,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.line}`,
        borderRadius: radius.md,
        marginBottom: space[3],
        fontSize: fontSize.base,
        lineHeight: 1.5,
        alignItems: 'flex-start',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: s.line,
          color: colors.paper,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: font.body,
        }}
      >
        {s.icon}
      </span>
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{ fontWeight: 600, marginBottom: children ? 2 : 0 }}>{title}</div>
        )}
        {children}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: s.fg,
            fontSize: 18,
            cursor: 'pointer',
            padding: 0,
            width: 22,
            height: 22,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// Tabs
// ────────────────────────────────────────────────────────────────────────

export interface TabsProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number; hint?: string }>;
}

export function Tabs<T extends string>({ value, onChange, options }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 2,
        borderBottom: `1px solid ${colors.line}`,
        marginBottom: space[5],
        flexWrap: 'wrap',
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: `${space[3]} ${space[4]}`,
              fontSize: fontSize.base,
              fontWeight: active ? 600 : 500,
              color: active ? colors.forestDeep : colors.inkMute,
              cursor: 'pointer',
              borderBottom: active ? `2px solid ${colors.forestMid}` : '2px solid transparent',
              marginBottom: -1,
              fontFamily: font.body,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              transition: 'color 150ms ease',
            }}
          >
            {opt.label}
            {typeof opt.count === 'number' && (
              <span
                style={{
                  background: active ? colors.sage : colors.whisper,
                  color: active ? colors.forestDeep : colors.inkMute,
                  borderRadius: radius.pill,
                  padding: '1px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// StickyActionBar — appears at the bottom when a form is dirty
// ────────────────────────────────────────────────────────────────────────

export const StickyActionBar: React.FC<{
  visible: boolean;
  message?: string;
  children: React.ReactNode;
}> = ({ visible, message, children }) => {
  if (!visible) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: colors.paper,
        borderTop: `1px solid ${colors.line}`,
        boxShadow: '0 -8px 24px rgba(31, 60, 45, 0.10)',
        padding: `${space[3]} ${space[6]}`,
        display: 'flex',
        alignItems: 'center',
        gap: space[4],
        marginTop: space[6],
        borderRadius: `${radius.lg} ${radius.lg} 0 0`,
        animation: 'bo-fade-in 220ms ease',
      }}
    >
      {message && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: colors.warningFg,
            fontSize: fontSize.base,
            fontWeight: 500,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: colors.warningLine,
            }}
          />
          {message}
        </div>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: space[2] }}>{children}</div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────
// StatTile (KPI card)
// ────────────────────────────────────────────────────────────────────────

export const StatTile: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  delta?: { value: string; tone: 'up' | 'down' | 'flat' };
  accent?: string;
  icon?: React.ReactNode;
  href?: string;
  /** Important / warning stat — adds amber accent. */
  emphasis?: 'normal' | 'attention';
}> = ({ label, value, hint, delta, accent, icon, href, emphasis = 'normal' }) => {
  const accentColor = emphasis === 'attention' ? colors.accent : accent ?? colors.forestMid;
  const inner = (
    <div
      style={{
        position: 'relative',
        background: colors.paper,
        border: `1px solid ${colors.line}`,
        borderRadius: radius.lg,
        padding: `${space[5]} ${space[5]} ${space[4]}`,
        boxShadow: shadow.sm,
        transition: 'all 200ms ease',
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 4,
          background: accentColor,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: space[2],
        }}
      >
        {icon && (
          <span
            aria-hidden="true"
            style={{
              color: accentColor,
              fontSize: 16,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {icon}
          </span>
        )}
        <div
          style={{
            fontSize: fontSize.xs,
            color: colors.inkMute,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        {hint && <InfoTooltip label={hint} />}
      </div>
      <div
        style={{
          fontSize: fontSize['3xl'],
          fontWeight: 600,
          color: colors.forestDeep,
          fontFamily: font.display,
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {delta && (
        <div
          style={{
            marginTop: space[2],
            fontSize: fontSize.sm,
            color:
              delta.tone === 'up'
                ? colors.successFg
                : delta.tone === 'down'
                  ? colors.dangerFg
                  : colors.inkMute,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span aria-hidden="true">
            {delta.tone === 'up' ? '▲' : delta.tone === 'down' ? '▼' : '–'}
          </span>
          {delta.value}
        </div>
      )}
    </div>
  );
  if (href) {
    return (
      <a
        href={href}
        style={{
          textDecoration: 'none',
          color: 'inherit',
          display: 'block',
        }}
      >
        {inner}
      </a>
    );
  }
  return inner;
};

export const StatGrid: React.FC<{ children: React.ReactNode; min?: number }> = ({
  children,
  min = 200,
}) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      gap: space[4],
    }}
  >
    {children}
  </div>
);

// ────────────────────────────────────────────────────────────────────────
// DocLink / KbdHint
// ────────────────────────────────────────────────────────────────────────

export const DocLink: React.FC<{
  href: string;
  external?: boolean;
  children: React.ReactNode;
}> = ({ href, external, children }) => (
  <a
    href={href}
    target={external ? '_blank' : undefined}
    rel={external ? 'noopener noreferrer' : undefined}
    style={{
      color: colors.moss,
      textDecoration: 'underline',
      textDecorationColor: colors.olive,
      textUnderlineOffset: 3,
      fontWeight: 500,
    }}
  >
    {children}
    {external && (
      <span aria-hidden="true" style={{ marginLeft: 2, fontSize: '0.85em' }}>
        ↗
      </span>
    )}
  </a>
);

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd
    style={{
      display: 'inline-block',
      padding: '2px 6px',
      fontSize: 11,
      fontFamily: font.mono,
      color: colors.inkSoft,
      background: colors.whisper,
      border: `1px solid ${colors.line}`,
      borderBottomWidth: 2,
      borderRadius: 4,
      lineHeight: 1,
    }}
  >
    {children}
  </kbd>
);

// ────────────────────────────────────────────────────────────────────────
// CopyButton
// ────────────────────────────────────────────────────────────────────────

export const CopyButton: React.FC<{
  value: string;
  label?: string;
  size?: ButtonSize;
}> = ({ value, label = 'Copy', size = 'sm' }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size={size}
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? '✓ Copied' : label}
    </Button>
  );
};

// ────────────────────────────────────────────────────────────────────────
// DataTable — accessible, sortable, with empty / loading states.
// ────────────────────────────────────────────────────────────────────────

export interface DataColumn<T> {
  key: string;
  label: string;
  /** Right-aligned numeric content. */
  align?: 'left' | 'right' | 'center';
  width?: string | number;
  hint?: string;
  render: (row: T) => React.ReactNode;
  /** Sortable key — must match `key` if true. */
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Array<DataColumn<T>>;
  rows: T[];
  rowKey: (row: T, idx: number) => string;
  loading?: boolean;
  empty?: React.ReactNode;
  /** Sticky header — usable inside scrollable container. */
  stickyHeader?: boolean;
  caption?: string;
  /** Sorting state held by parent. */
  sort?: { key: string; direction: 'asc' | 'desc' } | null;
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  stickyHeader,
  caption,
  sort,
  onSort,
  onRowClick,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div style={{ padding: space[4] }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ marginBottom: space[2] }}>
            <Skeleton height={36} radius={8} />
          </div>
        ))}
      </div>
    );
  }
  if (!rows.length) {
    return <>{empty ?? <EmptyState variant="no-results" title="Nothing to show yet." />}</>;
  }
  return (
    <div
      style={{
        background: colors.paper,
        border: `1px solid ${colors.line}`,
        borderRadius: radius.lg,
        overflow: 'auto',
        boxShadow: shadow.sm,
      }}
    >
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: font.body,
          fontSize: fontSize.base,
          background: 'transparent',
          boxShadow: 'none',
          borderRadius: 0,
        }}
      >
        {caption && (
          <caption className="bo-sr-only" style={{ textAlign: 'left' }}>
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {columns.map((col) => {
              const isSorted = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    textAlign: col.align ?? 'left',
                    width: col.width,
                    padding: '12px 14px',
                    background: colors.whisper,
                    borderBottom: `1px solid ${colors.line}`,
                    color: colors.inkMute,
                    fontWeight: 600,
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    position: stickyHeader ? 'sticky' : 'static',
                    top: stickyHeader ? 0 : 'auto',
                    zIndex: 1,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: col.sortable ? 'pointer' : 'default',
                    }}
                    onClick={col.sortable ? () => onSort?.(col.key) : undefined}
                  >
                    {col.label}
                    {col.hint && <InfoTooltip label={col.hint} />}
                    {col.sortable && (
                      <span
                        aria-hidden="true"
                        style={{
                          fontSize: 10,
                          color: isSorted ? colors.forest : colors.inkFaint,
                          display: 'inline-block',
                          width: 10,
                        }}
                      >
                        {isSorted ? (sort?.direction === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={rowKey(row, idx)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background 120ms ease',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = colors.sagePale;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  style={{
                    textAlign: col.align ?? 'left',
                    padding: '13px 14px',
                    borderBottom: `1px solid ${colors.lineSoft}`,
                    color: colors.inkSoft,
                    fontSize: fontSize.base,
                    verticalAlign: 'top',
                    fontVariantNumeric: col.align === 'right' ? 'tabular-nums' : 'normal',
                  }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// useDebouncedValue — used by search inputs
// ────────────────────────────────────────────────────────────────────────

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ────────────────────────────────────────────────────────────────────────
// useDirtyTracker — for forms with sticky save bar
//
// Direct structural comparison — no refs. The earlier ref-based version
// compared the freshly-loaded values against a *stale* snapshot from the
// previous render (the ref update only happens in a useEffect), which
// flashed "unsaved changes" the moment the page mounted. A plain
// stringify comparison renders correctly on every pass.
// ────────────────────────────────────────────────────────────────────────

export function useDirtyTracker<T>(initial: T, current: T): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
