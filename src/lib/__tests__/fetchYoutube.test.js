jest.mock('googleapis');

const id = 'some-id';
const ResolveError = require('../ResolveError');
const fetchYoutube = require('../fetchYoutube');

describe('fetchYoutube', () => {
  it('should be able to fetch information of a youtube video', async () => {
    require('googleapis').__setResponse();

    const otherProperties = ['title', 'summary', 'html', 'topImageUrl'];
    const response = await fetchYoutube(id);
    expect(response.canonical).toBe(`https://youtu.be/${id}`);
    expect(response.status).toBe(200);
    otherProperties.map(property => expect(response).toHaveProperty(property));
  });

  it('should return 404 if nothing is found', async () => {
    require('googleapis').__setResponse({ data: { items: [] } });
    const response = await fetchYoutube(id);
    expect(response.status).toBe(404);
  });

  it('should throw an error if something is wrong with youtube api', async () => {
    require('googleapis').__setResponse({
      data: { items: [{ not_snippet: '' }] },
    });
    await expect(fetchYoutube(id)).rejects.toThrow(ResolveError);
  });
});
