import { describe, it, expect } from 'vitest';
import { parseProfileJson, type ParsedPost } from '../src/modules/instagram/instagram.source.js';

const sample = {
  data: {
    user: {
      edge_owner_to_timeline_media: {
        edges: [
          {
            node: {
              __typename: 'GraphImage',
              shortcode: 'Caaa111',
              display_url: 'https://scontent.cdninstagram.com/a.jpg',
              is_video: false,
              taken_at_timestamp: 1718442720, // 2024-06-15T09:12:00Z
              edge_media_to_caption: { edges: [{ node: { text: 'Spring in the alpine house 🌸' } }] },
            },
          },
          {
            node: {
              __typename: 'GraphSidecar',
              shortcode: 'Cbbb222',
              display_url: 'https://scontent.cdninstagram.com/b.jpg',
              is_video: false,
              taken_at_timestamp: 1718356320,
              edge_media_to_caption: { edges: [] }, // missing caption
            },
          },
          {
            node: {
              __typename: 'GraphVideo',
              shortcode: 'Cccc333',
              display_url: 'https://scontent.cdninstagram.com/c.jpg',
              is_video: true,
              taken_at_timestamp: 1718269920,
              edge_media_to_caption: { edges: [{ node: { text: 'Reel' } }] },
            },
          },
        ],
      },
    },
  },
};

describe('parseProfileJson', () => {
  it('maps edges to ParsedPost with caption, date, media type, permalink', () => {
    const posts = parseProfileJson(sample);
    expect(posts).toHaveLength(3);
    const first = posts[0]!;
    expect(first).toMatchObject<Partial<ParsedPost>>({
      shortcode: 'Caaa111',
      caption: 'Spring in the alpine house 🌸',
      mediaType: 'image',
      displayUrl: 'https://scontent.cdninstagram.com/a.jpg',
      permalink: 'https://www.instagram.com/p/Caaa111/',
    });
    expect(first.takenAt).toBe('2024-06-15T09:12:00.000Z');
    expect(posts[1]!.caption).toBeNull();          // missing caption → null
    expect(posts[1]!.mediaType).toBe('carousel');  // GraphSidecar
    expect(posts[2]!.mediaType).toBe('video');     // GraphVideo
  });

  it('respects max and tolerates malformed input', () => {
    expect(parseProfileJson(sample, 2)).toHaveLength(2);
    expect(parseProfileJson({})).toEqual([]);
    expect(parseProfileJson(null)).toEqual([]);
    expect(parseProfileJson({ data: { user: {} } })).toEqual([]);
  });
});
