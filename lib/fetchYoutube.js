const { google } = require('googleapis');

const yt = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

/**
 * Fetches the given youtube id
 * @param {string} id - The Youtube ID to fetch information
 * @return {Promise<ScrapResult | null>}
 */
async function fetchYoutube(id) {
  const { data } = await yt.videos.list({
    id,
    part: 'snippet',
  });

  try {
    const { title, description, thumbnails } = data.items[0].snippet;

    const topImageUrl = [
      'maxres',
      'standard',
      'high',
      'medium',
      'default',
    ].reduce((url, res) => {
      if (url) return url; // Skip if already found url
      if (thumbnails[res]) return thumbnails[res].url;
    }, undefined);

    return {
      canonical: `https://youtu.be/${id}`,
      title,
      summary: description,
      html: '',
      topImageUrl,
      status: 200,
    };
  } catch (e) {
    console.error('Youtube data extract error', e); // eslint-disable-line no-console
    console.error('Original data', data); // eslint-disable-line no-console

    return null;
  }
}

module.exports = fetchYoutube;
