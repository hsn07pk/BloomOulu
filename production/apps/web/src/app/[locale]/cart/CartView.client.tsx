'use client';
/**
 * Client view of the adoption cart. Renders each item with editable
 * tier dropdown + remove button, plus a checkout CTA that lands the
 * user in /adopt?cart=1 (the multi-item personalise+pay flow).
 *
 * Fetches plant titles on mount from /v1/plants/<slug> so cards
 * have proper names instead of raw slugs. Lazy — only the slugs in
 * the cart get fetched.
 */
import { useEffect, useState } from 'react';
import { useCart, type CartItem } from '../../../lib/cart.client';
import { isAdoptable, nonAdoptableReason } from '../../../lib/adoption';

interface Tier {
  id: CartItem['tierId'];
  name: string;
  nameFi: string;
  nameSv: string;
  annualPriceCents: number;
}

interface PlantSummary {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  latinName?: string;
  redListStatus?: string;
}

export default function CartView({
  locale,
  tiers,
  apiUrl,
}: {
  locale: string;
  tiers: Tier[];
  apiUrl: string;
}) {
  const { cart, hydrated, remove, setTier, clear } = useCart();
  const [plants, setPlants] = useState<Record<string, PlantSummary>>({});

  // Fetch plant titles for every slug in the cart.
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
          const slug = slugs[i]!;
          const data = fetched[i];
          if (data) next[slug] = { ...data, slug };
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [cart.items, hydrated, apiUrl, plants]);

  if (!hydrated) {
    return <p className="muted">Loading cart…</p>;
  }

  if (cart.items.length === 0) {
    return (
      <section
        className="card card-pad"
        style={{ textAlign: 'center', padding: '48px 24px' }}
      >
        <div aria-hidden="true" style={{ fontSize: 48, marginBottom: 12 }}>
          🌱
        </div>
        <h2 className="serif" style={{ fontSize: 24, color: 'var(--forest)' }}>
          {locale === 'fi'
            ? 'Korisi on tyhjä'
            : locale === 'sv'
              ? 'Din korg är tom'
              : 'Your cart is empty'}
        </h2>
        <p className="muted" style={{ marginTop: 8, maxWidth: 480, marginInline: 'auto' }}>
          {locale === 'fi'
            ? 'Selaa kasveja ja paina "Lisää koriin" jokaisella sivulla, jonka haluat adoptoida.'
            : locale === 'sv'
              ? 'Bläddra bland växterna och tryck "Lägg i korg" på var och en du vill adoptera.'
              : 'Browse the collection and press "Add to my cart" on each plant you want to adopt.'}
        </p>
        <a
          href={`/${locale}/plants`}
          className="btn btn-primary btn-lg"
          style={{ marginTop: 24, display: 'inline-flex' }}
        >
          {locale === 'fi' ? 'Selaa kasveja →' : locale === 'sv' ? 'Bläddra växter →' : 'Browse plants →'}
        </a>
      </section>
    );
  }

  const totalCents = cart.items.reduce((sum, item) => {
    const tier = tiers.find((t) => t.id === item.tierId);
    return sum + (tier?.annualPriceCents ?? 0);
  }, 0);
  // Checkout is blocked while any extinct plant is in the cart. Each
  // EX row gets a per-item warning above (see the article styling);
  // the summary bar shows a single global block + disables the CTA.
  const extinctItems = cart.items.filter((item) => {
    const plant = plants[item.plantSlug];
    return plant && !isAdoptable(plant.redListStatus);
  });
  const hasExtinct = extinctItems.length > 0;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {cart.items.map((item) => {
        const plant = plants[item.plantSlug];
        const tier = tiers.find((t) => t.id === item.tierId);
        const plantName =
          (locale === 'fi'
            ? plant?.nameFi
            : locale === 'sv'
              ? plant?.nameSv
              : plant?.nameEn) ||
          plant?.latinName ||
          item.plantSlug;
        const tierName =
          (locale === 'fi' ? tier?.nameFi : locale === 'sv' ? tier?.nameSv : tier?.name) ?? item.tierId;
        // Eligibility — extinct (EX) species can't be adopted. The
        // item still renders so the donor sees why their cart is
        // stuck; checkout below is disabled while any EX rows remain.
        const adoptable = plant ? isAdoptable(plant.redListStatus) : true;
        return (
          <article
            key={item.plantSlug}
            className="card card-pad"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto',
              gap: 16,
              alignItems: 'center',
              ...(adoptable
                ? {}
                : {
                    borderColor: 'var(--rust-on-light)',
                    background: 'rgba(184,81,58,0.04)',
                  }),
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: 'var(--sage-pale)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
              }}
            >
              🌿
            </div>
            <div>
              <a
                href={`/${locale}/plants/${item.plantSlug}`}
                style={{ fontSize: 18, fontFamily: 'var(--f-display)', color: 'var(--forest-deep)', textDecoration: 'none' }}
              >
                {plantName}
              </a>
              {plant?.latinName && plant.latinName !== plantName && (
                <div className="small muted" style={{ fontStyle: 'italic' }}>
                  {plant.latinName}
                </div>
              )}
              {!adoptable && (
                <div
                  className="small"
                  style={{
                    marginTop: 6,
                    color: 'var(--rust-on-light)',
                    lineHeight: 1.4,
                  }}
                >
                  ⚠{' '}
                  {locale === 'fi'
                    ? 'Ei adoptoitavissa (hävinnyt laji). Poista jatkaaksesi kassalle.'
                    : locale === 'sv'
                      ? 'Kan ej adopteras (utdöd art). Ta bort för att fortsätta.'
                      : 'Cannot be adopted (extinct species). Remove to continue.'}
                </div>
              )}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span className="muted">
                {locale === 'fi' ? 'Taso' : locale === 'sv' ? 'Nivå' : 'Tier'}
              </span>
              <select
                value={item.tierId}
                onChange={(e) => setTier(item.plantSlug, e.target.value as CartItem['tierId'])}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                  background: 'var(--cream)',
                  fontSize: 14,
                  minWidth: 180,
                }}
              >
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {(locale === 'fi' ? t.nameFi : locale === 'sv' ? t.nameSv : t.name)} ·{' '}
                    €{(t.annualPriceCents / 100).toFixed(0)}/yr
                  </option>
                ))}
              </select>
              <span className="muted small">
                €{((tier?.annualPriceCents ?? 0) / 100).toFixed(0)}/yr · {tierName}
              </span>
            </label>
            <button
              type="button"
              onClick={() => remove(item.plantSlug)}
              aria-label={`Remove ${plantName}`}
              style={{
                background: 'transparent',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '8px 12px',
                color: 'var(--rust-on-light)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {locale === 'fi' ? 'Poista' : locale === 'sv' ? 'Ta bort' : 'Remove'}
            </button>
          </article>
        );
      })}

      <div
        className="card card-pad"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 8,
          background: 'var(--sage-pale)',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="tiny">
            {locale === 'fi' ? 'Yhteensä vuodessa' : locale === 'sv' ? 'Totalt per år' : 'Annual total'}
          </div>
          <div className="serif" style={{ fontSize: 32, color: 'var(--forest-deep)' }}>
            €{(totalCents / 100).toFixed(0)}
          </div>
          <div className="small muted">
            {cart.items.length} {locale === 'fi' ? 'kasvia' : locale === 'sv' ? 'växt(er)' : 'plant(s)'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={clear}
            className="btn btn-secondary"
            style={{ background: 'transparent', borderColor: 'var(--line)' }}
          >
            {locale === 'fi' ? 'Tyhjennä kori' : locale === 'sv' ? 'Töm korg' : 'Empty cart'}
          </button>
          {hasExtinct ? (
            <button
              type="button"
              disabled
              className="btn btn-primary btn-lg"
              aria-label={
                locale === 'fi'
                  ? 'Kassalle ei voi jatkaa, koska korissa on hävinneitä lajeja'
                  : locale === 'sv'
                    ? 'Kan inte gå till kassan, korgen innehåller utdöda arter'
                    : 'Cannot check out — cart contains extinct species'
              }
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
            >
              {locale === 'fi'
                ? 'Poista hävinneet lajit jatkaaksesi'
                : locale === 'sv'
                  ? 'Ta bort utdöda arter för att fortsätta'
                  : 'Remove extinct species to continue'}
            </button>
          ) : (
            <a href={`/${locale}/cart/checkout`} className="btn btn-primary btn-lg">
              {locale === 'fi'
                ? `Kassalle (€${(totalCents / 100).toFixed(0)}) →`
                : locale === 'sv'
                  ? `Till kassan (€${(totalCents / 100).toFixed(0)}) →`
                  : `Check out €${(totalCents / 100).toFixed(0)} →`}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
