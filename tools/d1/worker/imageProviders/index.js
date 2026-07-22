'use strict';

const pexels = require('./pexels');
const unsplash = require('./unsplash');
const pixabay = require('./pixabay');
const openverse = require('./openverse');
const wikimedia = require('./wikimedia');
const smithsonian = require('./smithsonian');
const loc = require('./loc');

// Every provider module must implement this shape. Enforced below at load
// time (not just by convention) so a malformed provider fails loudly on
// deploy instead of silently breaking search/capture at runtime.
//
// Required:
//   id                        - stable string key, matches the module's registry entry
//   label                     - human-readable name for the panel UI
//   descriptor()              - () => {id, label}
//   isEnabled(env)            - (env) => boolean, usually "is the API key set"
//   search({query,page,perPage}, env) - (params, env) => {results, page, perPage, totalResults, nextPage?}
//   resolve({providerId,sourceUrl}, env) - (params, env) => normalized asset fields (or {} if not found)
//   normalizePhoto(rawApiRecord)      - (raw) => the same normalized shape resolve()/search() return
//
// Optional (provider-specific — absence is a no-op, not an error):
//   extractPhotoId(sourceUrl)         - parse a pasted URL back to a provider id, for manual intake
//   pingDownloadLocation(url, env)    - use-time API obligation (Unsplash API Guidelines); see
//                                       handlePingDownloadLocation in index.js, which feature-detects this
const REQUIRED_METHODS = ['descriptor', 'isEnabled', 'search', 'resolve', 'normalizePhoto'];

const PROVIDERS = { pexels, unsplash, pixabay, openverse, wikimedia, smithsonian, loc };

for (const [key, provider] of Object.entries(PROVIDERS)) {
  if (!provider || typeof provider !== 'object') {
    throw new Error(`imageProviders/${key}: module must export an object`);
  }
  if (provider.id !== key) {
    throw new Error(`imageProviders/${key}: provider.id ("${provider.id}") must match its registry key`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`imageProviders/${key}: missing required method "${method}"`);
    }
  }
}

module.exports = { PROVIDERS };
