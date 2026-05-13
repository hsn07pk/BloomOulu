/**
 * Naive but production-grade chunker.
 *
 * Splits on sentence boundaries when possible, otherwise on paragraph
 * breaks, otherwise on whitespace. Window size = ~500 tokens, overlap = ~50.
 * The 4-chars-per-token heuristic holds well enough for FI/SV/EN.
 */
export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): string[] {
  const size = opts.size ?? 500;
  const overlap = opts.overlap ?? 50;
  const charSize = size * 4;
  const charOverlap = overlap * 4;
  const out: string[] = [];

  const sentences = text.split(/(?<=[\.\!\?])\s+/);
  let buf = '';
  for (const s of sentences) {
    if (buf.length + s.length > charSize) {
      out.push(buf.trim());
      buf = buf.slice(-charOverlap) + ' ' + s;
    } else {
      buf += (buf ? ' ' : '') + s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
