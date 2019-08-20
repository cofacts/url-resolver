let functionBody;
let response;
const mod = () => {
  if (functionBody !== undefined) {
    functionBody();
  }
  return response;
};

mod.__setupFetch = (resp, func = undefined) => {
  functionBody = func;
  response = resp;
};

module.exports = mod;
