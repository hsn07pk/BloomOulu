import { getTranslations } from 'next-intl/server';
import { adoptAction } from './actions';

export default async function AdoptPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plant?: string }>;
}) {
  const { locale } = await params;
  const { plant } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'Adopt' });
  return (
    <form action={adoptAction} aria-labelledby="adopt-title">
      <h1 id="adopt-title">{t('title')}</h1>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="plantSlug" value={plant ?? ''} />

      <fieldset>
        <legend>{t('tier')}</legend>
        {(['seedling', 'rooted', 'vulnerable', 'endangered'] as const).map((id) => (
          <label key={id}>
            <input type="radio" name="tierId" value={id} required /> {t(`tier_${id}` as any)}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>{t('billing')}</legend>
        <label><input type="radio" name="billingInterval" value="annual" defaultChecked /> {t('annual')}</label>
        <label><input type="radio" name="billingInterval" value="monthly" /> {t('monthly')}</label>
      </fieldset>

      <fieldset>
        <legend>{t('paymentMethod')}</legend>
        <label><input type="radio" name="preferredProvider" value="mobilepay" defaultChecked /> MobilePay</label>
        <label><input type="radio" name="preferredProvider" value="paytrail" /> {t('card')}</label>
        <label><input type="radio" name="preferredProvider" value="bank_transfer" /> {t('bankTransfer')}</label>
      </fieldset>

      <fieldset>
        <legend>{t('donor')}</legend>
        <label>{t('email')}<input type="email" name="email" required /></label>
        <label>{t('name')}<input type="text" name="name" /></label>
      </fieldset>

      <button type="submit">{t('submit')}</button>
    </form>
  );
}
