jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const {
  isYouTubeUrl,
  isPlaceholderTitle,
  readYouTubeOembed,
} = require('../youtubeOembed');

const VIDEO = 'https://www.youtube.com/watch?v=CC-Eg2vK5gw';
const makeRes = ({ ok = true, json = {} } = {}) => ({
  ok,
  json: async () => json,
});

describe('isYouTubeUrl', () => {
  it.each([
    [VIDEO, true],
    ['https://youtu.be/CC-Eg2vK5gw', true],
    ['https://music.youtube.com/watch?v=x', true],
    ['https://m.youtube.com/shorts/x', true],
    ['https://notyoutube.com/watch?v=x', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isYouTubeUrl(url)).toBe(expected);
  });
});

describe('isPlaceholderTitle', () => {
  it.each([
    [' - YouTube', true],
    ['YouTube', true],
    [undefined, false],
    ['Some video - YouTube', false],
  ])('%s -> %s', (title, expected) => {
    expect(isPlaceholderTitle(title)).toBe(expected);
  });
});

describe('readYouTubeOembed', () => {
  beforeEach(() => fetch.mockReset());

  it('reads title and thumbnail', async () => {
    fetch.mockResolvedValueOnce(
      makeRes({ json: { title: 'Video', thumbnail_url: 'https://i/hq.jpg' } })
    );
    expect(await readYouTubeOembed(VIDEO)).toEqual({
      title: 'Video',
      topImageUrl: 'https://i/hq.jpg',
    });
    expect(fetch.mock.calls[0][0]).toBe(
      'https://www.youtube.com/oembed?url=' +
        encodeURIComponent(VIDEO) +
        '&format=json'
    );
  });

  it('returns null for a rejected URL, a missing title, or a network error', async () => {
    fetch
      .mockResolvedValueOnce(makeRes({ ok: false }))
      .mockResolvedValueOnce(makeRes({ json: {} }))
      .mockRejectedValueOnce(new Error('network'));
    for (let i = 0; i < 3; i++) {
      expect(await readYouTubeOembed(VIDEO)).toBeNull();
    }
  });
});
