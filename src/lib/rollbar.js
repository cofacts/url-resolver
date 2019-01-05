// include and initialize the rollbar library with your access token
var Rollbar = require('rollbar');
const enabled = !!process.env.ROLLBAR_TOKEN;
var rollbar = new Rollbar({
  enabled,
  accessToken: process.env.ROLLBAR_TOKEN,
  environment: process.env.ROLLBAR_ENV || 'localhost',
  captureUncaught: enabled,
  captureUnhandledRejections: enabled,
  verbose: true,
});

module.exports = rollbar;
