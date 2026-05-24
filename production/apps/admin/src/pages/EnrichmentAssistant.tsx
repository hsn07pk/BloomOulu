/**
 * Admin · Add plant with assistant.
 *
 * Curator types a Latin name → page calls /v1/admin/enrichment/preview →
 * the assistant returns story / origin / status / image gathered from open
 * data sources WITHOUT writing anything to the DB. Curator can:
 *   • Toggle which fields to keep (off-by-default fields are still archived
 *     as 'rejected' EnrichmentSuggestion rows so the data isn't lost).
 *   • Edit the fetched values inline.
 *   • Manually create the Plant row via AdminJS → "Plants → New" with the
 *     kept values pasted in.
 */
import React, { useState } from 'react';
import {
  Button,
  Card,
  DocLink,
  EmptyState,
  HelpBanner,
  InfoTooltip,
  Notice,
  Page,
  PageHeader,
  StatusPill,
} from './shared/ui';
import { colors, font, fontSize, radius, space } from './shared/tokens';

interface PreviewSlot<T = unknown> {
  value: T;
  source: { provider: string; url?: string };
}

interface PreviewResponse {
  latinName: string;
  preview: {
    story: PreviewSlot<{ en?: string }> | null;
    origin: PreviewSlot<string> | null;
    status: PreviewSlot<string> | null;
    image: PreviewSlot<{ url?: string; attribution?: string; licenseSpdx?: string }> | null;
  };
}

type Field = 'story' | 'origin' | 'status' | 'image';
const FIELDS: Field[] = ['story', 'origin', 'status', 'image'];
const LABELS: Record<Field, string> = {
  story: 'Story',
  origin: 'Native origin',
  status: 'Red List status',
  image: 'Photo',
};
const ICONS: Record<Field, string> = {
  story: '📖',
  origin: '🌍',
  status: '🛡',
  image: '📷',
};

const HINTS: Record<Field, string> = {
  story: 'Long-form paragraph shown on the public plant page. Pulled from Wikipedia, GBIF, or EOL summary.',
  origin: 'Short factual string. e.g. "Northern boreal forests, Fennoscandia".',
  status: 'IUCN Red List category. CR · EN · VU · NT · LC · DD · NE.',
  image: 'Primary photo. Pulled from Wikimedia Commons or iNaturalist with a free license.',
};

// All /v1/* calls go through the admin server's same-origin proxy
// (server.ts onRequest hook → process.env.API_URL || localhost:4000).
// Keeps the page identical in standalone dev and behind-Caddy prod.

const EnrichmentAssistant: React.FC = () => {
  const [latinName, setLatinName] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [keep, setKeep] = useState<Record<Field, boolean>>({
    story: true,
    origin: true,
    status: true,
    image: true,
  });
  const [editedStoryEn, setEditedStoryEn] = useState('');
  const [editedOrigin, setEditedOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createMsg, setCreateMsg] = useState<{ kind: 'ok' | 'err'; text: string; href?: string } | null>(null);

  async function createPlant() {
    if (!preview) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      const dto: Record<string, unknown> = { latinName: preview.latinName };
      if (keep.origin) dto.origin = editedOrigin;
      if (keep.status && preview.preview.status)
        dto.redListStatus = String(preview.preview.status.value);
      if (keep.story) dto.storyEn = editedStoryEn;
      if (keep.image && preview.preview.image) {
        const img = preview.preview.image.value;
        dto.imageUrl = img.url;
        dto.attribution = img.attribution;
        dto.licenseSpdx = img.licenseSpdx;
      }
      const res = await fetch('/admin/plants/create-from-assistant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dto),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        slug?: string;
        alreadyExisted?: boolean;
        error?: string;
      };
      if (!res.ok || !data.id) throw new Error(data.error ?? `HTTP ${res.status}`);
      const href = `/admin/resources/Plant/records/${data.id}/edit`;
      setCreateMsg({
        kind: 'ok',
        text: data.alreadyExisted
          ? `A plant with this Latin name already exists — opening the existing record.`
          : `Plant created. Opening AdminJS edit form so you can finish up.`,
        href,
      });
      // Give the curator a moment to read the success notice, then jump.
      window.setTimeout(() => {
        window.location.href = href;
      }, 1200);
    } catch (e) {
      setCreateMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setCreating(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setErr(null);
    setPreview(null);
    try {
      const r = await fetch(`/v1/admin/enrichment/preview`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ latinName: latinName.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as PreviewResponse;
      setPreview(data);
      setEditedStoryEn(data.preview.story?.value.en ?? '');
      setEditedOrigin((data.preview.origin?.value as string) ?? '');
      setKeep({
        story: !!data.preview.story,
        origin: !!data.preview.origin,
        status: !!data.preview.status,
        image: !!data.preview.image,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const slotsFound = preview
    ? FIELDS.filter((f) => preview.preview[f] !== null).length
    : 0;
  const slotsMissing = preview ? 4 - slotsFound : 0;

  return (
    <Page narrow>
      <PageHeader
        kicker="Add plant"
        title="Open-data assistant"
        lede="Type a Latin name. The assistant queries Wikipedia, GBIF, laji.fi, and Wikimedia Commons / iNaturalist in parallel and shows what it finds. Pick which fields to keep; the rest stays in the audit trail as rejected suggestions so nothing is lost."
      />

      <HelpBanner
        id="enrichment-assistant-intro-v2"
        title="One-click workflow"
      >
        Type a Latin name, fetch the open-data values, untick anything that looks wrong, then
        hit <strong>Create plant</strong>. A Plant row (and a Taxon if the Latin name is new) is
        inserted with the kept values, the photo is attached as the primary image, and you’re
        dropped into the AdminJS edit form to finish up. From there the 24/7 worker takes over
        and refreshes the plant on its normal cadence.
      </HelpBanner>

      <Card
        title="Look up a species"
        description="Use the canonical Latin (binomial) name. Subspecies and authorship are ignored — e.g. type “Abies alba” rather than “Abies alba Mill.”."
      >
        <div style={{ display: 'flex', gap: space[2], flexWrap: 'wrap' }}>
          <input
            type="text"
            value={latinName}
            onChange={(e) => setLatinName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && latinName.trim().length >= 2) void runPreview();
            }}
            placeholder="e.g. Abies alba, Trollius europaeus…"
            aria-label="Latin name"
            style={{
              flex: '1 1 320px',
              padding: '10px 14px',
              fontSize: fontSize.md,
              borderRadius: radius.md,
              border: `1px solid ${colors.line}`,
              background: colors.cream,
              fontFamily: font.body,
              color: colors.ink,
              fontStyle: 'italic',
              boxSizing: 'border-box',
            }}
          />
          <Button
            variant="primary"
            size="lg"
            onClick={() => void runPreview()}
            disabled={latinName.trim().length < 2}
            loading={busy}
            leftIcon="⌕"
          >
            {busy ? 'Fetching…' : 'Fetch from sources'}
          </Button>
        </div>
      </Card>

      {err && (
        <Notice tone="danger" title="Couldn’t fetch enrichment data" onDismiss={() => setErr(null)}>
          {err}
        </Notice>
      )}

      {!preview && !busy && (
        <Card>
          <EmptyState
            variant="idle"
            title="Type a Latin name to begin"
            description="Once you fetch, you’ll see story, origin, Red List status, and photo side by side — keep what looks right and discard the rest."
          />
        </Card>
      )}

      {preview && (
        <Card
          kicker={`Results · ${preview.latinName}`}
          title={`${slotsFound}/4 fields found${slotsMissing > 0 ? ` · ${slotsMissing} missing` : ''}`}
          description={
            slotsMissing > 0
              ? 'Sources may not have data for some fields, or the Latin name spelling may not match. Try the alternative spelling, or just save what you have.'
              : 'All four open-data sources returned something. Review the values, untick anything that looks wrong, then create the plant in AdminJS.'
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
            {FIELDS.map((f) => {
              const slot = preview.preview[f];
              return (
                <article
                  key={f}
                  style={{
                    background: slot ? colors.paper : colors.whisper,
                    border: `1px solid ${slot ? colors.line : colors.lineSoft}`,
                    borderRadius: radius.md,
                    padding: `${space[3]} ${space[4]}`,
                    opacity: slot ? 1 : 0.7,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <label
                      style={{
                        display: 'inline-flex',
                        gap: 8,
                        alignItems: 'center',
                        fontWeight: 600,
                        color: colors.forestDeep,
                        fontFamily: font.display,
                        fontSize: fontSize.lg,
                        cursor: slot ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={keep[f]}
                        disabled={!slot}
                        onChange={(e) => setKeep((p) => ({ ...p, [f]: e.target.checked }))}
                        style={{
                          width: 18,
                          height: 18,
                          accentColor: colors.forestMid,
                          cursor: slot ? 'pointer' : 'not-allowed',
                        }}
                      />
                      <span aria-hidden="true">{ICONS[f]}</span>
                      {LABELS[f]}
                      <InfoTooltip label={HINTS[f]} />
                    </label>
                    {slot ? (
                      <span
                        style={{
                          fontSize: fontSize.sm,
                          color: colors.inkMute,
                          marginLeft: 'auto',
                        }}
                      >
                        from <strong>{slot.source.provider}</strong>
                        {slot.source.url && (
                          <>
                            {' · '}
                            <a
                              href={slot.source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: colors.moss,
                                textDecoration: 'underline',
                                textUnderlineOffset: 2,
                              }}
                            >
                              view source ↗
                            </a>
                          </>
                        )}
                      </span>
                    ) : (
                      <span style={{ marginLeft: 'auto' }}>
                        <StatusPill tone="neutral" dot>no data</StatusPill>
                      </span>
                    )}
                  </div>
                  {slot && (
                    <div style={{ marginTop: 12 }}>
                      {f === 'story' && (
                        <textarea
                          value={editedStoryEn}
                          onChange={(e) => setEditedStoryEn(e.target.value)}
                          rows={6}
                          aria-label="Story (English)"
                          style={{
                            width: '100%',
                            padding: `${space[3]}`,
                            borderRadius: radius.sm,
                            border: `1px solid ${colors.line}`,
                            background: colors.cream,
                            fontSize: fontSize.base,
                            fontFamily: font.body,
                            color: colors.ink,
                            lineHeight: 1.6,
                            resize: 'vertical',
                            boxSizing: 'border-box',
                          }}
                        />
                      )}
                      {f === 'origin' && (
                        <input
                          type="text"
                          value={editedOrigin}
                          onChange={(e) => setEditedOrigin(e.target.value)}
                          aria-label="Native origin"
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: radius.sm,
                            border: `1px solid ${colors.line}`,
                            background: colors.cream,
                            fontSize: fontSize.base,
                            fontFamily: font.body,
                            color: colors.ink,
                            boxSizing: 'border-box',
                          }}
                        />
                      )}
                      {f === 'status' && (
                        <StatusPill tone="info" dot>
                          {String(slot.value)}
                        </StatusPill>
                      )}
                      {f === 'image' && preview.preview.image && (
                        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={preview.preview.image.value.url}
                            alt=""
                            loading="lazy"
                            style={{
                              width: 200,
                              height: 200,
                              objectFit: 'cover',
                              borderRadius: radius.md,
                              border: `1px solid ${colors.line}`,
                              background: colors.whisper,
                            }}
                          />
                          <div style={{ fontSize: fontSize.sm, color: colors.inkMute, lineHeight: 1.55 }}>
                            <div style={{ color: colors.forest, fontWeight: 500 }}>
                              {preview.preview.image.value.attribution}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              License: <code style={{ fontFamily: font.mono }}>{preview.preview.image.value.licenseSpdx ?? 'unknown'}</code>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div
            style={{
              display: 'flex',
              gap: space[3],
              alignItems: 'center',
              padding: `${space[4]} ${space[5]}`,
              borderRadius: radius.lg,
              background: colors.sage,
              border: `1px solid ${colors.olive}`,
              marginTop: space[3],
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 1, minWidth: 240 }}>
              <div
                style={{
                  fontFamily: font.display,
                  fontSize: fontSize.lg,
                  color: colors.forestDeep,
                  fontWeight: 600,
                }}
              >
                Create the plant with the kept values
              </div>
              <div
                style={{
                  color: colors.inkSoft,
                  fontSize: fontSize.sm,
                  lineHeight: 1.55,
                  marginTop: 2,
                }}
              >
                Inserts a Plant row (and a Taxon if the Latin name is new), attaches the photo,
                and jumps you to the AdminJS edit form to finish up — no copy-pasting required.
              </div>
            </div>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void createPlant()}
              loading={creating}
              leftIcon="+"
            >
              Create plant
            </Button>
          </div>

          {createMsg && (
            <div style={{ marginTop: space[3] }}>
              <Notice
                tone={createMsg.kind === 'ok' ? 'success' : 'danger'}
                onDismiss={() => setCreateMsg(null)}
              >
                {createMsg.text}
                {createMsg.href && (
                  <>
                    {' '}
                    <DocLink href={createMsg.href}>Open now →</DocLink>
                  </>
                )}
              </Notice>
            </div>
          )}

          <Notice tone="info" title="Or do it manually">
            Prefer to fill the form by hand? Open{' '}
            <DocLink href="/admin/resources/Plant/actions/new">Plants → New</DocLink> in a new
            tab and copy the kept values above.
          </Notice>
        </Card>
      )}
    </Page>
  );
};

export default EnrichmentAssistant;
