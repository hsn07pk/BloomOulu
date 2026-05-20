'use client';
/**
 * Multi-item checkout form. Reads the cart from localStorage, shows
 * each item with its tier + price, collects donor identity (email,
 * name, country, locale, optional postal address), and POSTs to
 * /v1/adoptions/bundle. On success the user is redirected to the
 * provider's hosted checkout (Paytrail / MobilePay).
 *
 * The user can still edit tiers and remove items here — useful when
 * they had second thoughts on the /cart page and want one more pass.
 */
import { useEffect, useState } from 'react';
import { useCart, type CartItem } from '../../../../lib/cart.client';

interface Tier {
  id: CartItem['tierId'];
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
  monthlyPriceCents?: number | null;
}

type BillingInterval = 'monthly' | 'annual' | 'one_time';
type ProviderId = 'paytrail' | 'bank_transfer' | 'mobilepay';

interface PlantSummary {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  latinName?: string;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'redirecting'; url: string }
  | { kind: 'error'; message: string };

const L = {
  email: { fi: 'Sähköposti', sv: 'E-post', en: 'Email' },
  name: { fi: 'Nimesi (näkyy vihkossa)', sv: 'Ditt namn (visas på donatorlistan)', en: 'Your name (shown on the donor wall)' },
  country: { fi: 'Maa', sv: 'Land', en: 'Country' },
  intervalLabel: {
    fi: 'Maksuväli',
    sv: 'Betalningsintervall',
    en: 'How would you like to pay?',
  },
  monthly: { fi: 'Kuukausittain', sv: 'Månadsvis', en: 'Monthly' },
  annual: { fi: 'Vuosittain', sv: 'Årligen', en: 'Annually' },
  oneTime: { fi: 'Kertamaksu', sv: 'Engångsbetalning', en: 'One time' },
  showOnWall: {
    fi: 'Näytä nimeni adoptoijien seinällä',
    sv: 'Visa mitt namn på adopterarvägg',
    en: 'Show my name on the donor wall',
  },
  monthlyNote: {
    fi: 'Veloitetaan joka kuukausi · perut milloin tahansa /omasta puutarhastani.',
    sv: 'Dras varje månad · avbryt när som helst i Min trädgård.',
    en: 'Charged every month · cancel any time from My Garden.',
  },
  annualNote: {
    fi: 'Veloitetaan kerran vuodessa · uusiutuu automaattisesti.',
    sv: 'Dras en gång om året · förnyas automatiskt.',
    en: 'Charged once a year · auto-renews so the adoption stays active.',
  },
  oneTimeNote: {
    fi: 'Yksi maksu, ei uusiutumista. Adoptio päättyy vuoden kuluttua.',
    sv: 'En enda betalning, ingen förnyelse. Adoptionen löper ut efter ett år.',
    en: 'A single charge with no renewal. The adoption ends after one year.',
  },
  payMethodLabel: {
    fi: 'Maksutapa',
    sv: 'Betalningsmetod',
    en: 'Payment method',
  },
  payCard: {
    fi: 'Kortti tai pankkimaksu',
    sv: 'Kort eller bank',
    en: 'Card or online bank',
  },
  payCardSub: {
    fi: 'Visa, Mastercard, Nordea, OP, Aktia, Danske, Säästöpankki, Ålandsbanken…',
    sv: 'Visa, Mastercard, Nordea, OP, Aktia, Danske, Sparbanken, Ålandsbanken…',
    en: 'Visa, Mastercard, Nordea, OP, Aktia, Danske, Säästöpankki, Ålandsbanken…',
  },
  payBank: {
    fi: 'SEPA-tilisiirto',
    sv: 'SEPA-överföring',
    en: 'SEPA bank transfer',
  },
  payBankSub: {
    fi: 'Saat IBAN-tiedot ja RF-viitteen. Adoptio aktivoituu kun maksu kirjautuu.',
    sv: 'Du får IBAN-uppgifter och RF-referens. Adoptionen aktiveras när betalningen syns.',
    en: 'You receive the IBAN + RF reference. Activates when the transfer clears.',
  },
  payMobile: {
    fi: 'MobilePay',
    sv: 'MobilePay',
    en: 'MobilePay',
  },
  payMobileSub: {
    fi: 'Tulossa pian.',
    sv: 'Kommer snart.',
    en: 'Coming soon.',
  },
  pay: { fi: 'Maksa', sv: 'Betala', en: 'Pay' },
  perYear: { fi: '/vuosi', sv: '/år', en: '/yr' },
  perMonth: { fi: '/kk', sv: '/mån', en: '/mo' },
  once: { fi: 'kerran', sv: 'engång', en: 'once' },
  empty: {
    fi: 'Korisi on tyhjä. Lisää kasveja ennen kassalle siirtymistä.',
    sv: 'Din korg är tom. Lägg till växter innan du går till kassan.',
    en: 'Your cart is empty. Add plants before checking out.',
  },
};

export default function CheckoutForm({
  locale,
  tiers,
  intervalsEnabled,
  apiUrl,
}: {
  locale: string;
  tiers: Tier[];
  intervalsEnabled: Array<'monthly' | 'annual' | 'one_time'>;
  apiUrl: string;
}) {
  const { cart, hydrated, remove, setTier } = useCart();
  const [plants, setPlants] = useState<Record<string, PlantSummary>>({});
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('FI');
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(
    (intervalsEnabled[0] ?? 'monthly') as BillingInterval,
  );
  const [provider, setProvider] = useState<ProviderId>('paytrail');
  const [showOnDonorWall, setShowOnDonorWall] = useState(true);
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  const recurring = billingInterval !== 'one_time';

  const lang: 'en' | 'fi' | 'sv' = locale === 'fi' ? 'fi' : locale === 'sv' ? 'sv' : 'en';

  useEffect(() => {
    if (!hydrated) return;
    const slugs = cart.items.map((i) => i.plantSlug).filter((s) => !(s in plants));
    if (slugs.length === 0) return;
    let cancelled = false;
    (async () => {
      const fetched = await Promise.all(
        slugs.map(async (slug) => {
          try {
            const res = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/plants/${slug}`);
            return res.ok ? ((await res.json()) as PlantSummary) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setPlants((prev) => {
        const next = { ...prev };
        for (let i = 0; i < slugs.length; i++) {
          const data = fetched[i];
          if (data) next[slugs[i]!] = { ...data, slug: slugs[i]! };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [cart.items, hydrated, apiUrl, plants]);

  if (!hydrated) {
    return <p className="muted">Loading…</p>;
  }
  if (cart.items.length === 0) {
    return (
      <section className="card card-pad" style={{ textAlign: 'center' }}>
        <p className="muted">{L.empty[lang]}</p>
        <a href={`/${locale}/plants`} className="btn btn-primary" style={{ marginTop: 16 }}>
          {lang === 'fi' ? 'Selaa kasveja' : lang === 'sv' ? 'Bläddra växter' : 'Browse plants'}
        </a>
      </section>
    );
  }

  // Per-item price honouring the chosen billing interval. Monthly falls
  // back to annual for any tier that doesn't advertise monthlyPriceCents
  // (so the donor always gets *some* price). For one_time we charge the
  // annual amount; the adoption simply doesn't auto-renew.
  const priceForItem = (item: CartItem): number => {
    const tier = tiers.find((t) => t.id === item.tierId);
    if (!tier) return 0;
    if (billingInterval === 'monthly' && tier.monthlyPriceCents) {
      return tier.monthlyPriceCents;
    }
    return tier.annualPriceCents;
  };
  const totalCents = cart.items.reduce((sum, item) => sum + priceForItem(item), 0);
  const intervalSuffix =
    billingInterval === 'monthly' ? L.perMonth[lang]
    : billingInterval === 'annual' ? L.perYear[lang]
    : ` ${L.once[lang]}`;
  const intervalNote =
    billingInterval === 'monthly' ? L.monthlyNote[lang]
    : billingInterval === 'annual' ? L.annualNote[lang]
    : L.oneTimeNote[lang];
  // If monthly is selected but some cart items don't have a monthly
  // price, surface a small note so the donor knows those default back
  // to the annual amount.
  const itemsWithoutMonthly = billingInterval === 'monthly'
    ? cart.items.filter((it) => {
        const tier = tiers.find((t) => t.id === it.tierId);
        return tier && !tier.monthlyPriceCents;
      })
    : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setState({ kind: 'error', message: lang === 'fi' ? 'Tarkista sähköpostiosoite.' : lang === 'sv' ? 'Kontrollera e-postadressen.' : 'Please enter a valid email.' });
      return;
    }
    setState({ kind: 'submitting' });
    try {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/adoptions/bundle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: cart.items.map((it) => ({ plantSlug: it.plantSlug, tierId: it.tierId })),
          recurring,
          billingInterval,
          donor: {
            email: email.trim(),
            name: name.trim() || undefined,
            locale: lang,
            countryCode: country,
          },
          showOnDonorWall,
          // Sent as the donor's explicit preference; the router still
          // falls back to bank_transfer if Paytrail is disabled in admin.
          preferredProvider: provider,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: 'error', message: data?.message ?? data?.error ?? `HTTP ${res.status}` });
        return;
      }
      if (!data.redirectUrl) {
        setState({ kind: 'error', message: 'No redirect URL returned' });
        return;
      }
      // Clear the cart so the donor doesn't see the items still listed
      // if they back-button after paying. We keep the form here in case
      // the gateway redirects back with cancel.
      try {
        localStorage.removeItem('bloomoulu.cart.v1');
      } catch {/* ignore */}
      setState({ kind: 'redirecting', url: data.redirectUrl });
      window.location.href = data.redirectUrl;
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message });
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      {/* ── Cart items ──────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cart.items.map((item) => {
          const plant = plants[item.plantSlug];
          const tier = tiers.find((t) => t.id === item.tierId);
          const plantName =
            (lang === 'fi' ? plant?.nameFi : lang === 'sv' ? plant?.nameSv : plant?.nameEn) ||
            plant?.latinName ||
            item.plantSlug;
          return (
            <article
              key={item.plantSlug}
              className="card card-pad"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'var(--sage-pale)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                }}
              >
                🌿
              </div>
              <div>
                <div style={{ fontFamily: 'var(--f-display)', color: 'var(--forest-deep)', fontSize: 17 }}>
                  {plantName}
                </div>
                {plant?.latinName && plant.latinName !== plantName && (
                  <div className="small muted" style={{ fontStyle: 'italic' }}>
                    {plant.latinName}
                  </div>
                )}
              </div>
              <select
                value={item.tierId}
                onChange={(e) => setTier(item.plantSlug, e.target.value as CartItem['tierId'])}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--line)',
                  background: 'var(--cream)',
                  fontSize: 13,
                }}
              >
                {tiers.map((t) => {
                  const cents = billingInterval === 'monthly' && t.monthlyPriceCents
                    ? t.monthlyPriceCents
                    : t.annualPriceCents;
                  const suffix = billingInterval === 'monthly' && t.monthlyPriceCents
                    ? L.perMonth[lang]
                    : billingInterval === 'one_time'
                      ? ''
                      : L.perYear[lang];
                  return (
                    <option key={t.id} value={t.id}>
                      {(lang === 'fi' ? t.nameFi : lang === 'sv' ? t.nameSv : t.name)} ·{' '}
                      €{(cents / 100).toFixed(0)}{suffix}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => remove(item.plantSlug)}
                aria-label="Remove"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  color: 'var(--rust-on-light)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                ×
              </button>
            </article>
          );
        })}
      </section>

      {/* ── Donor identity ──────────────────────────────────── */}
      <section className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: 'var(--forest)' }}>{L.email[lang]}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: 'var(--forest)' }}>{L.name[lang]}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: 'var(--forest)' }}>{L.country[lang]}</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle}>
            <option value="FI">Finland</option>
            <option value="SE">Sverige</option>
            <option value="NO">Norge</option>
            <option value="DK">Danmark</option>
            <option value="DE">Deutschland</option>
            <option value="EE">Eesti</option>
            <option value="GB">United Kingdom</option>
            <option value="US">United States</option>
          </select>
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontSize: 13, color: 'var(--forest)', marginBottom: 4 }}>
            {L.intervalLabel[lang]}
          </legend>
          <div role="radiogroup" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(intervalsEnabled as BillingInterval[]).map((opt) => {
              const active = billingInterval === opt;
              const label = opt === 'monthly' ? L.monthly[lang] : opt === 'annual' ? L.annual[lang] : L.oneTime[lang];
              return (
                <button
                  type="button"
                  key={opt}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setBillingInterval(opt)}
                  style={{
                    flex: '1 1 30%',
                    minWidth: 120,
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: active ? '2px solid var(--forest)' : '1px solid var(--line)',
                    background: active ? 'var(--sage-pale)' : 'var(--cream)',
                    color: active ? 'var(--forest-deep)' : 'var(--ink)',
                    fontSize: 14,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="small muted" style={{ marginTop: 6, lineHeight: 1.45 }}>
            {intervalNote}
          </p>
          {itemsWithoutMonthly.length > 0 && (
            <p className="small" style={{ color: 'var(--rust-on-light)', marginTop: 4 }}>
              {lang === 'fi'
                ? `Huom: ${itemsWithoutMonthly.length} kasvilla ei ole kuukausihintaa — niitä veloitetaan vuosihinnalla.`
                : lang === 'sv'
                  ? `Obs: ${itemsWithoutMonthly.length} växt(er) saknar månadspris och debiteras till årspriset.`
                  : `Note: ${itemsWithoutMonthly.length} item(s) don’t offer a monthly price and will be charged at the annual rate.`}
            </p>
          )}
        </fieldset>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontSize: 13, color: 'var(--forest)', marginBottom: 4 }}>
            {L.payMethodLabel[lang]}
          </legend>
          <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {([
              { id: 'paytrail' as ProviderId, title: L.payCard[lang], sub: L.payCardSub[lang], disabled: false, badge: '' },
              { id: 'bank_transfer' as ProviderId, title: L.payBank[lang], sub: L.payBankSub[lang], disabled: false, badge: '' },
              { id: 'mobilepay' as ProviderId, title: L.payMobile[lang], sub: L.payMobileSub[lang], disabled: true, badge: lang === 'fi' ? 'Tulossa' : lang === 'sv' ? 'Snart' : 'Soon' },
            ]).map((opt) => {
              const active = provider === opt.id;
              return (
                <button
                  type="button"
                  key={opt.id}
                  role="radio"
                  aria-checked={active}
                  aria-disabled={opt.disabled}
                  disabled={opt.disabled}
                  onClick={() => !opt.disabled && setProvider(opt.id)}
                  style={{
                    textAlign: 'left',
                    padding: '14px 16px',
                    borderRadius: 12,
                    border: active ? '2px solid var(--forest)' : '1px solid var(--line)',
                    background: opt.disabled ? '#F5F2E8' : active ? 'var(--sage-pale)' : 'var(--cream)',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    opacity: opt.disabled ? 0.55 : 1,
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr auto',
                    columnGap: 14,
                    alignItems: 'center',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: `2px solid ${active ? 'var(--forest)' : 'var(--line)'}`,
                      background: active ? 'var(--forest)' : 'transparent',
                      boxShadow: active ? 'inset 0 0 0 3px var(--cream)' : 'none',
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: active ? 600 : 500, color: 'var(--forest-deep)', fontSize: 15 }}>
                      {opt.title}
                    </div>
                    <div className="small muted" style={{ marginTop: 2, lineHeight: 1.4 }}>
                      {opt.sub}
                    </div>
                  </div>
                  {opt.badge && (
                    <span
                      className="tiny"
                      style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: 'var(--paper)',
                        border: '1px solid var(--line)',
                        color: 'var(--ink)',
                      }}
                    >
                      {opt.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.4 }}>
          <input
            type="checkbox"
            checked={showOnDonorWall}
            onChange={(e) => setShowOnDonorWall(e.target.checked)}
            style={{ marginTop: 4 }}
          />
          <span>{L.showOnWall[lang]}</span>
        </label>
      </section>

      {/* ── Summary + CTA ───────────────────────────────────── */}
      <section
        className="card card-pad"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--sage-pale)',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="tiny">
            {lang === 'fi' ? 'Maksettava yhteensä' : lang === 'sv' ? 'Totalt att betala' : 'Total to pay'}
          </div>
          <div className="serif" style={{ fontSize: 32, color: 'var(--forest-deep)' }}>
            €{(totalCents / 100).toFixed(0)}
            <span className="small muted" style={{ marginLeft: 6, fontFamily: 'var(--f-body)' }}>
              {intervalSuffix}
            </span>
          </div>
          <div className="small muted">
            {cart.items.length} {lang === 'fi' ? 'kasvia' : lang === 'sv' ? 'växt(er)' : 'plant(s)'}
          </div>
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={state.kind === 'submitting' || state.kind === 'redirecting'}
        >
          {state.kind === 'submitting'
            ? lang === 'fi' ? 'Käsitellään…' : lang === 'sv' ? 'Bearbetar…' : 'Processing…'
            : state.kind === 'redirecting'
              ? lang === 'fi' ? 'Ohjataan…' : lang === 'sv' ? 'Omdirigerar…' : 'Redirecting…'
              : `${L.pay[lang]} €${(totalCents / 100).toFixed(0)} →`}
        </button>
      </section>

      {state.kind === 'error' && (
        <p
          role="alert"
          className="card card-pad"
          style={{ background: '#FFF3EE', color: '#B8513A', border: '1px solid #B8513A' }}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--cream)',
  fontSize: 15,
  color: 'var(--forest-deep)',
};
