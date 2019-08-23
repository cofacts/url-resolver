const normalResponse = {
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

let mockedResponse;

const mod = {
  google: {
    youtube: () => ({
      videos: {
        list: () => Promise.resolve(mockedResponse),
      },
    }),
  },
  __setResponse: (response = normalResponse) => {
    mockedResponse = response;
  },
};

module.exports = mod;
