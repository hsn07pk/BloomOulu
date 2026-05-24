/**
 * QR-label PDF builder — produces real PDF files at exact millimetre
 * dimensions. Replaces the previous "Save as PDF" → browser print
 * dialog flow, which silently rescaled margins and label sizes so the
 * saved PDF didn't match the on-screen preview.
 *
 * Two entry points:
 *
 *   • buildLabelPdf(plant, config, qrUrl)
 *       Produces a 1-page PDF sized exactly to the label (used by the
 *       per-plant /plants/{slug}/print page).
 *
 *   • buildBulkSheetPdf(cells, config, locale, pageFormat)
 *       Produces a multi-page PDF on the chosen sheet (A4 / Letter /
 *       custom) with the label grid (used by /plants/print-bulk).
 *
 * Both honour every knob in QrLabelSettings / BulkSheetConfig so what
 * the curator sees on screen IS what lands on the paper.
 */
import { jsPDF } from 'jspdf';

export type PageFormat =
  | 'a3'
  | 'a4'
  | 'a5'
  | 'letter'
  | 'legal'
  | 'tabloid'
  | 'label' // page is sized to the label itself (used by per-plant print)
  | 'custom';

// ISO + US paper sizes in mm (width × height, portrait orientation).
const PAGE_SIZES_MM: Record<Exclude<PageFormat, 'label' | 'custom'>, [number, number]> = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
};

export const PAGE_FORMAT_OPTIONS: Array<{ value: PageFormat; label: string }> = [
  { value: 'a4', label: 'A4 (210 × 297 mm)' },
  { value: 'a3', label: 'A3 (297 × 420 mm)' },
  { value: 'a5', label: 'A5 (148 × 210 mm)' },
  { value: 'letter', label: 'US Letter (216 × 279 mm)' },
  { value: 'legal', label: 'US Legal (216 × 356 mm)' },
  { value: 'tabloid', label: 'Tabloid (279 × 432 mm)' },
  { value: 'label', label: 'Match label size (single label per page)' },
  { value: 'custom', label: 'Custom dimensions…' },
];

export function pageSizeMm(
  format: PageFormat,
  fallback: { w: number; h: number },
): { w: number; h: number } {
  if (format === 'label' || format === 'custom') return fallback;
  const [w, h] = PAGE_SIZES_MM[format];
  return { w, h };
}

interface LabelConfig {
  labelWidthMm: number;
  labelHeightMm: number;
  sizeMm: number; // QR code side length
  showLatin: boolean;
  showCommon: boolean;
  showRedList: boolean;
  showGardenZone: boolean;
  showSlug: boolean;
}

interface LabelPlant {
  slug: string;
  commonName: string;
  latin: string;
  redListStatus: string;
  gardenZone: string | null;
}

interface BulkSheetConfig extends LabelConfig {
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
  cutMarks: boolean;
  title: string;
}

interface BulkCell {
  plant: LabelPlant;
  qrDataUrl: string;
}

/**
 * Per-plant printable label — 1 page sized exactly to the configured
 * label dimensions. When pageFormat !== 'label', the label is centred
 * on the chosen sheet.
 */
export function buildLabelPdf(
  plant: LabelPlant,
  qrDataUrl: string,
  config: LabelConfig,
  pageFormat: PageFormat = 'label',
  customPage?: { w: number; h: number },
): jsPDF {
  const pageSize = pageSizeMm(pageFormat, {
    w: customPage?.w ?? config.labelWidthMm,
    h: customPage?.h ?? config.labelHeightMm,
  });
  const orientation: 'portrait' | 'landscape' = pageSize.w > pageSize.h ? 'landscape' : 'portrait';
  const doc = new jsPDF({ unit: 'mm', format: [pageSize.w, pageSize.h], orientation });
  // Centre the label on the page when page > label.
  const xOffset = Math.max(0, (pageSize.w - config.labelWidthMm) / 2);
  const yOffset = Math.max(0, (pageSize.h - config.labelHeightMm) / 2);
  drawLabel(doc, plant, qrDataUrl, config, xOffset, yOffset);
  return doc;
}

/**
 * Multi-page bulk sheet — paginates the cells into a grid of
 * cols × rows on the configured sheet, repeating to as many pages as
 * needed. Each page is drawn at exact mm coordinates so the printed
 * output matches the screen preview sub-millimetre.
 */
export function buildBulkSheetPdf(
  cells: BulkCell[],
  config: BulkSheetConfig,
  pageFormat: PageFormat = 'custom',
  customPage?: { w: number; h: number },
): jsPDF {
  // When the curator picks A4 / Letter / etc., override sheetW/sheetH;
  // otherwise honour the configured custom dimensions.
  const pageSize = pageSizeMm(pageFormat, {
    w: customPage?.w ?? config.sheetW,
    h: customPage?.h ?? config.sheetH,
  });
  const effective = {
    ...config,
    sheetW: pageSize.w,
    sheetH: pageSize.h,
  };

  // Recompute cell positions for the chosen sheet size — keep the
  // grid dimensions (cols/rows) constant and stretch the spacing.
  const usableW = effective.sheetW - effective.marginL - effective.marginR;
  const usableH = effective.sheetH - effective.marginT - effective.marginB;
  const cellW = (usableW - effective.gutterX * (effective.cols - 1)) / effective.cols;
  const cellH = (usableH - effective.gutterY * (effective.rows - 1)) / effective.rows;
  // The label itself can be smaller than the cell — keep its declared
  // dimensions, but cap to the cell so it doesn't bleed.
  const labelW = Math.min(effective.labelWidthMm, cellW);
  const labelH = Math.min(effective.labelHeightMm, cellH);

  const orientation: 'portrait' | 'landscape' =
    effective.sheetW > effective.sheetH ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    unit: 'mm',
    format: [effective.sheetW, effective.sheetH],
    orientation,
  });

  const perPage = effective.cols * effective.rows;
  for (let pageIdx = 0; pageIdx * perPage < cells.length; pageIdx++) {
    if (pageIdx > 0) doc.addPage([effective.sheetW, effective.sheetH], orientation);
    const slice = cells.slice(pageIdx * perPage, (pageIdx + 1) * perPage);
    slice.forEach((cell, i) => {
      const col = i % effective.cols;
      const row = Math.floor(i / effective.cols);
      const cellX = effective.marginL + col * (cellW + effective.gutterX);
      const cellY = effective.marginT + row * (cellH + effective.gutterY);
      // Centre the label inside its cell.
      const labelX = cellX + Math.max(0, (cellW - labelW) / 2);
      const labelY = cellY + Math.max(0, (cellH - labelH) / 2);
      drawLabel(
        doc,
        cell.plant,
        cell.qrDataUrl,
        { ...effective, labelWidthMm: labelW, labelHeightMm: labelH },
        labelX,
        labelY,
      );
      if (effective.cutMarks) {
        drawCutMarks(doc, cellX, cellY, cellW, cellH);
      }
    });
    // Page footer with the title + page count, in a 3mm-ish line at
    // the bottom margin.
    const footer = `${effective.title} · ${pageIdx + 1} / ${Math.ceil(cells.length / perPage)}`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(footer, effective.sheetW / 2, effective.sheetH - 4, { align: 'center' });
  }
  return doc;
}

/**
 * Draws one label at the given (x, y) origin in mm coordinates.
 * Matches the on-screen layout 1:1.
 */
function drawLabel(
  doc: jsPDF,
  plant: LabelPlant,
  qrDataUrl: string,
  config: LabelConfig,
  x: number,
  y: number,
): void {
  const labelW = config.labelWidthMm;
  const labelH = config.labelHeightMm;
  const padding = 3; // mm inner padding
  // Place QR on the left, vertically centred.
  const qrSize = Math.min(config.sizeMm, labelH - padding * 2, labelW * 0.55);
  const qrX = x + padding;
  const qrY = y + (labelH - qrSize) / 2;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize, undefined, 'NONE');

  // Text column to the right of the QR.
  const textX = qrX + qrSize + padding;
  const textMaxW = labelW - (textX - x) - padding;
  let textY = y + padding;
  if (config.showLatin) {
    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(11);
    doc.setTextColor(20);
    const lines = doc.splitTextToSize(plant.latin, textMaxW);
    doc.text(lines, textX, textY + 3);
    textY += lines.length * 4;
  }
  if (
    config.showCommon &&
    plant.commonName &&
    plant.commonName.toLowerCase() !== plant.latin.toLowerCase()
  ) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80);
    const lines = doc.splitTextToSize(plant.commonName, textMaxW);
    doc.text(lines, textX, textY + 2);
    textY += lines.length * 3.5;
  }
  if (config.showRedList && plant.redListStatus) {
    // Draw a small outlined badge.
    const badge = plant.redListStatus;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const badgeW = doc.getTextWidth(badge) + 3;
    const badgeH = 4;
    const badgeX = textX;
    const badgeY = textY + 2;
    doc.setDrawColor(31, 58, 44);
    doc.setLineWidth(0.2);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 0.6, 0.6);
    doc.setTextColor(31, 58, 44);
    doc.text(badge, badgeX + badgeW / 2, badgeY + 3, { align: 'center' });
    textY += badgeH + 1.5;
  }
  if (config.showGardenZone && plant.gardenZone) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100);
    const lines = doc.splitTextToSize(`📍 ${plant.gardenZone}`, textMaxW);
    doc.text(lines, textX, textY + 3);
    textY += lines.length * 3;
  }
  if (config.showSlug) {
    doc.setFont('courier', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(140);
    doc.text(plant.slug, textX, y + labelH - padding);
  }
}

/**
 * Dashed cut marks around the cell perimeter, for printing on plain
 * paper that the curator cuts with a guillotine.
 */
function drawCutMarks(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  doc.setLineDashPattern([0.6, 0.4], 0);
  doc.setDrawColor(180);
  doc.setLineWidth(0.1);
  doc.rect(x, y, w, h);
  doc.setLineDashPattern([], 0);
}

/**
 * Triggers a file download for the given jsPDF document.
 */
export function downloadPdf(doc: jsPDF, filename: string): void {
  doc.save(filename);
}
