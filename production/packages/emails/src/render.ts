import mjml2html from 'mjml';

interface MjmlResult {
  html: string;
  errors: Array<{ formattedMessage?: string; message?: string }>;
}

/**
 * Render an MJML template with simple `{{var}}` interpolation. Used by both
 * the worker (final email body) and the AdminJS preview page (live preview).
 *
 * We deliberately do not pull in a full templating engine (handlebars, ejs)
 * to keep the surface minimal and the security audit trivial.
 */
export function renderMjml(
  mjml: string,
  vars: Record<string, string>,
): string {
  const interpolated = mjml.replace(/\{\{(\w+)\}\}/g, (_, k) => escape(vars[k] ?? ''));
  // @types/mjml@5 declares an async signature, but runtime mjml@4 is sync.
  const { html, errors } = mjml2html(interpolated, { validationLevel: 'soft' }) as unknown as MjmlResult;
  if (errors.length) {
    // eslint-disable-next-line no-console
    console.warn('MJML render warnings:', errors);
  }
  return html;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
