/**
 * Curator & AskTheGarden — who replies to escalated questions, the
 * confidence threshold for "I don't know", and the external-reference
 * links shown when a question is out of domain.
 */
import React from 'react';
import ConfigForm, { type ConfigSchema } from './ConfigForm';

const Preview: React.FC<{ values: Record<string, unknown> }> = ({ values }) => {
  const name = (values['ask.curatorName'] as string) || 'the curator';
  const email = (values['ask.curatorEmail'] as string) || 'curator@example.com';
  const sla = (values['ask.curatorReplySlaDays'] as number) ?? 2;
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14, lineHeight: 1.55, color: '#1F3C2D' }}>
      "If you'd like a human's view, we can forward your question to{' '}
      <strong style={{ color: '#2D5440' }}>{name}</strong> at{' '}
      <code style={{ background: '#FAF7EE', padding: '1px 6px', borderRadius: 4 }}>{email}</code> —{' '}
      typically a reply within <strong>{sla}</strong> business day{sla === 1 ? '' : 's'}."
    </div>
  );
};

export const schema: ConfigSchema = {
  title: 'Curator & AskTheGarden',
  kicker: 'AskTheGarden behaviour',
  intro:
    'AskTheGarden answers donor questions from the catalogue. When the model isn’t confident, it offers to forward the question to a curator. These values control that handoff.',
  helpBannerId: 'curator-config-intro',
  helpBannerTitle: 'About the confidence floor',
  helpBanner: (
    <>
      The confidence floor uses <strong>basis points</strong> (10000 = 1.0). Lower numbers let the
      AI answer more questions on its own; higher numbers route more to the curator inbox. Start
      around <strong>1000–2000</strong> (permissive). If you see hallucinated answers in /admin →
      Ask answers, bump it up by 500 at a time.
    </>
  ),
  Preview,
  sections: [
    {
      title: 'Curator profile',
      description: 'Shown in the chat footer and used as the escalation inbox.',
      fields: [
        {
          key: 'ask.curatorName',
          label: 'Curator name',
          help: 'Friendly display name. Shown to donors in the chat ("Curator <Name> typically replies…").',
          type: { kind: 'string', maxLength: 80 },
          default: 'Anna Liisa Ruotsalainen',
        },
        {
          key: 'ask.curatorEmail',
          label: 'Curator email (escalation inbox)',
          help: 'Inbox where escalated questions land. We do NOT show this address publicly unless a donor hits the out-of-domain fallback.',
          type: { kind: 'string', maxLength: 160 },
          default: 'curator@bloomoulu.fi',
        },
        {
          key: 'ask.curatorReplySlaDays',
          label: 'Reply-time promise',
          help: 'How many business days the chat footer promises. Set conservatively — donors should never feel ghosted.',
          type: { kind: 'number', min: 1, max: 30, suffix: 'business days' },
          default: 2,
        },
      ],
    },
    {
      title: 'Quality bar',
      description: 'How confident the model must be before answering directly, and the audit-error target shown to the public.',
      fields: [
        {
          key: 'ask.confidenceThresholdBp',
          label: 'Confidence floor',
          help:
            'In basis points (10000 = 1.0). The reranker emits 0–1 sigmoid scores. 1000 = 0.10 (permissive, lets aggregate questions through). 7200 = 0.72 (strict).',
          hint: 'Range 0–10000',
          type: { kind: 'number', min: 0, max: 10000, suffix: 'bp (0–10000)' },
          default: 1000,
        },
        {
          key: 'ask.auditErrorTarget',
          label: 'Audit error target',
          help: 'Decimal (0.05 = 5 %). Shown on the right rail of /ask so donors know the quality bar.',
          type: { kind: 'number', min: 0, max: 1, step: 0.01, suffix: 'decimal' },
          default: 0.05,
        },
      ],
    },
    {
      title: 'Out-of-domain fallback links',
      description:
        'When the donor asks about a plant outside the Garden’s collection, AskTheGarden links to these sites instead of fabricating an answer.',
      fields: [
        {
          key: 'ask.outOfDomain.bgci',
          label: 'BGCI PlantSearch',
          help: 'Botanic Gardens Conservation International — global species database.',
          type: { kind: 'url' },
          default: 'https://tools.bgci.org/plant_search.php',
        },
        {
          key: 'ask.outOfDomain.gbif',
          label: 'GBIF species search',
          help: 'Global Biodiversity Information Facility — taxonomic records.',
          type: { kind: 'url' },
          default: 'https://www.gbif.org/species/search',
        },
        {
          key: 'ask.outOfDomain.plantnet',
          label: 'Pl@ntNet (image ID)',
          help: 'Used as fallback when the donor wants to identify a plant from a photo.',
          type: { kind: 'url' },
          default: 'https://identify.plantnet.org/',
        },
      ],
    },
  ],
};

const CuratorConfig: React.FC = () => <ConfigForm schema={schema} />;
export default CuratorConfig;
