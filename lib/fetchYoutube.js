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
  const {data} = await yt.videos.list({
    id,
    part: 'snippet'
  });

  try {
    const {title, description, thumbnails: {maxres: {url: topImageUrl}}} = data.items[0].snippet
    return {
      canonical: `https://youtu.be/${id}`,
      title,
      summary: description,
      html: '',
      topImageUrl,
      status: 200,
    }
  } catch(e) {
    console.error('Youtube data extract error', e);
    console.error('Original data', data)

    return null;
  }
}

module.exports = fetchYoutube;