/**
 * Shared renderer for the three legal pages (privacy / terms / accessibility).
 *
 * Pulls the ContentBlock by slug from the API and renders the donor-locale
 * markdown body. Falls back to English if the donor locale is missing the
 * block (shouldn't happen, but defensive).
 *
 * The actual markdown is intentionally rendered as plain text inside a <pre>
 * with `white-space: pre-wrap` for the first cut — operators can edit the
 * markdown source in /admin/resources/ContentBlock and a future Phase 3
 * polish ticket can wire react-markdown for proper styling. For a draft
 * privacy/terms/a11y the legibility-over-prettiness trade-off is the right
 * one — the legal team reads + edits content, not CSS.
 */
import { notFound } from 'next/navigation';

interface ContentBlock {
  slug: string;
  bodyEn: string;
  bodyFi: string;
  bodySv: string;
  isPublished: boolean;
}

async function loadBlock(slug: string): Promise<ContentBlock | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/v1/content-blocks/${encodeURIComponent(slug)}`, {
      next: { revalidate: 300, tags: [`content-block:${slug}`] },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function LegalPage({ slug, locale }: { slug: string; locale: string }) {
  const block = await loadBlock(slug);
  if (!block || !block.isPublished) notFound();
  const body =
    locale === 'fi' ? block.bodyFi : locale === 'sv' ? block.bodySv : block.bodyEn;
  return (
    <main className="legal-page" style={{ maxWidth: 760, margin: '2rem auto', padding: '0 1.25rem' }}>
      <article>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily:
              "'Helvetica Neue', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
            fontSize: '1rem',
            lineHeight: 1.55,
            color: '#1F3C2D',
          }}
        >
          {body}
        </pre>
      </article>
    </main>
  );
}
