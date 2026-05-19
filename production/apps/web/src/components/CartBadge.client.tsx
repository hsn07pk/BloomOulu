'use client';
/**
 * Tiny cart indicator for the top nav. Shows the current number of
 * plants the visitor has selected for adoption, links to /cart.
 *
 * Hidden until hydrated to avoid a server/client mismatch on the
 * first render (the server has no localStorage access).
 */
import { useCart } from '../lib/cart.client';

export default function CartBadge({ locale }: { locale: string }) {
  const { count, hydrated } = useCart();
  if (!hydrated || count === 0) return null;
  return (
    <a
      href={`/${locale}/cart`}
      aria-label={`Adoption cart, ${count} item${count === 1 ? '' : 's'}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 999,
        background: 'var(--sage-pale)',
        color: 'var(--forest-deep)',
        textDecoration: 'none',
        fontSize: 14,
        fontWeight: 500,
        border: '1px solid var(--line)',
      }}
    >
      <span aria-hidden="true">🌿</span>
      <span>{count}</span>
    </a>
  );
}
