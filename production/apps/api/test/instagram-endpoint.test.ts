import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
beforeAll(async () => {
  await prisma.$connect();
  await prisma.instagramPost.deleteMany({ where: { shortcode: { in: ['EPlive1', null as any] } } });
  await prisma.instagramPost.create({
    data: { shortcode: 'EPlive1', caption: 'c', takenAt: new Date(), mediaType: 'image',
      imageUrl: '/v1/files/instagram/EPlive1.jpg', permalink: 'https://www.instagram.com/p/EPlive1/',
      displayOrder: 0, isFallback: false },
  });
});
afterAll(async () => {
  await prisma.instagramPost.deleteMany({ where: { shortcode: 'EPlive1' } });
  await prisma.$disconnect();
});

describe('GET /v1/instagram selection logic', () => {
  it('returns live posts mapped to the public shape', async () => {
    const { InstagramController } = await import('../src/modules/instagram/instagram.controller.js');
    const ctrl = new InstagramController(prisma as any);
    const res = await ctrl.feed();
    expect(res.source).toBe('live');
    expect(res.posts[0]).toMatchObject({ shortcode: 'EPlive1', imageUrl: '/v1/files/instagram/EPlive1.jpg' });
  });
});
