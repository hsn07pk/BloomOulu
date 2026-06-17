'use client';

import { useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { donateAction } from './actions';
import { SpeciesSearch, type SpeciesLite } from './species-search.client';

export interface DonatePlant {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus?: string | null;
}

export interface DonateSettings {
  suggestedAmountsCents: number[];
  defaultAmountCents: number;
  allowCustomAmount: boolean;
  minCents: number;
  maxCents: number;
  dedicationMaxChars: number;
  fundsFlowUrl: string;
}

type Provider = 'paytrail' | 'mobilepay';

function euro(cents: number): string {
  return (cents / 100).toLocaleString('fi-FI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function SubmitButton({ amountCents }: { amountCents: number }) {
  const t = useTranslations('Donate');
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending || amountCents <= 0}>
      {pending ? t('submitting') : `${t('confirmPay', { amount: euro(amountCents) })} →`}
    </button>
  );
}

export function DonateForm({
  locale,
  title,
  plants,
  presetPlantSlug,
  donation,
  enabledProviders,
  testMode,
}: {
  locale: string;
  title: string;
  plants: DonatePlant[];
  presetPlantSlug: string | null;
  donation: DonateSettings;
  enabledProviders: Provider[];
  testMode?: { paytrail?: boolean; mobilepay?: boolean };
}) {
  const t = useTranslations('Donate');

  const suggested = donation.suggestedAmountsCents.length
    ? donation.suggestedAmountsCents
    : [500, 1500, 2500, 5000];

  const [picked, setPicked] = useState<number | 'custom'>(
    suggested.includes(donation.defaultAmountCents) ? donation.defaultAmountCents : suggested[0]!,
  );
  const [customEuros, setCustomEuros] = useState('');
  const [provider, setProvider] = useState<Provider>(enabledProviders[0] ?? 'paytrail');
  const [moreOpen, setMoreOpen] = useState(false);

  const amountCents = useMemo(() => {
    if (picked !== 'custom') return picked;
    const n = Math.round(parseFloat(customEuros.replace(',', '.')) * 100);
    return Number.isFinite(n) ? n : 0;
  }, [picked, customEuros]);

  const amountValid = amountCents >= donation.minCents && amountCents <= donation.maxCents;
  const showTestHelp =
    (testMode?.paytrail && provider === 'paytrail') || (testMode?.mobilepay && provider === 'mobilepay');

  const suggestions: SpeciesLite[] = plants.slice(0, 8);
  const preset = (presetPlantSlug && plants.find((p) => p.slug === presetPlantSlug)) || null;

  return (
    <div className="donate-shell fade-in">
      <header style={{ marginBottom: 28 }}>
        <p className="eyebrow eyebrow--rust">{t('eyebrow')}</p>
        <h1 className="serif" style={{ fontSize: 'clamp(32px, 6vw, 44px)', lineHeight: 1.05, marginTop: 8 }}>
          {title}
        </h1>
        <p className="muted" style={{ marginTop: 12, lineHeight: 1.55 }}>{t('lead')}</p>
      </header>

      <form action={donateAction} className="field" style={{ gap: 28 }}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="amountCents" value={amountValid ? amountCents : ''} />
        <input type="hidden" name="preferredProvider" value={provider} />

        {/* Amount */}
        <section className="field" style={{ gap: 12 }}>
          <span className="label">{t('amountLabel')}</span>
          <div className="choice-row" role="group" aria-label={t('amountLabel')}>
            {suggested.map((cents) => (
              <button
                type="button"
                key={cents}
                className="amount-chip"
                aria-pressed={picked === cents}
                onClick={() => setPicked(cents)}
              >
                €{euro(cents)}
              </button>
            ))}
            {donation.allowCustomAmount && (
              <button
                type="button"
                className="amount-chip"
                aria-pressed={picked === 'custom'}
                onClick={() => setPicked('custom')}
              >
                {t('customAmount')}
              </button>
            )}
          </div>
          {picked === 'custom' && (
            <label className="field" style={{ marginTop: 4 }}>
              <span className="tiny muted" style={{ letterSpacing: 0, textTransform: 'none' }}>
                {t('customAmountLabel')}
              </span>
              <input
                inputMode="decimal"
                className="input"
                placeholder={t('customAmountPlaceholder')}
                value={customEuros}
                onChange={(e) => setCustomEuros(e.target.value)}
                autoFocus
              />
            </label>
          )}
          {picked === 'custom' && !amountValid && (
            <span className="tiny eyebrow--rust" style={{ letterSpacing: 0, textTransform: 'none' }}>
              {t('minMaxHint', { min: euro(donation.minCents), max: euro(donation.maxCents) })}
            </span>
          )}
        </section>

        {/* Optional directed species */}
        <section className="field" style={{ gap: 10 }}>
          <p className="small" style={{ color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            <span aria-hidden="true" style={{ color: 'var(--rust-on-light)' }}>♥ </span>
            {t('conservationLine')}
          </p>
          <SpeciesSearch locale={locale} suggestions={suggestions} preset={preset} />
        </section>

        {/* Donor details */}
        <section className="field" style={{ gap: 14 }}>
          <span className="label">{t('donorTitle')}</span>
          <label className="field">
            <span className="tiny muted" style={{ letterSpacing: 0, textTransform: 'none' }}>{t('email')}</span>
            <input type="email" name="email" required className="input" placeholder={t('emailPlaceholder')} />
          </label>
          <label className="field">
            <span className="tiny muted" style={{ letterSpacing: 0, textTransform: 'none' }}>{t('name')}</span>
            <input type="text" name="name" className="input" placeholder={t('namePlaceholder')} maxLength={120} />
          </label>
        </section>

        {/* More options (dedication / anonymity / consent) */}
        <section className="field" style={{ gap: 12 }}>
          <button
            type="button"
            className="disclosure-toggle"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            <span className="caret" aria-hidden="true">▸</span>
            {t('moreOptions')}
          </button>
          {moreOpen && (
            <div className="disclosure-body field" style={{ gap: 14 }}>
              <label className="field">
                <span className="tiny muted" style={{ letterSpacing: 0, textTransform: 'none' }}>{t('dedicationLabel')}</span>
                <input
                  type="text"
                  name="dedication"
                  className="input"
                  placeholder={t('dedicationPlaceholder')}
                  maxLength={donation.dedicationMaxChars}
                />
              </label>
              <label className="checkrow">
                <input type="checkbox" name="anonymous" value="true" />
                <span className="small">{t('anonymousLabel')}</span>
              </label>
              <label className="checkrow">
                <input type="checkbox" name="marketingOptIn" value="true" />
                <span className="small">{t('marketingOptIn')}</span>
              </label>
            </div>
          )}
        </section>

        {/* Payment method — only when more than one rail is enabled */}
        {enabledProviders.length > 1 && (
          <section className="field" style={{ gap: 10 }}>
            <span className="label">{t('paymentMethod')}</span>
            <div className="choice-row">
              {enabledProviders.includes('paytrail') && (
                <button
                  type="button"
                  className="amount-chip"
                  style={{ fontFamily: 'var(--f-body)', fontSize: '0.95rem' }}
                  aria-pressed={provider === 'paytrail'}
                  onClick={() => setProvider('paytrail')}
                >
                  {t('card')}
                </button>
              )}
              {enabledProviders.includes('mobilepay') && (
                <button
                  type="button"
                  className="amount-chip"
                  style={{ fontFamily: 'var(--f-body)', fontSize: '0.95rem' }}
                  aria-pressed={provider === 'mobilepay'}
                  onClick={() => setProvider('mobilepay')}
                >
                  {t('mobilepay')}
                </button>
              )}
            </div>
          </section>
        )}

        {showTestHelp && (
          <p className="tiny muted" role="note" style={{ letterSpacing: 0, textTransform: 'none' }}>
            {t('testModeBanner')}
          </p>
        )}

        <SubmitButton amountCents={amountValid ? amountCents : 0} />

        <p className="trust-line">
          {t('trustLine')}
          <br />
          <a href={`/${locale}${donation.fundsFlowUrl}`}>{t('whereYourGiftGoes')}</a>
        </p>
      </form>
    </div>
  );
}
