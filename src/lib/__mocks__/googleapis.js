const testCases = {
  EMPTY: 'empty',
  THROW_ERROR: 'throw_error',
};

const response = {
  data: {
    items: [
      {
        snippet: {
          title: 'some title',
          description: 'some description',
          thumbnails: {
            standard: {
              url: 'some url',
            },
          },
        },
      },
    ],
  },
};

const yt = {
  videos: {
    list: jest.fn().mockImplementation(obj => {
      if (obj.id === testCases.EMPTY) {
        return Promise.resolve({ data: { items: [] } });
      }
      if (obj.id === testCases.THROW_ERROR) {
        return Promise.resolve({ data: { items: [{ not_snippet: '' }] } });
      }
      return Promise.resolve(response);
    }),
  },
};

const mod = {
  google: {
    youtube: jest.fn().mockReturnValue(yt),
  },
  testCases, // Only in this mocked module
};

module.exports = mod;
