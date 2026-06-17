'use client';

import { useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { donateAction } from './actions';

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

function plantName(p: DonatePlant, locale: string): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

function euro(cents: number): string {
  return (cents / 100).toLocaleString('fi-FI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function SubmitButton({ amountCents }: { amountCents: number }) {
  const t = useTranslations('Donate');
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending || amountCents <= 0}>
      {pending ? t('submitting') : t('confirmPay', { amount: euro(amountCents) })}
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

  // Amount: either one of the suggested chips, or a custom value.
  const [picked, setPicked] = useState<number | 'custom'>(
    suggested.includes(donation.defaultAmountCents) ? donation.defaultAmountCents : suggested[0]!,
  );
  const [customEuros, setCustomEuros] = useState('');
  const [provider, setProvider] = useState<Provider>(enabledProviders[0] ?? 'paytrail');

  const amountCents = useMemo(() => {
    if (picked !== 'custom') return picked;
    const n = Math.round(parseFloat(customEuros.replace(',', '.')) * 100);
    return Number.isFinite(n) ? n : 0;
  }, [picked, customEuros]);

  const amountValid = amountCents >= donation.minCents && amountCents <= donation.maxCents;
  const showTestHelp = (testMode?.paytrail && provider === 'paytrail') || (testMode?.mobilepay && provider === 'mobilepay');

  return (
    <div className="container" style={{ maxWidth: 720, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow eyebrow--rust">{t('eyebrow')}</p>
        <h1 className="serif">{title}</h1>
        <p className="muted">{t('lead')}</p>
      </header>

      <form action={donateAction} className="col" style={{ gap: 20 }}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="amountCents" value={amountValid ? amountCents : ''} />
        <input type="hidden" name="preferredProvider" value={provider} />

        {/* Amount */}
        <section className="card card-pad">
          <p className="label">{t('amountLabel')}</p>
          <div className="row" role="group" aria-label={t('amountLabel')} style={{ flexWrap: 'wrap', gap: 8 }}>
            {suggested.map((cents) => (
              <button
                type="button"
                key={cents}
                className={`pill${picked === cents ? ' active' : ''}`}
                aria-pressed={picked === cents}
                onClick={() => setPicked(cents)}
              >
                €{euro(cents)}
              </button>
            ))}
            {donation.allowCustomAmount && (
              <button
                type="button"
                className={`pill${picked === 'custom' ? ' active' : ''}`}
                aria-pressed={picked === 'custom'}
                onClick={() => setPicked('custom')}
              >
                {t('customAmount')}
              </button>
            )}
          </div>
          {picked === 'custom' && (
            <label className="col" style={{ gap: 4, marginTop: 12 }}>
              <span className="small muted">{t('customAmountLabel')}</span>
              <input
                inputMode="decimal"
                className="input"
                placeholder={t('customAmountPlaceholder')}
                value={customEuros}
                onChange={(e) => setCustomEuros(e.target.value)}
                aria-describedby="amount-hint"
              />
            </label>
          )}
          <p id="amount-hint" className={`tiny ${amountValid || amountCents === 0 ? 'muted' : 'eyebrow--rust'}`} style={{ marginTop: 8 }}>
            {t('minMaxHint', { min: euro(donation.minCents), max: euro(donation.maxCents) })}
          </p>
        </section>

        {/* Optional species */}
        <section className="card card-pad">
          <label className="col" style={{ gap: 6 }}>
            <span className="label">{t('speciesLabel')}</span>
            <select name="plantSlug" className="input" defaultValue={presetPlantSlug ?? ''}>
              <option value="">{t('speciesGeneral')}</option>
              {plants.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {plantName(p, locale)}
                </option>
              ))}
            </select>
            <span className="tiny muted">{t('speciesHint')}</span>
          </label>
        </section>

        {/* Dedication + donor */}
        <section className="card card-pad col" style={{ gap: 14 }}>
          <p className="label">{t('donorTitle')}</p>
          <label className="col" style={{ gap: 4 }}>
            <span className="small muted">{t('email')}</span>
            <input type="email" name="email" required className="input" placeholder={t('emailPlaceholder')} />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="small muted">{t('name')}</span>
            <input type="text" name="name" className="input" placeholder={t('namePlaceholder')} maxLength={120} />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="small muted">{t('dedicationLabel')}</span>
            <input
              type="text"
              name="dedication"
              className="input"
              placeholder={t('dedicationPlaceholder')}
              maxLength={donation.dedicationMaxChars}
            />
          </label>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" name="anonymous" value="true" />
            <span className="small">{t('anonymousLabel')}</span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" name="marketingOptIn" value="true" />
            <span className="small">{t('marketingOptIn')}</span>
          </label>
        </section>

        {/* Payment method */}
        {enabledProviders.length > 1 && (
          <section className="card card-pad col" style={{ gap: 10 }}>
            <p className="label">{t('paymentMethod')}</p>
            {enabledProviders.includes('paytrail') && (
              <label className="row between" style={{ gap: 8 }}>
                <span>
                  <strong>{t('card')}</strong>
                  <br />
                  <span className="tiny muted">{t('cardSubtitle')}</span>
                </span>
                <input
                  type="radio"
                  name="providerChoice"
                  checked={provider === 'paytrail'}
                  onChange={() => setProvider('paytrail')}
                />
              </label>
            )}
            {enabledProviders.includes('mobilepay') && (
              <label className="row between" style={{ gap: 8 }}>
                <span>
                  <strong>{t('mobilepay')}</strong>
                  <br />
                  <span className="tiny muted">{t('mobilepaySubtitle')}</span>
                </span>
                <input
                  type="radio"
                  name="providerChoice"
                  checked={provider === 'mobilepay'}
                  onChange={() => setProvider('mobilepay')}
                />
              </label>
            )}
          </section>
        )}

        {showTestHelp && (
          <p className="tiny muted" role="note">
            {t('testModeBanner')}
          </p>
        )}

        <SubmitButton amountCents={amountValid ? amountCents : 0} />

        <p className="tiny muted center">
          {t('vatExempt')}{' '}
          <a href={`/${locale}${donation.fundsFlowUrl}`}>{t('whereYourGiftGoes')}</a>
        </p>
      </form>
    </div>
  );
}
