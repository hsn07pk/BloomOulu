'use client';
/**
 * Favourite (vote) memory — a localStorage-backed list of the plant slugs this
 * browser has favourited (♥).
 *
 * Why this exists: the server owns the public vote COUNT, but it dedups votes
 * by an anonymous visitor hash (IP + UA) and exposes no "have I voted?" read.
 * Without a client-side memory the ♥ resets to empty on every mount — so a
 * refresh looked like it un-favourited the plant, and the same plant could be
 * "favourited" again (the server silently deduped, leaving the count unchanged
 * but the UI confusing). This list is that memory.
 *
 * Same-tab sync: writes broadcast a custom DOM event so every consumer (the
 * plant-page button + the favourites leaderboard) updates immediately. The
 * browser's native `storage` event covers cross-tab sync.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'bloomoulu.favourites.v1';
const CHANGE_EVENT = 'bloomoulu:favourites-changed';

function readSlugs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeSlugs(slugs: string[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs));
    // Deferred to the next microtask so a consumer writing during render
    // doesn't setState on a different consumer mid-commit (React warns).
    queueMicrotask(() => window.dispatchEvent(new CustomEvent(CHANGE_EVENT)));
  } catch {
    /* quota exceeded / private mode: ignore */
  }
}

/**
 * React hook for the visitor's favourite set. Hydrates from localStorage on
 * mount and stays in sync across components in the same tab (custom event)
 * and across tabs (native storage event).
 */
export function useFavourites() {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSlugs(readSlugs());
    setHydrated(true);
    const refresh = () => setSlugs(readSlugs());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
  }, []);

  const has = useCallback((slug: string) => slugs.includes(slug), [slugs]);

  const add = useCallback((slug: string) => {
    setSlugs((prev) => {
      if (prev.includes(slug)) return prev;
      const next = [...prev, slug];
      writeSlugs(next);
      return next;
    });
  }, []);

  const remove = useCallback((slug: string) => {
    setSlugs((prev) => {
      if (!prev.includes(slug)) return prev;
      const next = prev.filter((s) => s !== slug);
      writeSlugs(next);
      return next;
    });
  }, []);

  return { has, add, remove, hydrated, count: slugs.length };
}
