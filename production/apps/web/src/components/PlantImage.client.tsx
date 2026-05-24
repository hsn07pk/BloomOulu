'use client';

import { useState } from 'react';

/**
 * Plant thumbnail that degrades gracefully when the source URL fails to
 * load. Used by PlantCard (grid + homepage) and the homepage Featured
 * plants card.
 *
 * Why: ~half of our plant images are Wikimedia hotlinks. Failure modes
 * include 400 (non-standard thumb width), 404 (bogus file path), and
 * rate-limit timeouts. Without an onError handler the browser shows its
 * "broken image" icon + the alt text — looks like the page is broken.
 * With this component, a failed load swaps to a leaf emoji on the
 * existing colored accent, so the card looks intentional regardless of
 * the underlying image health. Robust against re-hosts, URL renames,
 * and any future image instability.
 *
 * Stays an `<img>` (not next/image) because the host list is open-ended
 * — Wikimedia today, MinIO tomorrow, iNaturalist for some — and
 * configuring all of those into next.config images.remotePatterns is
 * more brittle than just letting the browser load them.
 */
interface PlantImageProps {
  src: string;
  alt: string;
  /** Visual size — `card` (220px hero) or `thumb` (56px row icon). */
  variant?: 'card' | 'thumb';
}

export function PlantImage({ src, alt, variant = 'card' }: PlantImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: variant === 'thumb' ? 28 : 64,
        }}
      >
        🌿
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      loading="lazy"
    />
  );
}
