'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getBrowserApiUrl } from '@bloomoulu/constants';

/**
 * Favourite (vote) toggle for a plant. Anonymous + idempotent on the server
 * (one vote per visitor hash); we keep optimistic local state so the heart
 * fills instantly. Locale is sent for signage analytics.
 */
export function VoteButton({
  slug,
  initialCount,
  locale,
}: {
  slug: string;
  initialCount: number;
  locale: string;
}) {
  const t = useTranslations('Favourites');
  const [voted, setVoted] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !voted;
    // Optimistic.
    setVoted(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = await fetch(`${getBrowserApiUrl()}/v1/plants/${slug}/vote`, {
        method: next ? 'POST' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: next ? JSON.stringify({ locale }) : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.voteCount === 'number') setCount(data.voteCount);
        setVoted(Boolean(data.voted));
      } else {
        // Roll back on failure.
        setVoted(!next);
        setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      }
    } catch {
      setVoted(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`btn btn-secondary${voted ? ' active' : ''}`}
      aria-pressed={voted}
      aria-label={voted ? t('remove') : t('vote')}
      onClick={toggle}
      disabled={busy}
    >
      <span aria-hidden="true">{voted ? '♥' : '♡'}</span> {count}
    </button>
  );
}
