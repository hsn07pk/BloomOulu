'use client';
/**
 * Adoption cart — a tiny localStorage-backed store the donor can fill
 * across multiple browse sessions, then check out in one go.
 *
 * Shape:
 *   { items: [{ plantSlug, tierId, addedAt }], updatedAt }
 *
 * Why localStorage and not a server-side cart?
 *   • Visitors can add plants while signed out — no account required.
 *   • Survives navigation without a server round-trip on every click.
 *   • Clears cleanly on sign-out or after a successful adoption.
 *
 * Cross-tab sync: useCart subscribes to the `storage` event so when
 * the user adds a plant in one tab, the badge in other tabs updates.
 */
import { useCallback, useEffect, useState } from 'react';

export interface CartItem {
  plantSlug: string;
  tierId: 'seedling' | 'rooted' | 'vulnerable' | 'endangered' | 'corporate';
  addedAt: number;
}

export interface CartState {
  items: CartItem[];
  updatedAt: number;
}

const STORAGE_KEY = 'bloomoulu.cart.v1';

function emptyCart(): CartState {
  return { items: [], updatedAt: 0 };
}

function readCart(): CartState {
  if (typeof window === 'undefined') return emptyCart();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw) as CartState;
    if (!parsed || !Array.isArray(parsed.items)) return emptyCart();
    return parsed;
  } catch {
    return emptyCart();
  }
}

function writeCart(c: CartState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* quota exceeded / private mode: ignore */
  }
}

/** React hook for read+write access to the cart. Re-renders all
 *  consumers when the cart changes (in this tab via setState, in
 *  other tabs via the storage event). */
export function useCart() {
  const [cart, setCart] = useState<CartState>(emptyCart);
  const [hydrated, setHydrated] = useState(false);

  // First render is server-side; hydrate on mount.
  useEffect(() => {
    setCart(readCart());
    setHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCart(readCart());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((plantSlug: string, tierId: CartItem['tierId'] = 'seedling') => {
    setCart((prev) => {
      const items = prev.items.filter((i) => i.plantSlug !== plantSlug);
      items.push({ plantSlug, tierId, addedAt: Date.now() });
      const next = { items, updatedAt: Date.now() };
      writeCart(next);
      return next;
    });
  }, []);

  const remove = useCallback((plantSlug: string) => {
    setCart((prev) => {
      const next = {
        items: prev.items.filter((i) => i.plantSlug !== plantSlug),
        updatedAt: Date.now(),
      };
      writeCart(next);
      return next;
    });
  }, []);

  const setTier = useCallback((plantSlug: string, tierId: CartItem['tierId']) => {
    setCart((prev) => {
      const next = {
        items: prev.items.map((i) =>
          i.plantSlug === plantSlug ? { ...i, tierId } : i,
        ),
        updatedAt: Date.now(),
      };
      writeCart(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    const next = emptyCart();
    next.updatedAt = Date.now();
    writeCart(next);
    setCart(next);
  }, []);

  const has = useCallback(
    (plantSlug: string) => cart.items.some((i) => i.plantSlug === plantSlug),
    [cart],
  );

  return { cart, count: cart.items.length, hydrated, add, remove, setTier, clear, has };
}
