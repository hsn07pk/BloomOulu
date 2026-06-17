'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { saveProfile, requestExport, requestErasure } from './actions';

interface Profile {
  id: string;
  email: string;
  name: string | null;
  locale: 'en' | 'fi' | 'sv';
  role: 'donor' | 'curator' | 'finance' | 'admin';
  homeRegion: string | null;
  preferences: { marketingOptIn?: boolean } | null;
}

const REGIONS = [
  '',
  'FI-LL',
  'FI-HA',
  'FI-PP',
  'SE',
  'NO',
  'EE',
  'RU',
  'GB-SCT',
  'DE',
  'NORDIC',
  'EUR',
  'OTHER',
] as const;

// Locale-aware labels for the optional home-region selector. Kept inline
// (rather than in the i18n catalogs) since the home-region field is a minor
// profile preference now that I@H plant-pairing has been retired.
const REGION_LABELS: Record<string, { en: string; fi: string; sv: string }> = {
  '': { en: 'Not specified', fi: 'Ei määritelty', sv: 'Ej angivet' },
  'FI-LL': { en: 'Finland · Lapland', fi: 'Suomi · Lappi', sv: 'Finland · Lappland' },
  'FI-HA': { en: 'Finland · Häme', fi: 'Suomi · Häme', sv: 'Finland · Tavastland' },
  'FI-PP': { en: 'Finland · Bothnian coast', fi: 'Suomi · Pohjanmaan rannikko', sv: 'Finland · Österbottens kust' },
  SE: { en: 'Sweden', fi: 'Ruotsi', sv: 'Sverige' },
  NO: { en: 'Norway', fi: 'Norja', sv: 'Norge' },
  EE: { en: 'Estonia', fi: 'Viro', sv: 'Estland' },
  RU: { en: 'Russia', fi: 'Venäjä', sv: 'Ryssland' },
  'GB-SCT': { en: 'UK · Scotland', fi: 'Iso-Britannia · Skotlanti', sv: 'Storbritannien · Skottland' },
  DE: { en: 'Germany', fi: 'Saksa', sv: 'Tyskland' },
  NORDIC: { en: 'Other Nordic', fi: 'Muu Pohjoismaa', sv: 'Övriga Norden' },
  EUR: { en: 'Other European', fi: 'Muu Eurooppa', sv: 'Övriga Europa' },
  OTHER: { en: 'Other', fi: 'Muu', sv: 'Annat' },
};

export function ProfileForm({ locale, profile }: { locale: 'en' | 'fi' | 'sv'; profile: Profile }) {
  const t = useTranslations('MeProfile');
  const [saved, setSaved] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [exportRequested, setExportRequested] = useState(false);
  const [eraseRequested, setEraseRequested] = useState(false);
  const [pending, start] = useTransition();

  const onSave = (fd: FormData) => {
    fd.set('uiLocale', locale);
    start(async () => {
      const err = await saveProfile(fd);
      if (err) {
        setErrorKey(err);
        setSaved(false);
      } else {
        setSaved(true);
        setErrorKey(null);
      }
    });
  };

  const onExport = (fd: FormData) => {
    start(async () => {
      const err = await requestExport(fd);
      if (!err) setExportRequested(true);
    });
  };

  const onErase = (fd: FormData) => {
    start(async () => {
      const err = await requestErasure(fd);
      if (!err) setEraseRequested(true);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <form action={onSave} className="card card-pad" style={{ display: 'grid', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {t('nameLabel')}
          </span>
          <input
            type="text"
            name="name"
            defaultValue={profile.name ?? ''}
            maxLength={120}
            style={fieldStyle}
            autoComplete="name"
          />
          <span className="small muted">{t('nameHelp')}</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {t('localeLabel')}
          </span>
          <select name="locale" defaultValue={profile.locale} style={fieldStyle}>
            <option value="en">English</option>
            <option value="fi">Suomi</option>
            <option value="sv">Svenska</option>
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {t('homeRegionLabel')}
          </span>
          <select name="homeRegion" defaultValue={profile.homeRegion ?? ''} style={fieldStyle}>
            {REGIONS.map((r) => (
              <option key={r || 'skip'} value={r}>
                {REGION_LABELS[r]?.[locale] ?? r}
              </option>
            ))}
          </select>
          <span className="small muted">{t('homeRegionHelp')}</span>
        </label>

        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: 12,
            background: 'var(--cream)',
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            name="marketingOptIn"
            defaultChecked={Boolean(profile.preferences?.marketingOptIn)}
            style={{ accentColor: 'var(--forest)', marginTop: 3 }}
          />
          <div>
            <div className="small" style={{ fontWeight: 500 }}>{t('marketingLabel')}</div>
            <div className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>{t('marketingHelp')}</div>
          </div>
        </label>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? '…' : t('save')}
          </button>
          {saved && (
            <span role="status" aria-live="polite" style={{ color: 'var(--forest)' }}>
              ✓ {t('saved')}
            </span>
          )}
          {errorKey && (
            <span role="alert" aria-live="polite" style={{ color: 'var(--rust-on-light)' }}>
              {t('saveError')}
            </span>
          )}
        </div>
      </form>

      <section className="card card-pad">
        <h2 className="serif" style={{ fontSize: '1.467rem' }}>{t('dataTitle')}</h2>
        <p className="muted" style={{ marginTop: 6 }}>{t('dataLead')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <form action={onExport} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input type="hidden" name="userId" value={profile.id} />
            <button type="submit" className="btn btn-secondary" disabled={pending || exportRequested}>
              {exportRequested ? '✓ ' + t('exportNote') : t('exportButton')}
            </button>
            <span className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>
              {t('exportNote')}
            </span>
          </form>
          <form action={onErase} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="hidden" name="userId" value={profile.id} />
            <input
              type="text"
              name="reason"
              placeholder={locale === 'fi' ? 'Syy (valinnainen)' : locale === 'sv' ? 'Skäl (valfritt)' : 'Reason (optional)'}
              style={fieldStyle}
              maxLength={500}
            />
            <button
              type="submit"
              className="btn btn-secondary"
              style={{ color: 'var(--rust-on-light)', borderColor: 'var(--rust-on-light)' }}
              disabled={pending || eraseRequested}
            >
              {eraseRequested
                ? '✓ ' + (locale === 'fi' ? 'Pyyntö vastaanotettu' : locale === 'sv' ? 'Begäran mottagen' : 'Request received')
                : t('eraseButton')}
            </button>
            <span className="tiny" style={{ textTransform: 'none', letterSpacing: 0 }}>
              {t('eraseNote')}
            </span>
          </form>
        </div>
      </section>

      <a
        href={`/${locale}/auth/sign-out`}
        className="btn btn-ghost"
        style={{ alignSelf: 'flex-start', textDecoration: 'none' }}
      >
        ↗ {t('signOut')}
      </a>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  fontSize: '0.933rem',
  color: 'var(--ink)',
  outline: 'none',
};
