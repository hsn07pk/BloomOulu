'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getBrowserApiUrl } from '@bloomoulu/constants';
import { useFavourites } from '../../../lib/favourites.client';

/**
 * Favourite (vote) toggle for a plant.
 *
 * The persisted favourite set (useFavourites → localStorage) is the source of
 * truth for whether THIS browser has favourited the plant, so the heart stays
 * filled across refreshes + navigation and the same plant can't be favourited
 * twice. The server owns the public COUNT (deduped per visitor hash); we
 * reconcile it from the vote/unvote response. Optimistic + a brief "pop" so the
 * action feels rewarding.
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
  const { has, add, remove, hydrated } = useFavourites();
  const voted = has(slug);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState(false);

  async function toggle() {
    // Block until localStorage has hydrated so we never act on a stale
    // "not voted" assumption (which is what caused the re-vote confusion).
    if (busy || !hydrated) return;
    setBusy(true);
    const next = !voted;
    // Optimistic: persist the favourite + nudge the count.
    if (next) {
      add(slug);
      setPop(true);
      setTimeout(() => setPop(false), 320);
    } else {
      remove(slug);
    }
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    try {
      const res = await fetch(`${getBrowserApiUrl()}/v1/plants/${slug}/vote`, {
        method: next ? 'POST' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: next ? JSON.stringify({ locale }) : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        // Server is the source of truth for the public count...
        if (typeof data.voteCount === 'number') setCount(data.voteCount);
        // ...and we reconcile our persisted flag with what it recorded.
        if (typeof data.voted === 'boolean') {
          if (data.voted) add(slug);
          else remove(slug);
        }
      } else {
        // Revert the optimistic change.
        if (next) remove(slug);
        else add(slug);
        setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      }
    } catch {
      if (next) remove(slug);
      else add(slug);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="btn btn-secondary"
      aria-pressed={voted}
      aria-label={voted ? t('remove') : t('vote')}
      onClick={toggle}
      disabled={busy || !hydrated}
      style={
        voted
          ? { borderColor: 'var(--rust)', background: 'var(--rust-soft)', color: 'var(--rust-on-light)' }
          : undefined
      }
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          transition: 'transform 160ms ease',
          transform: pop ? 'scale(1.4)' : 'scale(1)',
          color: voted ? 'var(--rust)' : 'inherit',
        }}
      >
        {voted ? '♥' : '♡'}
      </span>{' '}
      {count}
    </button>
  );
}
