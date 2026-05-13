import type { Job } from 'bullmq';
import { prisma } from '@bloomoulu/db';
import { ntfyAlert } from '../../../infra/alerts.js';

/**
 * Every 5 minutes, check every paired KioskDevice. If lastSeen > 5 min ago,
 * mark offline and alert ops. If already offline > 30 min, escalate to P0.
 */
export async function processKioskWatchdog(_job: Job) {
  const now = Date.now();
  const devices = await prisma.kioskDevice.findMany({ where: { status: { in: ['paired', 'offline'] } } });
  let newlyOffline = 0;
  for (const d of devices) {
    const age = d.lastSeen ? now - d.lastSeen.getTime() : Infinity;
    if (age > 5 * 60_000 && d.status === 'paired') {
      await prisma.kioskDevice.update({ where: { id: d.id }, data: { status: 'offline' } });
      await prisma.kioskEvent.create({
        data: { deviceId: d.id, kind: 'offline', payload: { lastSeenAgo: age } as any },
      });
      await ntfyAlert({
        tier: 'P1',
        title: `Kiosk offline: ${d.label}`,
        body: `Last seen ${Math.round(age / 60_000)} min ago at ${d.location}`,
      });
      newlyOffline++;
    } else if (age > 30 * 60_000 && d.status === 'offline') {
      await ntfyAlert({
        tier: 'P0',
        title: `Kiosk DOWN >30 min: ${d.label}`,
        body: `Check the device at ${d.location}.`,
      });
    } else if (age < 5 * 60_000 && d.status === 'offline') {
      await prisma.kioskDevice.update({ where: { id: d.id }, data: { status: 'paired' } });
    }
  }
  return { newlyOffline };
}
