/**
 * AskTheGarden — RAG chat UI.
 *
 * Server-component shell; the chat itself streams via the /v1/ask endpoint.
 * Client component below renders the chat with citation chips. Off-topic
 * questions show the escalation card.
 */
import { getTranslations } from 'next-intl/server';
import AskChat from './chat.client.js';

export const dynamic = 'force-dynamic';

export default async function AskPage({ params }: { params: { locale: string } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'Ask' });
  const trending = [
    'What is blooming in the Romeo greenhouse this week?',
    'Which plants here are Endangered or Vulnerable in Finland?',
    'Tell me about the LIFE+ ESCAPE seed bank project.',
  ];
  return (
    <main>
      <header>
        <h1>{t('title')}</h1>
        <p>Grounded · cited · never hallucinated.</p>
      </header>
      <AskChat locale={params.locale as 'en' | 'fi' | 'sv'} starters={trending} />
    </main>
  );
}
