jest.mock('googleapis');

// const testCases is only for testing; it doesn't exist in the real module.
const { testCases } = require('googleapis');

const ResolveError = require('../ResolveError');
const fetchYoutube = require('../fetchYoutube');

describe('fetchYoutube', () => {
  it('should be able to fetch information of a youtube video', async () => {
    const id = 'some-id';
    const otherProperties = ['title', 'summary', 'html', 'topImageUrl'];
    const response = await fetchYoutube(id);
    expect(response.canonical).toBe(`https://youtu.be/${id}`);
    expect(response.status).toBe(200);
    otherProperties.map(property => expect(response).toHaveProperty(property));
  });

  it('should return 404 if nothing is found', async () => {
    const response = await fetchYoutube(testCases.EMPTY);
    expect(response.status).toBe(404);
  });

  it('should throw an error if something is wrong with youtube api', async () => {
    const test = async () => await fetchYoutube(testCases.THROW_ERROR);
    await expect(test()).rejects.toThrow(ResolveError);
  });
});
