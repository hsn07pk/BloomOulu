import { request } from 'undici';

const NTFY_BASE = process.env.NTFY_BASE_URL ?? 'http://ntfy';
const NTFY_TOPIC = process.env.NTFY_TOPIC ?? 'bloomoulu-alerts';

export interface NtfyAlert {
  tier: 'P0' | 'P1' | 'P2';
  title: string;
  body: string;
}

export async function ntfyAlert(alert: NtfyAlert): Promise<void> {
  if (!NTFY_BASE) return;
  try {
    await request(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        title: alert.title,
        priority: alert.tier === 'P0' ? 'urgent' : alert.tier === 'P1' ? 'high' : 'default',
        tags: alert.tier.toLowerCase(),
      },
      body: alert.body,
    });
  } catch {
    // alerts are best-effort; never throw out of the caller
  }
}
