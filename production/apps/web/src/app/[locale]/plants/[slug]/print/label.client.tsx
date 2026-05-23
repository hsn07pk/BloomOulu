'use client';

/**
 * Printable QR label — pure presentation. All dimensions arrive from
 * /v1/settings/public (qrLabel.*); the encoded URL arrives pre-built so
 * the rendered code matches what a scanner will hit.
 *
 * The page sets a print stylesheet that strips page margins so the
 * label fills the configured paper area, plus a small on-screen toolbar
 * with "Print" + "Back" + the slug for sanity-check.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import qrcode from 'qrcode-generator';

interface PlantSummary {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  gardenZone?: string | null;
  taxon?: { latinName?: string | null } | null;
}

interface QrLabelSettings {
  sizeMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  showCommonName: boolean;
  showLatin: boolean;
  showRedList: boolean;
  showGardenZone: boolean;
  showSlug: boolean;
  embedKioskId: boolean;
  defaultKioskId: string;
}

function localisedName(p: PlantSummary, locale: 'en' | 'fi' | 'sv'): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

function makeQrDataUrl(text: string): string {
  // High EC for outdoor labels — survives smudging / partial occlusion.
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 0);
}

export function PrintQrLabel({
  plant,
  locale,
  kioskId,
  qrUrl,
  settings,
}: {
  plant: PlantSummary;
  locale: 'en' | 'fi' | 'sv';
  kioskId: string;
  qrUrl: string;
  settings: QrLabelSettings;
}) {
  const dataUrl = useMemo(() => makeQrDataUrl(qrUrl), [qrUrl]);
  const [autoPrintHandled, setAutoPrintHandled] = useState(false);

  // Auto-fire print dialog on first render if ?autoprint=1.
  useEffect(() => {
    if (autoPrintHandled) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('autoprint') === '1') {
      setAutoPrintHandled(true);
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [autoPrintHandled]);

  const commonName = localisedName(plant, locale);
  const latin = plant.taxon?.latinName ?? plant.nameEn;
  const labelStyle = {
    width: `${settings.labelWidthMm}mm`,
    height: `${settings.labelHeightMm}mm`,
  };

  return (
    <>
      <style>{`
        @page { size: ${settings.labelWidthMm}mm ${settings.labelHeightMm}mm; margin: 0; }
        @media print {
          html, body { margin: 0; padding: 0; background: #fff; }
          .print-toolbar, .print-toolbar * { display: none !important; }
          .print-label {
            box-shadow: none !important;
            border: none !important;
            page-break-after: always;
          }
        }
        body { background: #ECE5D2; }
      `}</style>
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '32px 16px 48px',
          gap: 24,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          className="print-toolbar"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '8px 16px',
            background: '#fff',
            border: '1px solid #d9d2bb',
            borderRadius: 999,
            boxShadow: '0 1px 3px rgba(0,0,0,.05)',
          }}
        >
          <Link
            href={`/${locale}/plants/${plant.slug}`}
            style={{ color: '#1F3A2C', textDecoration: 'none', fontSize: 14 }}
          >
            ← {locale === 'fi' ? 'Takaisin kasviin' : locale === 'sv' ? 'Tillbaka' : 'Back to plant'}
          </Link>
          <span style={{ color: '#888', fontSize: 12 }}>·</span>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              background: '#1F3A2C',
              color: '#fff',
              border: 0,
              borderRadius: 999,
              padding: '8px 18px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            🖨️ {locale === 'fi' ? 'Tulosta' : locale === 'sv' ? 'Skriv ut' : 'Print'}
          </button>
          <span style={{ color: '#666', fontSize: 12 }}>
            {settings.labelWidthMm}×{settings.labelHeightMm}mm · QR {settings.sizeMm}mm
            {kioskId ? ` · kiosk: ${kioskId}` : ''}
          </span>
        </div>

        <div
          className="print-label"
          style={{
            ...labelStyle,
            background: '#fff',
            border: '1px solid #d9d2bb',
            borderRadius: 4,
            boxShadow: '0 4px 16px rgba(0,0,0,.06)',
            display: 'flex',
            alignItems: 'center',
            padding: '4mm',
            boxSizing: 'border-box',
            gap: '4mm',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt={`QR · ${plant.slug}`}
            style={{
              width: `${settings.sizeMm}mm`,
              height: `${settings.sizeMm}mm`,
              imageRendering: 'pixelated',
              flexShrink: 0,
            }}
          />
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5mm',
              minWidth: 0,
              fontSize: '3mm',
              lineHeight: 1.15,
              color: '#1d1d1d',
              overflow: 'hidden',
            }}
          >
            {settings.showLatin && (
              <div
                style={{
                  fontStyle: 'italic',
                  fontWeight: 600,
                  fontSize: '3.6mm',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {latin}
              </div>
            )}
            {settings.showCommonName && commonName && commonName !== latin && (
              <div
                style={{
                  fontSize: '2.8mm',
                  color: '#444',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {commonName}
              </div>
            )}
            <div style={{ display: 'flex', gap: '2mm', alignItems: 'center', marginTop: '1mm', flexWrap: 'wrap' }}>
              {settings.showRedList && plant.redListStatus && (
                <span
                  style={{
                    fontSize: '2.4mm',
                    padding: '0.4mm 1.5mm',
                    border: '0.3mm solid #1F3A2C',
                    borderRadius: '1mm',
                    fontWeight: 600,
                    color: '#1F3A2C',
                  }}
                >
                  {plant.redListStatus}
                </span>
              )}
              {settings.showGardenZone && plant.gardenZone && (
                <span style={{ fontSize: '2.2mm', color: '#555' }}>
                  📍 {plant.gardenZone}
                </span>
              )}
            </div>
            {settings.showSlug && (
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '2mm',
                  color: '#888',
                  marginTop: 'auto',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {plant.slug}
              </div>
            )}
          </div>
        </div>

        <div
          className="print-toolbar"
          style={{ color: '#666', fontSize: 12, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', maxWidth: 480, textAlign: 'center' }}
        >
          {qrUrl}
        </div>
      </main>
    </>
  );
}
