const getResult = url => ({
  url,
  topImageUrl: url,
});

const mod = jest
  .fn()
  .mockImplementation(obj => Promise.resolve(getResult(obj.id)));

module.exports = mod;
mod.getResult = getResult;
