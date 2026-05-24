/**
 * Shared renderer for the three legal pages (privacy / terms / accessibility).
 *
 * Pulls the ContentBlock by slug from the API, then:
 *   1. extracts the first H1 (`# Title`) as the page heading
 *   2. splits the rest of the markdown by H2 (`## `) into sections
 *   3. renders each section inside a native <details>/<summary> accordion —
 *      first section open by default, rest collapsed. Native <details> is
 *      keyboard-accessible and JS-free, so this stays a pure server
 *      component.
 *
 * Operators edit the markdown source in /admin/resources/ContentBlock and
 * the next ISR refresh (5 min) picks it up — no redeploy.
 */
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getInternalApiUrl } from '@bloomoulu/constants';

interface ContentBlock {
  slug: string;
  bodyEn: string;
  bodyFi: string;
  bodySv: string;
  isPublished: boolean;
  updatedAt: string;
}

interface ParsedDoc {
  /** First H1 in the body — `# Privacy Policy` → "Privacy Policy". */
  title: string | null;
  /** H2-delimited sections in source order. */
  sections: Array<{ heading: string; body: string }>;
  /** Markdown that appears BEFORE the first H2 (after the H1) — rendered as an intro. */
  intro: string;
}

async function loadBlock(slug: string): Promise<ContentBlock | null> {
  const apiUrl = getInternalApiUrl();
  try {
    const res = await fetch(`${apiUrl}/v1/content-blocks/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Split a markdown document into a title (first H1), an intro (markdown
 * before the first H2), and a list of H2-delimited sections. The H2 line
 * itself is consumed and becomes the section.heading; everything until the
 * next H2 (or EOF) becomes the section.body.
 *
 * Robust to:
 *   - leading blank lines
 *   - missing H1 (title comes back null)
 *   - no H2s at all (whole body becomes the intro)
 */
function parseDoc(md: string): ParsedDoc {
  const lines = md.split('\n');
  let title: string | null = null;
  const sections: Array<{ heading: string; body: string }> = [];
  const introLines: string[] = [];

  let cursor: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1 && title === null && cursor === null) {
      title = h1[1]!;
      continue;
    }
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (cursor) sections.push({ heading: cursor.heading, body: cursor.lines.join('\n').trim() });
      cursor = { heading: h2[1]!, lines: [] };
      continue;
    }
    if (cursor) cursor.lines.push(line);
    else introLines.push(line);
  }
  if (cursor) sections.push({ heading: cursor.heading, body: cursor.lines.join('\n').trim() });

  return { title, sections, intro: introLines.join('\n').trim() };
}

function formatUpdated(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    const tag = locale === 'fi' ? 'fi-FI' : locale === 'sv' ? 'sv-SE' : 'en-GB';
    return new Intl.DateTimeFormat(tag, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

const updatedLabel: Record<string, string> = {
  en: 'Last updated',
  fi: 'Päivitetty',
  sv: 'Uppdaterad',
};

export async function LegalPage({ slug, locale }: { slug: string; locale: string }) {
  const block = await loadBlock(slug);
  if (!block || !block.isPublished) notFound();
  const body =
    locale === 'fi' ? block.bodyFi : locale === 'sv' ? block.bodySv : block.bodyEn;
  const { title, intro, sections } = parseDoc(body);
  const updated = formatUpdated(block.updatedAt, locale);
  const updatedLbl = updatedLabel[locale] ?? updatedLabel.en;

  return (
    <main
      className="legal-page fade-in"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '56px 1.25rem 96px',
      }}
    >
      {/* Header */}
      <header style={{ marginBottom: 32 }}>
        {title && (
          <h1
            className="serif"
            style={{
              fontSize: 'clamp(36px, 5vw, 56px)',
              color: 'var(--forest-deep)',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              margin: 0,
            }}
          >
            {title}
          </h1>
        )}
        <div
          className="tiny"
          style={{
            marginTop: 12,
            color: 'var(--ink-soft, #5a6e63)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {updatedLbl} · {updated}
        </div>
      </header>

      {/* Intro paragraph(s) above the first section, if any */}
      {intro && (
        <div className="legal-prose" style={{ marginBottom: 24, color: 'var(--ink)' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{intro}</ReactMarkdown>
        </div>
      )}

      {/* Accordion sections */}
      <div className="legal-accordion" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sections.map((s, i) => (
          <details
            key={`${s.heading}-${i}`}
            // First section open by default. Curators usually put the most
            // important block first (data we collect / who we are / etc.).
            open={i === 0}
            style={{
              background: 'var(--paper, #fff)',
              border: '1px solid var(--line-soft, #e6e1d4)',
              borderRadius: 14,
              padding: '0',
              overflow: 'hidden',
            }}
          >
            <summary
              className="serif"
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                padding: '20px 24px',
                fontSize: 20,
                color: 'var(--forest-deep, #1F3C2D)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                userSelect: 'none',
              }}
            >
              <span>{s.heading}</span>
              <span
                aria-hidden="true"
                className="legal-chev"
                style={{
                  fontSize: 14,
                  color: 'var(--sage-bright, #6f8f78)',
                  flexShrink: 0,
                  transition: 'transform 180ms ease',
                }}
              >
                ▾
              </span>
            </summary>
            <div
              className="legal-prose"
              style={{
                padding: '4px 24px 24px',
                color: 'var(--ink, #1F3C2D)',
                borderTop: '1px solid var(--line-soft, #e6e1d4)',
                marginTop: 4,
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
            </div>
          </details>
        ))}
      </div>

      {/* Section-local typography polish — kept inline to this route. */}
      <style>{`
        .legal-page summary::-webkit-details-marker { display: none; }
        .legal-page details[open] .legal-chev { transform: rotate(180deg); }
        .legal-prose { font-size: 1rem; line-height: 1.6; }
        .legal-prose p { margin: 0 0 1em; }
        .legal-prose p:last-child { margin-bottom: 0; }
        .legal-prose h2, .legal-prose h3, .legal-prose h4 {
          font-family: var(--font-serif, 'Source Serif Pro', Georgia, serif);
          color: var(--forest-deep, #1F3C2D);
          margin: 1.6em 0 0.5em;
          line-height: 1.2;
        }
        .legal-prose h2 { font-size: 1.25rem; }
        .legal-prose h3 { font-size: 1.1rem; }
        .legal-prose h4 { font-size: 1rem; }
        .legal-prose ul, .legal-prose ol { padding-left: 1.5em; margin: 0 0 1em; }
        .legal-prose li { margin: 0.3em 0; }
        .legal-prose a {
          color: var(--rust, #b65a3f);
          text-decoration: underline;
          text-decoration-thickness: 1px;
          text-underline-offset: 2px;
        }
        .legal-prose a:hover { text-decoration-thickness: 2px; }
        .legal-prose code {
          background: var(--sand, #f3eedf);
          padding: 0.1em 0.35em;
          border-radius: 4px;
          font-size: 0.9em;
        }
        .legal-prose blockquote {
          border-left: 3px solid var(--sage-bright, #6f8f78);
          padding-left: 1em;
          margin: 1em 0;
          color: var(--ink-soft, #5a6e63);
        }
        .legal-prose hr {
          border: 0;
          border-top: 1px solid var(--line-soft, #e6e1d4);
          margin: 2em 0;
        }
        .legal-prose table {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
          font-size: 0.95em;
        }
        .legal-prose th, .legal-prose td {
          border: 1px solid var(--line-soft, #e6e1d4);
          padding: 0.5em 0.75em;
          text-align: left;
        }
        .legal-prose th { background: var(--sand, #f3eedf); font-weight: 600; }
      `}</style>
    </main>
  );
}
