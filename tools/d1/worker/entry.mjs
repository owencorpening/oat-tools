// Module-format entry for deployment; index.js stays CommonJS for tests and local-dev-server.
import worker from './index.js';

export default {
  fetch: worker.fetch
};
