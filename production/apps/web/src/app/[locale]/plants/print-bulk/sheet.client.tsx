'use client';

/**
 * Printable bulk QR sheet. Pure presentation — the server page assembles
 * the cell list + config; this just lays it out using CSS Grid sized in
 * millimetres so what the curator sees on screen IS what the printer
 * outputs. @page applies the configured sheet dimensions; print CSS
 * strips the toolbar and removes borders so cut marks are clean.
 */
import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import {
  buildBulkSheetPdf,
  downloadPdf,
  pageSizeMm,
  PAGE_FORMAT_OPTIONS,
  type PageFormat,
} from '@/lib/qr-pdf';

export interface BulkPlant {
  slug: string;
  nameEn: string;
  nameFi: string;
  nameSv: string;
  redListStatus: string;
  gardenZone: string | null;
  latinName: string;
}

export interface BulkSheetConfig {
  sheetW: number;
  sheetH: number;
  marginT: number;
  marginR: number;
  marginB: number;
  marginL: number;
  cols: number;
  rows: number;
  gutterX: number;
  gutterY: number;
  labelW: number;
  labelH: number;
  qrSize: number;
  cutMarks: boolean;
  showLatin: boolean;
  showCommon: boolean;
  showRedList: boolean;
  showZone: boolean;
  showSlug: boolean;
  kiosk: string;
  repeat: number;
  material: 'paper' | 'wood' | 'aluminum';
  title: string;
}

function makeQrDataUrl(text: string): string {
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 0);
}

function localisedName(p: BulkPlant, locale: 'en' | 'fi' | 'sv'): string {
  if (locale === 'fi') return p.nameFi || p.nameEn;
  if (locale === 'sv') return p.nameSv || p.nameEn;
  return p.nameEn;
}

interface Cell {
  plant: BulkPlant;
  qrUrl: string;
}

export function BulkQrSheet({
  locale,
  config,
  cells,
  missingCount,
}: {
  locale: 'en' | 'fi' | 'sv';
  config: BulkSheetConfig;
  cells: Cell[];
  missingCount: number;
}) {
  // Pre-compute QR data URLs so the print render is synchronous.
  const dataUrls = useMemo(() => cells.map((c) => makeQrDataUrl(c.qrUrl)), [cells]);

  const [autoPrintHandled, setAutoPrintHandled] = useState(false);
  const [pageFormat, setPageFormat] = useState<PageFormat>('custom');
  const [customW, setCustomW] = useState(config.sheetW);
  const [customH, setCustomH] = useState(config.sheetH);

  // Effective sheet dimensions, derived from the dropdown selection.
  // When the user picks A4 / Letter / etc. the on-screen preview
  // re-flows to the new size and the cell grid recomputes so each
  // page in the preview matches what the PDF download will produce.
  const sheetDims = useMemo(() => {
    return pageSizeMm(pageFormat, {
      w: pageFormat === 'custom' ? customW : config.sheetW,
      h: pageFormat === 'custom' ? customH : config.sheetH,
    });
  }, [pageFormat, customW, customH, config.sheetW, config.sheetH]);

  // Pages: split cells into chunks of cols*rows so the layout pages
  // naturally. CSS `page-break-after` on each page wrapper makes the
  // browser respect them in print.
  const perPage = config.cols * config.rows;
  const pages = useMemo(() => {
    const chunks: Cell[][] = [];
    for (let i = 0; i < cells.length; i += perPage) {
      chunks.push(cells.slice(i, i + perPage));
    }
    return chunks;
  }, [cells, perPage]);
  useEffect(() => {
    if (autoPrintHandled) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('autoprint') === '1') {
      setAutoPrintHandled(true);
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [autoPrintHandled]);

  const downloadAsPdf = () => {
    const pdfCells = cells.map((c, i) => ({
      plant: {
        slug: c.plant.slug,
        commonName: localisedName(c.plant, locale),
        latin: c.plant.latinName,
        redListStatus: c.plant.redListStatus,
        gardenZone: c.plant.gardenZone ?? null,
      },
      qrDataUrl: dataUrls[i] ?? '',
    }));
    const cfg = {
      sheetW: config.sheetW,
      sheetH: config.sheetH,
      marginT: config.marginT,
      marginR: config.marginR,
      marginB: config.marginB,
      marginL: config.marginL,
      cols: config.cols,
      rows: config.rows,
      gutterX: config.gutterX,
      gutterY: config.gutterY,
      labelWidthMm: config.labelW,
      labelHeightMm: config.labelH,
      sizeMm: config.qrSize,
      showLatin: config.showLatin,
      showCommon: config.showCommon,
      showRedList: config.showRedList,
      showGardenZone: config.showZone,
      showSlug: config.showSlug,
      cutMarks: config.cutMarks,
      title:
        config.title ||
        (locale === 'fi'
          ? 'QR-koodien massapainatus'
          : locale === 'sv'
            ? 'Massutskrift av QR-koder'
            : 'Bulk QR print'),
    };
    const doc = buildBulkSheetPdf(
      pdfCells,
      cfg,
      pageFormat,
      pageFormat === 'custom' ? { w: customW, h: customH } : undefined,
    );
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadPdf(doc, `bloomoulu-qr-labels-${stamp}.pdf`);
  };

  const totalLabels = cells.length;
  const materialLabel =
    config.material === 'wood'
      ? locale === 'fi'
        ? 'Puu'
        : locale === 'sv'
          ? 'Trä'
          : 'Wood'
      : config.material === 'aluminum'
        ? locale === 'fi'
          ? 'Alumiini'
          : locale === 'sv'
            ? 'Aluminium'
            : 'Aluminum'
        : locale === 'fi'
          ? 'Paperi'
          : locale === 'sv'
            ? 'Papper'
            : 'Paper';

  return (
    <>
      <style>{`
        @page {
          size: ${sheetDims.w}mm ${sheetDims.h}mm;
          margin: 0;
        }
        @media print {
          html, body { margin: 0; padding: 0; background: #fff; }
          .bulk-toolbar { display: none !important; }
          .bulk-page {
            box-shadow: none !important;
            border: none !important;
            background: #fff !important;
            margin: 0 !important;
            page-break-after: always;
          }
          .bulk-page:last-child { page-break-after: auto; }
        }
        body { background: #ECE5D2; }
      `}</style>
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px 16px 64px',
          gap: 16,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          className="bulk-toolbar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'center',
            padding: '12px 20px',
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #d9d2bb',
            maxWidth: 720,
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <strong style={{ fontSize: 18, color: '#1F3A2C' }}>
              {config.title || (locale === 'fi' ? 'QR-koodien massapainatus' : locale === 'sv' ? 'Massutskrift av QR-koder' : 'Bulk QR print')}
            </strong>
            <button
              type="button"
              onClick={downloadAsPdf}
              style={{
                background: '#1F3A2C',
                color: '#fff',
                border: 0,
                borderRadius: 999,
                padding: '8px 18px',
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              ⬇{' '}
              {locale === 'fi'
                ? 'Lataa PDF'
                : locale === 'sv'
                  ? 'Ladda ner PDF'
                  : 'Download print-ready PDF'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              title={
                locale === 'fi'
                  ? 'Käytä selaimen tulostusta — koko voi muuttua hieman.'
                  : locale === 'sv'
                    ? 'Använd webbläsarens utskrift — storleken kan ändras något.'
                    : 'Use the browser print dialog — sizing may drift slightly.'
              }
              style={{
                background: 'transparent',
                color: '#1F3A2C',
                border: '1px solid #1F3A2C',
                borderRadius: 999,
                padding: '7px 16px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              🖨️{' '}
              {locale === 'fi'
                ? 'Selain'
                : locale === 'sv'
                  ? 'Webbläsare'
                  : 'Browser print'}
            </button>
            <select
              value={pageFormat}
              onChange={(e) => setPageFormat(e.target.value as PageFormat)}
              aria-label={
                locale === 'fi'
                  ? 'Sivukoko'
                  : locale === 'sv'
                    ? 'Pappersstorlek'
                    : 'Page size'
              }
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #d9d2bb',
                fontSize: 12,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              {PAGE_FORMAT_OPTIONS.filter((o) => o.value !== 'label').map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {pageFormat === 'custom' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                <input
                  type="number"
                  value={customW}
                  min={20}
                  max={2000}
                  step={1}
                  onChange={(e) => setCustomW(Number(e.target.value) || 0)}
                  style={{
                    width: 64,
                    padding: '4px 6px',
                    borderRadius: 8,
                    border: '1px solid #d9d2bb',
                    fontSize: 12,
                  }}
                />
                <span aria-hidden="true">×</span>
                <input
                  type="number"
                  value={customH}
                  min={20}
                  max={2000}
                  step={1}
                  onChange={(e) => setCustomH(Number(e.target.value) || 0)}
                  style={{
                    width: 64,
                    padding: '4px 6px',
                    borderRadius: 8,
                    border: '1px solid #d9d2bb',
                    fontSize: 12,
                  }}
                />
                <span style={{ color: '#666' }}>mm</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => window.close()}
              style={{
                background: 'transparent',
                color: '#666',
                border: '1px solid #ddd',
                borderRadius: 999,
                padding: '7px 14px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {locale === 'fi' ? 'Sulje' : locale === 'sv' ? 'Stäng' : 'Close'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#666', textAlign: 'center', display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <span>
              {totalLabels} {locale === 'fi' ? 'etikettiä' : locale === 'sv' ? 'etiketter' : 'labels'} ·{' '}
              {pages.length} {locale === 'fi' ? 'sivu(a)' : locale === 'sv' ? 'sida(or)' : 'page(s)'}
            </span>
            <span>
              {config.sheetW}×{config.sheetH}mm · {config.cols}×{config.rows} ·{' '}
              {config.labelW}×{config.labelH}mm · QR {config.qrSize}mm
            </span>
            <span>
              {materialLabel}
              {config.kiosk ? ` · kiosk: ${config.kiosk}` : ''}
              {config.repeat > 1 ? ` · ×${config.repeat} ` : ''}
            </span>
          </div>
          {missingCount > 0 && (
            <div style={{ fontSize: 12, color: '#B8513A' }}>
              {locale === 'fi'
                ? `${missingCount} kasvia ei löytynyt tietokannasta`
                : locale === 'sv'
                  ? `${missingCount} växt(er) hittades inte`
                  : `${missingCount} plant(s) not found in database`}
            </div>
          )}
        </div>

        {pages.map((pageCells, pageIdx) => {
          // Effective sheet — sheetDims overrides config when the
          // user changed the page-format dropdown.
          const usableW = sheetDims.w - config.marginL - config.marginR;
          const usableH = sheetDims.h - config.marginT - config.marginB;
          // Auto-fit: shrink cell width if the configured cols × labelW
          // (+ gutters) overflows the usable area. Keeps layout clean
          // even if the curator mis-types a dimension or picks a
          // smaller sheet (e.g. A5) than the labels were designed for.
          const fitLabelW = Math.min(
            config.labelW,
            (usableW - (config.cols - 1) * config.gutterX) / config.cols,
          );
          const fitLabelH = Math.min(
            config.labelH,
            (usableH - (config.rows - 1) * config.gutterY) / config.rows,
          );
          return (
            <div
              key={pageIdx}
              className="bulk-page"
              style={{
                width: `${sheetDims.w}mm`,
                height: `${sheetDims.h}mm`,
                background: '#fff',
                border: '1px dashed #d9d2bb',
                boxShadow: '0 2px 12px rgba(0,0,0,.05)',
                position: 'relative',
                boxSizing: 'border-box',
                paddingTop: `${config.marginT}mm`,
                paddingRight: `${config.marginR}mm`,
                paddingBottom: `${config.marginB}mm`,
                paddingLeft: `${config.marginL}mm`,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${config.cols}, ${fitLabelW}mm)`,
                  gridAutoRows: `${fitLabelH}mm`,
                  columnGap: `${config.gutterX}mm`,
                  rowGap: `${config.gutterY}mm`,
                  width: '100%',
                  height: '100%',
                  position: 'relative',
                }}
              >
                {pageCells.map((cell, idx) => {
                  const globalIdx = pageIdx * perPage + idx;
                  const dataUrl = dataUrls[globalIdx] ?? '';
                  return (
                    <Cell
                      key={`${pageIdx}-${idx}-${cell.plant.slug}`}
                      cell={cell}
                      qrDataUrl={dataUrl}
                      config={config}
                      locale={locale}
                    />
                  );
                })}
              </div>
              {/* Light page footer with sheet count — only visible in browser
                  preview because the toolbar above already carries
                  identification on print. */}
              <div
                className="bulk-toolbar"
                style={{
                  position: 'absolute',
                  bottom: 2,
                  right: 6,
                  fontSize: 9,
                  color: '#aaa',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                p.{pageIdx + 1}/{pages.length}
              </div>
            </div>
          );
        })}
      </main>
    </>
  );
}

function Cell({
  cell,
  qrDataUrl,
  config,
  locale,
}: {
  cell: Cell;
  qrDataUrl: string;
  config: BulkSheetConfig;
  locale: 'en' | 'fi' | 'sv';
}) {
  const common = localisedName(cell.plant, locale);
  const showCommon = config.showCommon && common && common !== cell.plant.latinName;
  // Cut marks: tiny dashed border draws on the outside of each cell so
  // a guillotine can follow them and they don't print on the labels
  // themselves (they'd be cut off anyway).
  return (
    <div
      style={{
        boxSizing: 'border-box',
        border: config.cutMarks ? '0.2mm dashed #888' : 'none',
        padding: '1.2mm',
        display: 'flex',
        alignItems: 'center',
        gap: '1.5mm',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt={`QR · ${cell.plant.slug}`}
        style={{
          width: `${config.qrSize}mm`,
          height: `${config.qrSize}mm`,
          imageRendering: 'pixelated',
          flexShrink: 0,
        }}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '2.2mm',
          lineHeight: 1.15,
          color: '#1d1d1d',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3mm',
        }}
      >
        {config.showLatin && (
          <div
            style={{
              fontStyle: 'italic',
              fontWeight: 600,
              fontSize: '2.6mm',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {cell.plant.latinName}
          </div>
        )}
        {showCommon && (
          <div
            style={{
              fontSize: '2.1mm',
              color: '#555',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {common}
          </div>
        )}
        <div style={{ display: 'flex', gap: '1mm', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5mm' }}>
          {config.showRedList && cell.plant.redListStatus && (
            <span
              style={{
                fontSize: '1.9mm',
                padding: '0.2mm 1mm',
                border: '0.2mm solid #1F3A2C',
                borderRadius: '0.6mm',
                fontWeight: 600,
                color: '#1F3A2C',
              }}
            >
              {cell.plant.redListStatus}
            </span>
          )}
          {config.showZone && cell.plant.gardenZone && (
            <span style={{ fontSize: '1.7mm', color: '#555' }}>📍 {cell.plant.gardenZone}</span>
          )}
        </div>
        {config.showSlug && (
          <div
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: '1.5mm',
              color: '#999',
              marginTop: 'auto',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {cell.plant.slug}
          </div>
        )}
      </div>
    </div>
  );
}
