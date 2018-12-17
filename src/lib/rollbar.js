// include and initialize the rollbar library with your access token
var Rollbar = require('rollbar');
var rollbar = new Rollbar({
  enabled: !!process.env.ROLLBAR_TOKEN,
  accessToken: process.env.ROLLBAR_TOKEN,
  environment: process.env.ROLLBAR_ENV || 'localhost',
  captureUncaught: true,
  captureUnhandledRejections: true,
  verbose: true,
});

module.exports = rollbar;
