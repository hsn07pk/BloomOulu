'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Fixed bottom-left dock for the floating utility pills (Accessibility +
 * Feedback). It owns positioning and z-index; A11yPanel and FeedbackButton
 * render as plain flex items inside it (see globals.css `.floating-tools`),
 * stacked — Accessibility on top so its panel expands upward into empty space
 * rather than over the Feedback pill.
 *
 * Footer-aware hide: the dock is position:fixed, so without this it sits ON TOP
 * of the footer once you scroll to the end of a page. An IntersectionObserver
 * watches the footer and fades the dock out as the footer rises into the pills'
 * zone (and back when you scroll up). The negative bottom rootMargin is a "trip
 * line" ~110px from the viewport bottom: we hide only once the footer crosses
 * it, so on short pages where the footer merely peeks in the pills stay
 * reachable. Mobile turns the pills icon-only and lifts the dock above the tab
 * bar (globals.css `@media (max-width: 768px)`).
 */
export function FloatingTools({ children }: { children: ReactNode }): JSX.Element {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const footer = document.querySelector('.site-footer');
    if (!footer) return;
    const io = new IntersectionObserver(([entry]) => setHidden(entry?.isIntersecting ?? false), {
      rootMargin: '0px 0px -110px 0px',
    });
    io.observe(footer);
    return () => io.disconnect();
  }, []);

  return (
    <div className="floating-tools" data-hidden={hidden || undefined}>
      {children}
    </div>
  );
}
