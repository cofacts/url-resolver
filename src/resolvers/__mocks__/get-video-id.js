const mod = jest.fn().mockImplementation(url => {
  const res = { id: url, service: 'youtube' };
  if (url.indexOf('youtube') === -1) {
    res.service = 'others';
  }
  return res;
});

module.exports = mod;
