'use client';
import { useEffect, useState } from 'react';

/**
 * Floating accessibility panel mirrored from the prototype. Persists to
 * localStorage; toggles set data-* attributes on <html> that CSS reads.
 */
export function A11yPanel() {
  const [open, setOpen] = useState(false);
  const [textSize, setTextSize] = useState<'normal' | 'large'>('normal');
  const [contrast, setContrast] = useState<'normal' | 'high'>('normal');
  const [motion, setMotion] = useState<'normal' | 'reduced'>('normal');

  useEffect(() => {
    const t = localStorage.getItem('a11y.textSize') as any;
    const c = localStorage.getItem('a11y.contrast') as any;
    const m = localStorage.getItem('a11y.motion') as any;
    if (t) setTextSize(t);
    if (c) setContrast(c);
    if (m) setMotion(m);
  }, []);

  useEffect(() => {
    document.documentElement.dataset['textSize'] = textSize;
    localStorage.setItem('a11y.textSize', textSize);
  }, [textSize]);
  useEffect(() => {
    document.documentElement.dataset['contrast'] = contrast;
    localStorage.setItem('a11y.contrast', contrast);
  }, [contrast]);
  useEffect(() => {
    document.documentElement.dataset['motion'] = motion;
    localStorage.setItem('a11y.motion', motion);
  }, [motion]);

  return (
    <div className="a11y-panel" style={{ position: 'fixed', bottom: 16, left: 16, zIndex: 100 }}>
      <button aria-expanded={open} aria-controls="a11y-options" onClick={() => setOpen((v) => !v)}>
        ♿ {open ? 'Close' : 'Accessibility'}
      </button>
      {open && (
        <div
          id="a11y-options"
          role="group"
          aria-label="Accessibility options"
          style={{ background: 'white', border: '1px solid #DDE6CB', padding: 12, marginTop: 8, borderRadius: 8 }}
        >
          <label>
            <input
              type="checkbox"
              checked={textSize === 'large'}
              onChange={(e) => setTextSize(e.target.checked ? 'large' : 'normal')}
            /> Larger text
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              checked={contrast === 'high'}
              onChange={(e) => setContrast(e.target.checked ? 'high' : 'normal')}
            /> High contrast
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              checked={motion === 'reduced'}
              onChange={(e) => setMotion(e.target.checked ? 'reduced' : 'normal')}
            /> Reduce motion
          </label>
        </div>
      )}
    </div>
  );
}
