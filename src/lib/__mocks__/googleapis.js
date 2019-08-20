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

let yt;

const mod = {
  google: {
    youtube: () => yt,
  },
  __setResponse: (response = normalResponse) => {
    yt = {
      videos: {
        list: () => Promise.resolve(response),
      },
    };
  },
};

module.exports = mod;
