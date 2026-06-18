import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Mock storage so no disk writes; mock the source so no network.
vi.mock('../src/infra/storage.js', () => ({
  uploadToS3: vi.fn(async () => 's3://bloomoulu-assets/instagram/x.jpg'),
}));
vi.mock('../src/modules/instagram/instagram.source.js', () => ({
  fetchInstagramProfile: vi.fn(async () => [
    { shortcode: 'TESTaaa', caption: 'hello', takenAt: '2024-06-15T09:12:00.000Z',
      mediaType: 'image', displayUrl: 'https://scontent.cdninstagram.com/x.jpg',
      permalink: 'https://www.instagram.com/p/TESTaaa/' },
  ]),
}));
// cacheThumbnail does a real fetch of displayUrl — stub global fetch to return bytes.
vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.alloc(2048), {
  status: 200, headers: { 'content-type': 'image/jpeg' },
})));

const prisma = new PrismaClient();
beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => {
  await prisma.instagramPost.deleteMany({ where: { shortcode: 'TESTaaa' } });
  await prisma.$disconnect();
});

describe('processInstagramSync', () => {
  it('upserts live posts from the fetched profile', async () => {
    const { processInstagramSync } = await import(
      '../src/modules/jobs/processors/instagram-sync.processor.js'
    );
    const result = await processInstagramSync({ data: {} } as any);
    expect(result.ok).toBe(true);
    expect(result.synced).toBeGreaterThanOrEqual(1);
    const row = await prisma.instagramPost.findUnique({ where: { shortcode: 'TESTaaa' } });
    expect(row?.isFallback).toBe(false);
    expect(row?.imageUrl).toBe('/v1/files/instagram/TESTaaa.jpg');
  });
});
