/**
 * Redis pub/sub for cross-process, cross-instance change broadcasts.
 *
 * Anything that mutates admin-managed state (SystemSetting writes,
 * Plant edits, AskAnswer reactions, RagDocument changes, etc.) calls
 * `pubsub.publish(channel, payload)`. Other instances of the API
 * subscribe via the SettingsService to invalidate their in-memory
 * caches, and the SSE endpoint fans the same message out to every
 * connected browser tab so they all `router.refresh()` immediately.
 *
 * One publisher + one subscriber connection. Ioredis requires a
 * dedicated client per subscription, which is why we hold them
 * separately. Both share the same connection URL.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';

/** All channels we ever publish on. New channels go here so the
 *  subscriber pre-registers and consumers in other modules can
 *  type-check the channel names against a fixed list. */
export const PUBSUB_CHANNELS = [
  'admin.changed',
  'settings.updated',
  'plants.updated',
  'tiers.updated',
  'corpus.updated',
] as const;
export type PubsubChannel = (typeof PUBSUB_CHANNELS)[number];

export interface PubsubMessage<T = unknown> {
  channel: PubsubChannel;
  payload: T;
}

@Injectable()
export class PubsubService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubsubService.name);
  private pub!: Redis;
  private sub!: Redis;

  async onModuleInit() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.pub = new Redis(url, { maxRetriesPerRequest: null });
    this.sub = new Redis(url, { maxRetriesPerRequest: null });
    await this.sub.subscribe(...PUBSUB_CHANNELS);
    this.sub.on('message', (channel, raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
      this.logger.debug?.(`pubsub recv ${channel}: ${raw.slice(0, 120)}`);
      this.emit('message', { channel: channel as PubsubChannel, payload });
      this.emit(channel, payload);
    });
    this.logger.log(`pubsub subscribed: ${PUBSUB_CHANNELS.join(', ')}`);
  }

  async onModuleDestroy() {
    try {
      await this.sub?.quit();
    } catch {/* ignore */}
    try {
      await this.pub?.quit();
    } catch {/* ignore */}
  }

  /** Broadcast a change. Returns the number of subscribers across all
   *  Redis-connected instances (best-effort; never throws). */
  async publish<T>(channel: PubsubChannel, payload: T): Promise<number> {
    try {
      const n = await this.pub.publish(channel, JSON.stringify(payload));
      this.logger.debug?.(`pubsub send ${channel} -> ${n} sub(s)`);
      return n;
    } catch (err) {
      this.logger.warn(`pubsub publish failed for ${channel}: ${(err as Error).message}`);
      return 0;
    }
  }
}
