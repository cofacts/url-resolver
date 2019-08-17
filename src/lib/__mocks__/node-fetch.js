const testCases = {
  NETWORK_TIMEOUT: 'network_timeout',
  SOCKET_HANG_UP: 'socket_hang_up',
  ECONNREFUSED: 'ECONNREFUSED',
  HOSTNAME_MISMATCH: 'hostname_does_not_match_altname',
  SOME_OTHER_ERROR: 'some_other_error',
  NO_LOCATION: 'no_location',
};

const LOCATION = 'some_location';

const mod = url => {
  if (url === testCases.NETWORK_TIMEOUT) {
    const err = new Error('network timeout at:');
    err.name = 'FetchError';
    throw err;
  } else if (url === testCases.SOCKET_HANG_UP) {
    throw new Error('reason: socket hang up');
  } else if (url === testCases.ECONNREFUSED) {
    throw new Error('reason: connect ECONNREFUSED');
  } else if (url === testCases.HOSTNAME_MISMATCH) {
    throw new Error("reason: Hostname/IP doesn't match certificate's altnames");
  } else if (url === testCases.SOME_OTHER_ERROR) {
    throw new Error(testCases.SOME_OTHER_ERROR);
  }

  const response = {
    headers: {
      get: jest.fn().mockReturnValue(LOCATION),
    },
  };
  if (url === testCases.NO_LOCATION) {
    response.headers.get = jest.fn();
  }
  return response;
};

module.exports = mod;
mod.testCases = testCases;
mod.location = LOCATION;
