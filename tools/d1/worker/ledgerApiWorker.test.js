'use strict';

const assert = require('assert');
const { handleRequest } = require('./index');

async function testCreateAsset() {
  const env = { DB: new FakeD1(), LEDGER_API_TOKEN: 'secret' };
  const response = await handleRequest(jsonRequest('/assets', {
    asset: {
      id: 'asset-1',
      assetType: 'image',
      slug: 'river-map',
      displayName: 'River Map',
      sourceUrl: 'https://example.com/river-map.jpg',
      photographer: 'Owen',
      license: 'OAT'
    }
  }, 'secret'), env);
  const body = await response.json();

  assert.strictEqual(response.status, 201);
  assert.strictEqual(body.asset.display_name, 'River Map');
  assert.strictEqual(env.DB.one('asset', 'asset-1').source_url, 'https://example.com/river-map.jpg');
}

async function testCaptureImage() {
  const fetched = [];
  const env = {
    DB: new FakeD1(),
    LEDGER_API_TOKEN: 'secret',
    UNSPLASH_ACCESS_KEY: 'unsplash-key',
    fetch: async url => {
      fetched.push(url);
      return {
        ok: true,
        json: async () => ({
          user: { name: 'API Photographer' },
          urls: { regular: 'https://images.unsplash.com/api-photo' }
        })
      };
    }
  };
  const response = await handleRequest(jsonRequest('/captures/image', {
    id: 'asset-capture',
    pageTitle: 'River Crossing Photo',
    sourceUrl: 'https://unsplash.com/photos/river-crossing-abc123',
    photographer: 'Scraped Photographer',
    intakeSection: 'standalone/river-story'
  }, 'secret'), env);
  const body = await response.json();
  const row = env.DB.one('asset', 'asset-capture');

  assert.strictEqual(response.status, 201);
  assert.strictEqual(body.asset.id, 'asset-capture');
  assert.strictEqual(row.slug, 'river-crossing-photo');
  assert.strictEqual(row.source_url, 'https://unsplash.com/photos/river-crossing-abc123');
  assert.strictEqual(row.image_src, 'https://images.unsplash.com/api-photo');
  assert.strictEqual(row.photographer, 'API Photographer');
  assert.strictEqual(row.license, 'Unsplash License');
  assert.strictEqual(row.attribution, 'Image: River Crossing Photo, by API Photographer, Source: unsplash.com. License: Unsplash License.');
  assert.strictEqual(row.status, 'staged');
  assert.strictEqual(row.intake_section, 'standalone/river-story');
  assert.deepStrictEqual(fetched, [
    'https://api.unsplash.com/photos/abc123?client_id=unsplash-key'
  ]);
}

async function testCaptureImageResolvesBareUnsplashId() {
  const fetched = [];
  const env = {
    DB: new FakeD1(),
    LEDGER_API_TOKEN: 'secret',
    UNSPLASH_ACCESS_KEY: 'unsplash-key',
    fetch: async url => {
      fetched.push(url);
      return {
        ok: true,
        json: async () => ({
          user: { name: 'API Photographer' },
          urls: { regular: 'https://images.unsplash.com/api-photo' }
        })
      };
    }
  };
  await handleRequest(jsonRequest('/captures/image', {
    id: 'asset-capture-bare',
    pageTitle: 'Bare Id Photo',
    sourceUrl: 'https://unsplash.com/photos/eOvv6TjnSjc'
  }, 'secret'), env);

  assert.deepStrictEqual(fetched, [
    'https://api.unsplash.com/photos/eOvv6TjnSjc?client_id=unsplash-key'
  ]);
}

async function testPexelsProviderRoutes() {
  let response = await handleRequest(new Request('https://ledger.test/image-providers'), { DB: new FakeD1() });
  let body = await response.json();
  assert.strictEqual(response.status, 200);
  // Key-gated providers must not show up with no env vars set. (Providers
  // that need no key at all — Openverse, Wikimedia, LOC — are always
  // enabled and expected here; we only assert the negative for pexels.)
  assert(!body.providers.some(p => p.id === 'pexels'), 'pexels should not be enabled without PEXELS_ACCESS_KEY');

  const fetched = [];
  const env = {
    DB: new FakeD1(),
    PEXELS_ACCESS_KEY: 'pexels-key',
    fetch: async (url, init) => {
      fetched.push([url, init]);
      if (String(url).includes('/v1/search')) {
        return {
          ok: true,
          json: async () => ({
            page: 1,
            per_page: 12,
            total_results: 1,
            photos: [pexelsPhoto(1234)]
          })
        };
      }
      if (String(url).includes('/v1/photos/1234')) {
        return {
          ok: true,
          json: async () => pexelsPhoto(1234)
        };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  response = await handleRequest(new Request('https://ledger.test/image-providers'), env);
  body = await response.json();
  assert.strictEqual(response.status, 200);
  assert(body.providers.some(p => p.id === 'pexels'), 'pexels should be enabled with PEXELS_ACCESS_KEY set');

  response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=wetland&providers=pexels'), env);
  body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.results.length, 1);
  assert.strictEqual(body.results[0].provider, 'pexels');
  assert.strictEqual(body.results[0].providerId, '1234');
  assert.strictEqual(body.results[0].sourceUrl, 'https://www.pexels.com/photo/misty-wetland-1234/');
  assert.strictEqual(body.results[0].imageSrc, 'https://images.pexels.com/photos/1234/large2x.jpeg');
  assert.strictEqual(fetched[0][0], 'https://api.pexels.com/v1/search?query=wetland&page=1&per_page=12');
  assert.deepStrictEqual(fetched[0][1].headers, { Authorization: 'pexels-key' });

  response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'pexels',
    providerId: '1234'
  }), env);
  body = await response.json();
  const row = env.DB.one('asset', body.asset.id);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.status, 'staged');
  assert.strictEqual(row.display_name, 'Misty wetland at dawn');
  assert.strictEqual(row.source_name, 'pexels:1234');
  assert.strictEqual(row.source_url, 'https://www.pexels.com/photo/misty-wetland-1234/');
  assert.strictEqual(row.image_src, 'https://images.pexels.com/photos/1234/large2x.jpeg');
  assert.strictEqual(row.photographer, 'Pexels Photographer');
  assert.strictEqual(row.license, 'Pexels License');
  assert.strictEqual(row.requires_attribution, 0);
  assert.strictEqual(row.allows_commercial_use, 1);
  assert.strictEqual(row.allows_modification, 1);
}

async function testPexelsProviderSearchFailureIsControlled() {
  const env = {
    DB: new FakeD1(),
    PEXELS_ACCESS_KEY: 'pexels-key',
    fetch: async () => ({ ok: false, json: async () => ({}) })
  };

  const response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=wetland&providers=pexels'), env);
  const body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(body.results, []);
}

async function testUnsplashProviderRoutes() {
  const fetched = [];
  const env = {
    DB: new FakeD1(),
    UNSPLASH_ACCESS_KEY: 'unsplash-key',
    fetch: async (url, init) => {
      fetched.push([url, init]);
      if (String(url).includes('/search/photos')) {
        return {
          ok: true,
          json: async () => ({
            total: 1,
            total_pages: 1,
            results: [unsplashPhoto('eOvv6TjnSjc')]
          })
        };
      }
      if (String(url).includes('/photos/eOvv6TjnSjc')) {
        return {
          ok: true,
          json: async () => unsplashPhoto('eOvv6TjnSjc')
        };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  let response = await handleRequest(new Request('https://ledger.test/image-providers'), env);
  let body = await response.json();
  assert.strictEqual(response.status, 200);
  assert(body.providers.some(p => p.id === 'unsplash'), 'unsplash should be enabled with UNSPLASH_ACCESS_KEY set');

  response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=wetland&providers=unsplash'), env);
  body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.results.length, 1);
  assert.strictEqual(body.results[0].provider, 'unsplash');
  assert.strictEqual(body.results[0].providerId, 'eOvv6TjnSjc');
  assert.strictEqual(body.results[0].sourceUrl, 'https://unsplash.com/photos/eOvv6TjnSjc');
  assert.strictEqual(body.results[0].imageSrc, 'https://images.unsplash.com/photos/eOvv6TjnSjc/regular.jpeg');
  assert(String(fetched[0][0]).startsWith('https://api.unsplash.com/search/photos?query=wetland&page=1&per_page=12'));

  response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'unsplash',
    providerId: 'eOvv6TjnSjc'
  }), env);
  body = await response.json();
  const row = env.DB.one('asset', body.asset.id);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.status, 'staged');
  assert.strictEqual(row.display_name, 'Misty wetland at dawn');
  assert.strictEqual(row.source_name, 'unsplash:eOvv6TjnSjc');
  assert.strictEqual(row.source_url, 'https://unsplash.com/photos/eOvv6TjnSjc');
  assert.strictEqual(row.image_src, 'https://images.unsplash.com/photos/eOvv6TjnSjc/regular.jpeg');
  assert.strictEqual(row.photographer, 'Unsplash Photographer');
  assert.strictEqual(row.license, 'Unsplash License');
  assert.strictEqual(row.requires_attribution, 0);
  assert.strictEqual(row.allows_commercial_use, 1);
  assert.strictEqual(row.allows_modification, 1);
  assert.strictEqual(row.provider, 'unsplash');
  assert.strictEqual(row.provider_id, 'eOvv6TjnSjc');
  assert.strictEqual(row.photographer_url, 'https://unsplash.com/@unsplash-photographer');
  assert.strictEqual(row.download_location, 'https://api.unsplash.com/photos/eOvv6TjnSjc/download');
  assert(row.retrieved_at, 'retrieved_at should be set at capture time');
  assert.strictEqual(JSON.parse(row.raw_provider_record).id, 'eOvv6TjnSjc');
}

async function testRecordAssetUseSucceedsForUnsplash() {
  const pingedUrls = [];
  const env = {
    DB: new FakeD1(),
    UNSPLASH_ACCESS_KEY: 'unsplash-key',
    fetch: async (url, init) => {
      if (String(url).includes('/photos/eOvv6TjnSjc/download')) {
        pingedUrls.push([url, init]);
        return { ok: true, json: async () => ({ url: 'https://signed.example/photo.jpg' }) };
      }
      if (String(url).includes('/photos/eOvv6TjnSjc')) {
        return { ok: true, json: async () => unsplashPhoto('eOvv6TjnSjc') };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  const capture = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'unsplash',
    providerId: 'eOvv6TjnSjc'
  }), env);
  const { asset } = await capture.json();

  const response = await handleRequest(
    jsonRequest(`/assets/${asset.id}/record-use`, {}),
    env
  );
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.hasProvenance, true);
  assert.strictEqual(body.pingPerformed, true);
  assert.strictEqual(body.provider, 'unsplash');
  assert.strictEqual(body.providerId, 'eOvv6TjnSjc');
  assert.strictEqual(body.photographerUrl, 'https://unsplash.com/@unsplash-photographer');
  assert.strictEqual(body.rawProviderRecord.id, 'eOvv6TjnSjc');
  assert(body.pingedAt, 'response should include pingedAt');
  assert.strictEqual(pingedUrls.length, 1);
  assert.deepStrictEqual(pingedUrls[0][1].headers, { Authorization: 'Client-ID unsplash-key' });

  const row = env.DB.one('asset', asset.id);
  assert.strictEqual(row.download_location_pinged_at, body.pingedAt);
}

async function testRecordAssetUseHasNoProvenanceForPlainAsset() {
  const env = { DB: new FakeD1() };
  const created = await handleRequest(jsonRequest('/assets', {
    asset: {
      id: 'asset-plain',
      assetType: 'image',
      slug: 'plain-image',
      displayName: 'Plain Image',
      sourceUrl: 'https://example.com/plain.jpg'
    }
  }), env);
  assert.strictEqual(created.status, 201);

  const response = await handleRequest(jsonRequest('/assets/asset-plain/record-use', {}), env);
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.hasProvenance, false);
  assert.strictEqual(body.pingPerformed, false);
  assert.strictEqual(env.DB.one('asset', 'asset-plain').download_location_pinged_at, undefined);
}

async function testRecordAssetUseFailsLoudlyOnProviderError() {
  const env = {
    DB: new FakeD1(),
    UNSPLASH_ACCESS_KEY: 'unsplash-key',
    fetch: async url => {
      if (String(url).includes('/download')) return { ok: false, json: async () => ({}) };
      if (String(url).includes('/photos/eOvv6TjnSjc')) {
        return { ok: true, json: async () => unsplashPhoto('eOvv6TjnSjc') };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  const capture = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'unsplash',
    providerId: 'eOvv6TjnSjc'
  }), env);
  const { asset } = await capture.json();

  const response = await handleRequest(
    jsonRequest(`/assets/${asset.id}/record-use`, {}),
    env
  );

  assert.strictEqual(response.status, 502);
  assert.strictEqual(env.DB.one('asset', asset.id).download_location_pinged_at, undefined);
}

async function testRecordAssetUseRejectsUnknownAsset() {
  const env = { DB: new FakeD1() };
  const response = await handleRequest(jsonRequest('/assets/does-not-exist/record-use', {}), env);
  assert.strictEqual(response.status, 404);
}

async function testUnsplashProviderSearchFailureIsControlled() {
  const env = {
    DB: new FakeD1(),
    UNSPLASH_ACCESS_KEY: 'unsplash-key',
    fetch: async () => ({ ok: false, json: async () => ({}) })
  };

  const response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=wetland&providers=unsplash'), env);
  const body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(body.results, []);
}

async function testCaptureProviderImageRejectsDisabledProvider() {
  const env = { DB: new FakeD1() };

  const response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'unsplash',
    providerId: 'eOvv6TjnSjc'
  }), env);

  assert.strictEqual(response.status, 400);
}

async function testPixabayProviderRoutes() {
  const fetched = [];
  const env = {
    DB: new FakeD1(),
    PIXABAY_API_KEY: 'pixabay-key',
    fetch: async (url, init) => {
      fetched.push([url, init]);
      if (String(url).includes('per_page=12') && String(url).includes('q=wheat')) {
        return { ok: true, json: async () => ({ total: 1, totalHits: 1, hits: [pixabayPhoto(9001)] }) };
      }
      if (String(url).includes('id=9001')) {
        return { ok: true, json: async () => ({ hits: [pixabayPhoto(9001)] }) };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  let response = await handleRequest(new Request('https://ledger.test/image-providers'), env);
  let body = await response.json();
  assert.strictEqual(response.status, 200);
  assert(body.providers.some(p => p.id === 'pixabay'), 'pixabay should be enabled with PIXABAY_API_KEY set');

  response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=wheat&providers=pixabay'), env);
  body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.results.length, 1);
  assert.strictEqual(body.results[0].provider, 'pixabay');
  assert.strictEqual(body.results[0].providerId, '9001');
  assert.strictEqual(body.results[0].sourceUrl, 'https://pixabay.com/photos/wheat-field-9001/');
  assert.strictEqual(body.results[0].photographerUrl, 'https://pixabay.com/users/PixabayContributor-5555/');
  assert(String(fetched[0][0]).includes('key=pixabay-key'));

  response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'pixabay',
    providerId: '9001'
  }), env);
  body = await response.json();
  const row = env.DB.one('asset', body.asset.id);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.status, 'staged');
  assert.strictEqual(row.source_name, 'pixabay:9001');
  assert.strictEqual(row.license, 'Pixabay Content License');
  assert.strictEqual(row.license_url, 'https://pixabay.com/service/license/');
  assert.strictEqual(row.requires_attribution, 0);
  assert.strictEqual(row.allows_commercial_use, 1);
  assert.strictEqual(row.allows_modification, 1);
  assert.strictEqual(row.photographer_url, 'https://pixabay.com/users/PixabayContributor-5555/');
}

async function testOpenverseSearchFiltersOutNcAndNdLicenses() {
  const fetched = [];
  const env = {
    DB: new FakeD1(),
    fetch: async (url, init) => {
      fetched.push([url, init]);
      return {
        ok: true,
        json: async () => ({
          result_count: 3,
          page_count: 1,
          results: [
            openversePhoto('by-photo-1', 'by'),
            openversePhoto('nc-photo-1', 'by-nc'),
            openversePhoto('nd-photo-1', 'by-nd')
          ]
        })
      };
    }
  };

  const response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=wetland&providers=openverse'), env);
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  // by-nc and by-nd must never surface, even though the mock server
  // returned them — this is the client-side backstop, independent of
  // whatever the license_type request param actually did server-side.
  assert.deepStrictEqual(body.results.map(r => r.providerId), ['by-photo-1']);
  assert(String(fetched[0][0]).includes('license_type=commercial%2Cmodification'));
}

async function testOpenverseProviderRoutesAndUpstreamProvenance() {
  const env = {
    DB: new FakeD1(),
    fetch: async url => {
      if (String(url).includes('/images/?')) {
        return { ok: true, json: async () => ({ result_count: 1, page_count: 1, results: [openversePhoto('abc-123', 'by-sa')] }) };
      }
      if (String(url).includes('/images/abc-123/')) {
        return { ok: true, json: async () => openversePhoto('abc-123', 'by-sa') };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  let response = await handleRequest(new Request('https://ledger.test/image-providers'), env);
  let body = await response.json();
  assert.strictEqual(response.status, 200);
  assert(body.providers.some(p => p.id === 'openverse'), 'openverse should always be enabled (no key required)');

  response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=wetland&providers=openverse'), env);
  body = await response.json();
  assert.strictEqual(body.results[0].photographer, 'Jane Photographer');
  assert.strictEqual(body.results[0].photographerUrl, 'https://flickr.com/people/janephotographer');
  assert.strictEqual(body.results[0].license, 'CC BY-SA');
  assert.strictEqual(body.results[0].requiresAttribution, true);
  assert.strictEqual(body.results[0].allowsCommercialUse, true);

  response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'openverse',
    providerId: 'abc-123'
  }), env);
  body = await response.json();
  const row = env.DB.one('asset', body.asset.id);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.provider, 'openverse', 'provider column stays "openverse" — the API we queried');
  assert.strictEqual(row.original_source, 'flickr', 'upstream source recorded distinctly from the provider');
  assert.strictEqual(row.original_source_url, 'https://flickr.com/photos/janephotographer/123456');
  assert.strictEqual(row.source_url, 'https://flickr.com/photos/janephotographer/123456');
  assert.strictEqual(row.requires_attribution, 1);
  assert.strictEqual(row.allows_commercial_use, 1);
  assert.strictEqual(row.allows_modification, 1);
  assert.strictEqual(row.attribution, 'Photo by Jane Photographer, via Openverse (CC BY-SA).');
}

async function testWikimediaSearchAndCaptureExtractsExtmetadata() {
  const fetched = [];
  const env = {
    DB: new FakeD1(),
    fetch: async (url, init) => {
      fetched.push([url, init]);
      if (String(url).includes('generator=search')) {
        return {
          ok: true,
          json: async () => ({
            query: { pages: { 555: wikimediaPage(555, 'CC BY-SA 4.0') } }
          })
        };
      }
      if (String(url).includes('pageids=555')) {
        return { ok: true, json: async () => ({ query: { pages: { 555: wikimediaPage(555, 'CC BY-SA 4.0') } } }) };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  let response = await handleRequest(new Request('https://ledger.test/image-providers'), env);
  let body = await response.json();
  assert(body.providers.some(p => p.id === 'wikimedia'), 'wikimedia should always be enabled (no key required)');

  response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=lighthouse&providers=wikimedia'), env);
  body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.results.length, 1);
  assert.strictEqual(body.results[0].providerId, '555');
  // Artist field arrives as HTML ("<a href=...>Jane Doe</a>") — must be
  // stripped to plain text before it's used as a photographer name.
  assert.strictEqual(body.results[0].photographer, 'Jane Doe');
  assert.strictEqual(body.results[0].license, 'CC BY-SA 4.0');
  assert.strictEqual(body.results[0].requiresAttribution, true);
  assert.strictEqual(body.results[0].allowsCommercialUse, true);
  assert.strictEqual(body.results[0].allowsModification, true);
  // Mandatory per Wikimedia Foundation API Usage Guidelines — not optional.
  assert.deepStrictEqual(fetched[0][1].headers, { 'User-Agent': 'OAT-Image-Staging/1.0 (https://github.com/owencorpening/oat-tools)' });

  response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'wikimedia',
    providerId: '555'
  }), env);
  body = await response.json();
  const row = env.DB.one('asset', body.asset.id);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.photographer, 'Jane Doe');
  assert.strictEqual(row.license, 'CC BY-SA 4.0');
  assert.strictEqual(row.requires_attribution, 1);
}

async function testWikimediaUnknownLicenseNeedsProvenanceReview() {
  const env = {
    DB: new FakeD1(),
    fetch: async url => {
      if (String(url).includes('pageids=777')) {
        return { ok: true, json: async () => ({ query: { pages: { 777: wikimediaPage(777, '') } } }) };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  const response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'wikimedia',
    providerId: '777'
  }), env);
  const body = await response.json();
  const row = env.DB.one('asset', body.asset.id);

  assert.strictEqual(response.status, 201);
  // No confidently-classifiable license → route to needs-provenance rather
  // than guess a capability flag that might be wrong.
  assert.strictEqual(row.status, 'needs-provenance');
  assert.strictEqual(row.requires_attribution, undefined);
}

async function testSmithsonianProviderRoutesAreAlwaysCc0() {
  const fetched = [];
  const env = {
    DB: new FakeD1(),
    SMITHSONIAN_API_KEY: 'smithsonian-key',
    fetch: async (url, init) => {
      fetched.push([url, init]);
      if (String(url).includes('/search?')) {
        return { ok: true, json: async () => ({ response: { rowCount: 1, rows: [smithsonianRow('nmnh_12345')] } }) };
      }
      if (String(url).includes('/content/nmnh_12345')) {
        return { ok: true, json: async () => ({ response: smithsonianRow('nmnh_12345') }) };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  let response = await handleRequest(new Request('https://ledger.test/image-providers'), env);
  let body = await response.json();
  assert(body.providers.some(p => p.id === 'smithsonian'), 'smithsonian should be enabled with SMITHSONIAN_API_KEY set');

  response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=meteorite&providers=smithsonian'), env);
  body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.results.length, 1);
  assert.strictEqual(body.results[0].providerId, 'nmnh_12345');
  assert.strictEqual(body.results[0].sourceUrl, 'http://n2t.net/ark:/65665/nmnh_12345');
  assert(String(fetched[0][0]).includes('api_key=smithsonian-key'));

  response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'smithsonian',
    providerId: 'nmnh_12345'
  }), env);
  body = await response.json();
  const row = env.DB.one('asset', body.asset.id);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.license, 'CC0');
  assert.strictEqual(row.requires_attribution, 0);
  assert.strictEqual(row.allows_commercial_use, 1);
  assert.strictEqual(row.allows_modification, 1);
  assert.strictEqual(row.photographer, 'Jane Curator');
}

async function testLocConfidentPublicDomainGetsFlagsAssigned() {
  const env = {
    DB: new FakeD1(),
    fetch: async url => {
      if (String(url).includes('/search/')) {
        return { ok: true, json: async () => ({ pagination: { of: 1 }, results: [locRow('2018666890', 'No known restrictions on publication.')] }) };
      }
      if (String(url).includes('/item/2018666890/')) {
        return { ok: true, json: async () => ({ item: locRow('2018666890', 'No known restrictions on publication.') }) };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  let response = await handleRequest(new Request('https://ledger.test/image-providers'), env);
  let body = await response.json();
  assert(body.providers.some(p => p.id === 'loc'), 'loc should always be enabled (no key required)');

  response = await handleRequest(new Request('https://ledger.test/image-providers/search?q=lighthouse&providers=loc'), env);
  body = await response.json();
  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.results.length, 1);
  assert.strictEqual(body.results[0].providerId, '2018666890');
  assert.strictEqual(body.results[0].allowsCommercialUse, true);
  assert.strictEqual(body.results[0].sourceUrl, 'https://www.loc.gov/item/2018666890/');
  // Highest-resolution entry (last in the array) should be used as imageSrc.
  assert.strictEqual(body.results[0].imageSrc, 'https://tile.loc.gov/2018666890/full.jpg');

  response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'loc',
    providerId: '2018666890'
  }), env);
  body = await response.json();
  const row = env.DB.one('asset', body.asset.id);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.status, 'staged');
  assert.strictEqual(row.allows_commercial_use, 1);
}

async function testLocAmbiguousRightsRoutesToNeedsProvenance() {
  const env = {
    DB: new FakeD1(),
    fetch: async url => {
      if (String(url).includes('/search/')) {
        return { ok: true, json: async () => ({ pagination: { of: 1 }, results: [locRow('2018666891', 'Rights status not evaluated.')] }) };
      }
      if (String(url).includes('/item/2018666891/')) {
        return { ok: true, json: async () => ({ item: locRow('2018666891', 'Rights status not evaluated.') }) };
      }
      return { ok: false, json: async () => ({}) };
    }
  };

  const response = await handleRequest(jsonRequest('/captures/provider-image', {
    provider: 'loc',
    providerId: '2018666891'
  }), env);
  const body = await response.json();
  const row = env.DB.one('asset', body.asset.id);

  assert.strictEqual(response.status, 201);
  assert.strictEqual(row.status, 'needs-provenance', 'unclear rights text should never be treated as clear');
  assert.strictEqual(row.allows_commercial_use, undefined);
}

async function testCreateReviewImageNeedUpsertsDraft() {
  const env = { DB: new FakeD1() };
  const payload = {
    contentDraft: {
      id: 'draft-1',
      draftPath: 'part-09.md',
      title: 'Old Title',
      headingAnchor: 'old'
    },
    imageNeed: {
      id: 'need-1',
      contentDraftId: 'draft-1',
      reason: 'needs map',
      neededAssetKind: 'map'
    }
  };

  let response = await handleRequest(jsonRequest('/review-image-needs', payload), env);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(env.DB.one('content_draft', 'draft-1').title, 'Old Title');

  response = await handleRequest(jsonRequest('/review-image-needs', {
    contentDraft: { ...payload.contentDraft, title: 'New Title' },
    imageNeed: { ...payload.imageNeed, id: 'need-2' }
  }), env);
  assert.strictEqual(response.status, 201);
  assert.strictEqual(env.DB.one('content_draft', 'draft-1').title, 'New Title');
  assert.strictEqual(env.DB.one('image_need', 'need-2').reason, 'needs map');
}

async function testCreatePlacementWithSaga() {
  const env = { DB: new FakeD1() };
  env.DB.insert('asset', { id: 'asset-1', status: 'staged' });

  const response = await handleRequest(jsonRequest('/placements', {
    contentDraft: {
      id: 'draft-1',
      draftPath: 'part-09.md',
      title: 'Water Part IX'
    },
    placement: {
      id: 'placement-1',
      assetId: 'asset-1',
      contentDraftId: 'draft-1',
      target: 'substack',
      figureNumber: '3',
      snippetFormat: 'html-figure'
    },
    saga: {
      id: 'saga-1',
      imageNeedId: 'need-1'
    }
  }), env);
  const body = await response.json();

  assert.strictEqual(response.status, 201);
  assert.strictEqual(body.placement.asset_id, 'asset-1');
  assert.strictEqual(body.placement.content_draft_id, 'draft-1');
  assert.strictEqual(body.saga.asset_id, 'asset-1');
  assert.strictEqual(body.saga.asset_placement_id, 'placement-1');
  assert.strictEqual(env.DB.one('content_draft', 'draft-1').title, 'Water Part IX');
  assert.strictEqual(env.DB.one('asset_placement', 'placement-1').target, 'substack');
  assert.strictEqual(env.DB.one('asset_saga', 'saga-1').image_need_id, 'need-1');
}

async function testListRoutes() {
  const env = { DB: new FakeD1() };
  env.DB.insert('asset', { id: 'asset-1', status: 'staged', created_at: '2026-01-01T00:00:00.000Z' });
  env.DB.insert('asset', { id: 'asset-2', status: 'candidate', created_at: '2026-01-02T00:00:00.000Z' });
  env.DB.insert('asset_placement', { id: 'placement-1', asset_id: 'asset-1', content_draft_id: 'draft-1', target: 'substack', status: 'planned', created_at: '2026-01-01T00:00:00.000Z' });
  env.DB.insert('asset_saga', { id: 'saga-1', asset_id: 'asset-1', asset_placement_id: 'placement-1', status: 'running', current_step: 1, resolution: 'auto-retry' });
  env.DB.insert('image_need', { id: 'need-1', content_draft_id: 'draft-1', status: 'open', created_at: '2026-01-01T00:00:00.000Z' });
  env.DB.insert('image_need', { id: 'need-2', content_draft_id: 'draft-2', status: 'open', created_at: '2026-01-02T00:00:00.000Z' });

  env.DB.insert('content_draft', { id: 'draft-1', draft_path: 'water-series/part-09/post.md', title: 'Water Part IX' });

  const assets = await (await handleRequest(new Request('https://ledger.test/assets/staged'), env)).json();
  const allAssets = await (await handleRequest(new Request('https://ledger.test/assets'), env)).json();
  const needs = await (await handleRequest(new Request('https://ledger.test/image-needs/open?contentDraftId=draft-1'), env)).json();
  const placements = await (await handleRequest(new Request('https://ledger.test/placements/planned?contentDraftId=draft-1'), env)).json();

  assert.deepStrictEqual(assets.assets.map(row => row.id), ['asset-1']);
  assert.deepStrictEqual(allAssets.assets.map(row => row.id), ['asset-1', 'asset-2']);
  assert.strictEqual(allAssets.assets[0].placement_target, 'substack');
  assert.strictEqual(allAssets.assets[0].draft_title, 'Water Part IX');
  assert.strictEqual(allAssets.assets[1].placement_target, undefined);
  assert.deepStrictEqual(needs.imageNeeds.map(row => row.id), ['need-1']);
  assert.deepStrictEqual(placements.placements.map(row => row.placement_id), ['placement-1']);
  assert.strictEqual(placements.placements[0].saga_id, 'saga-1');
}

async function testPlacementLifecycleRoutes() {
  const env = { DB: new FakeD1() };
  env.DB.insert('asset', { id: 'asset-1', status: 'staged' });
  env.DB.insert('asset_placement', { id: 'placement-1', asset_id: 'asset-1', status: 'planned' });
  env.DB.insert('asset_saga', {
    id: 'saga-1',
    asset_id: 'asset-1',
    asset_placement_id: 'placement-1',
    status: 'running',
    current_step: 1,
    resolution: 'auto-retry',
    retry_count: 0
  });

  let response = await handleRequest(jsonRequest('/sagas/saga-1/step', {
    currentStep: 2,
    status: 'running',
    resolution: 'auto-retry',
    compensation: 'retry download'
  }), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset_saga', 'saga-1').current_step, 2);
  assert.strictEqual(env.DB.one('asset_saga', 'saga-1').compensation, 'retry download');

  response = await handleRequest(jsonRequest('/assets/asset-1/publishing', {}), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset', 'asset-1').status, 'publishing');

  response = await handleRequest(jsonRequest('/placements/placement-1/publishing', {}), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset_placement', 'placement-1').status, 'publishing');

  response = await handleRequest(jsonRequest('/assets/asset-1/publication', {
    assetPath: 'water-series/part-09/river-map',
    rawAssetUrl: 'https://raw.example.com/river-map.jpg'
  }), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset', 'asset-1').asset_path, 'water-series/part-09/river-map');

  response = await handleRequest(jsonRequest('/assets/asset-1/discarded', {}), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset', 'asset-1').status, 'discarded');

  response = await handleRequest(jsonRequest('/placements/placement-1/snippet', {
    snippet: '<figure></figure>',
    snippetFormat: 'html-figure'
  }), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset_placement', 'placement-1').snippet_format, 'html-figure');

  response = await handleRequest(jsonRequest('/placements/placement-1/placed', {
    assetId: 'asset-1',
    publishedUrl: 'https://raw.example.com/river-map.jpg'
  }), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset_placement', 'placement-1').status, 'placed');
  assert.strictEqual(env.DB.one('asset', 'asset-1').status, 'published');

  response = await handleRequest(jsonRequest('/sagas/saga-1/failed', {
    error: 'download failed',
    resolution: 'manual-review'
  }), env);
  assert.strictEqual(response.status, 200);
  assert.strictEqual(env.DB.one('asset_saga', 'saga-1').status, 'failed');
  assert.strictEqual(env.DB.one('asset_saga', 'saga-1').last_error, 'download failed');
  assert.strictEqual(env.DB.one('asset_saga', 'saga-1').retry_count, 1);
}

async function testAuthAndErrors() {
  let response = await handleRequest(jsonRequest('/assets', { asset: { id: 'asset-1' } }, 'wrong'), {
    DB: new FakeD1(),
    LEDGER_API_TOKEN: 'secret'
  });
  assert.strictEqual(response.status, 401);

  response = await handleRequest(new Request('https://ledger.test/assets', {
    method: 'POST',
    body: '{not json',
    headers: { 'Content-Type': 'application/json' }
  }), { DB: new FakeD1() });
  assert.strictEqual(response.status, 400);

  response = await handleRequest(new Request('https://ledger.test/nope'), { DB: new FakeD1() });
  assert.strictEqual(response.status, 404);
}

function unsplashPhoto(id) {
  return {
    id,
    width: 3456,
    height: 5184,
    alt_description: 'Misty wetland at dawn',
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `https://api.unsplash.com/photos/${id}/download`
    },
    user: {
      name: 'Unsplash Photographer',
      links: {
        html: 'https://unsplash.com/@unsplash-photographer'
      }
    },
    urls: {
      thumb: `https://images.unsplash.com/photos/${id}/thumb.jpeg`,
      small: `https://images.unsplash.com/photos/${id}/small.jpeg`,
      regular: `https://images.unsplash.com/photos/${id}/regular.jpeg`,
      full: `https://images.unsplash.com/photos/${id}/full.jpeg`,
      raw: `https://images.unsplash.com/photos/${id}/raw.jpeg`
    }
  };
}

function pixabayPhoto(id) {
  return {
    id,
    pageURL: `https://pixabay.com/photos/wheat-field-${id}/`,
    tags: 'wheat, field, agriculture',
    previewURL: `https://pixabay.com/get/preview-${id}.jpg`,
    webformatURL: `https://pixabay.com/get/webformat-${id}.jpg`,
    largeImageURL: `https://pixabay.com/get/large-${id}.jpg`,
    imageWidth: 4000,
    imageHeight: 3000,
    user: 'PixabayContributor',
    user_id: 5555
  };
}

function locRow(id, rightsText) {
  return {
    id: `https://www.loc.gov/item/${id}/`,
    title: 'Lighthouse, coastal view',
    contributor: ['Doe, Jane, photographer'],
    image_url: [
      `https://tile.loc.gov/${id}/thumb.jpg`,
      `https://tile.loc.gov/${id}/medium.jpg`,
      `https://tile.loc.gov/${id}/full.jpg`
    ],
    rights: rightsText,
    access_restricted: false
  };
}

function smithsonianRow(id) {
  return {
    id,
    title: 'Meteorite fragment',
    unitCode: 'NMNH',
    content: {
      descriptiveNonRepeating: {
        record_link: `http://n2t.net/ark:/65665/${id}`,
        guid: `http://n2t.net/ark:/65665/${id}`,
        unit_code: 'Smithsonian National Museum of Natural History',
        online_media: {
          mediaCount: 1,
          media: [{
            type: 'Images',
            content: `https://ids.si.edu/ids/deliveryService?id=${id}`,
            thumbnail: `https://ids.si.edu/ids/deliveryService?id=${id}&max=150`,
            usage: { access: 'CC0' }
          }]
        }
      },
      freetext: {
        name: [{ label: 'Photographer', content: 'Jane Curator' }]
      }
    }
  };
}

function wikimediaPage(pageid, licenseShortName) {
  return {
    pageid,
    ns: 6,
    title: 'File:Lighthouse at dusk.jpg',
    imageinfo: [{
      url: `https://upload.wikimedia.org/commons/lighthouse-${pageid}.jpg`,
      thumburl: `https://upload.wikimedia.org/commons/thumb/lighthouse-${pageid}-800px.jpg`,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:Lighthouse_at_dusk_${pageid}.jpg`,
      width: 4000,
      height: 3000,
      extmetadata: {
        LicenseShortName: { value: licenseShortName, source: 'commons-desc-page' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'commons-desc-page' },
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:JaneDoe">Jane Doe</a>', source: 'commons-desc-page' },
        Credit: { value: 'Own work', source: 'commons-desc-page' },
        AttributionRequired: { value: 'true', source: 'commons-desc-page' }
      }
    }]
  };
}

function openversePhoto(id, licenseCode) {
  const licenseNames = {
    by: 'CC BY',
    'by-sa': 'CC BY-SA',
    'by-nc': 'CC BY-NC',
    'by-nd': 'CC BY-ND'
  };
  return {
    id,
    title: 'Wetland at dusk',
    creator: 'Jane Photographer',
    creator_url: 'https://flickr.com/people/janephotographer',
    source: 'flickr',
    provider: 'flickr',
    foreign_landing_url: 'https://flickr.com/photos/janephotographer/123456',
    url: `https://live.staticflickr.com/${id}/full.jpg`,
    thumbnail: `https://live.staticflickr.com/${id}/thumb.jpg`,
    license: licenseCode,
    license_version: '2.0',
    license_url: `https://creativecommons.org/licenses/${licenseCode}/2.0/`,
    attribution: `Photo by Jane Photographer, via Openverse (${licenseNames[licenseCode] || licenseCode}).`,
    width: 4000,
    height: 3000
  };
}

function jsonRequest(path, body, token) {
  return new Request(`https://ledger.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

function pexelsPhoto(id) {
  return {
    id,
    width: 1200,
    height: 800,
    url: `https://www.pexels.com/photo/misty-wetland-${id}/`,
    photographer: 'Pexels Photographer',
    alt: 'Misty wetland at dawn',
    src: {
      small: `https://images.pexels.com/photos/${id}/small.jpeg`,
      medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
      large: `https://images.pexels.com/photos/${id}/large.jpeg`,
      large2x: `https://images.pexels.com/photos/${id}/large2x.jpeg`,
      original: `https://images.pexels.com/photos/${id}/original.jpeg`
    }
  };
}

class FakeD1 {
  constructor() {
    this.tables = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  insert(table, row) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    this.tables.get(table).push({ ...row });
  }

  upsert(table, row) {
    const existing = (this.tables.get(table) || []).find(candidate => candidate.id === row.id);
    if (existing) Object.assign(existing, row);
    else this.insert(table, row);
  }

  one(table, id) {
    const row = (this.tables.get(table) || []).find(candidate => candidate.id === id);
    assert(row, `expected ${table}.${id}`);
    return row;
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    if (/INSERT\s+INTO\s+content_draft[\s\S]+ON\s+CONFLICT/i.test(this.sql)) {
      this.db.upsert('content_draft', {
        id: this.values[0],
        content_item_id: this.values[1],
        content_repo_path: this.values[2],
        draft_path: this.values[3],
        title: this.values[4],
        heading_anchor: this.values[5],
        status: this.values[6]
      });
      return { success: true };
    }
    if (/^\s*INSERT\s+INTO/i.test(this.sql)) return this.runInsert();
    if (/^\s*UPDATE\s+/i.test(this.sql)) return this.runUpdate();
    throw new Error(`Unsupported run SQL: ${this.sql}`);
  }

  async all() {
    if (/FROM\s+image_need/i.test(this.sql)) {
      const rows = [...(this.db.tables.get('image_need') || [])]
        .filter(row => row.status === 'open')
        .filter(row => !/content_draft_id\s*=\s*\?/i.test(this.sql) || row.content_draft_id === this.values[0])
        .sort(byCreatedAt);
      return { results: rows };
    }
    if (/FROM\s+asset_placement\s+p/i.test(this.sql)) {
      const assets = this.db.tables.get('asset') || [];
      const sagas = this.db.tables.get('asset_saga') || [];
      const rows = [...(this.db.tables.get('asset_placement') || [])]
        .filter(row => row.status === 'planned')
        .filter(row => !/p\.content_draft_id\s*=\s*\?/i.test(this.sql) || row.content_draft_id === this.values[0])
        .sort(byCreatedAt)
        .map(row => {
          const asset = assets.find(candidate => candidate.id === row.asset_id) || {};
          const saga = sagas.find(candidate => candidate.asset_placement_id === row.id) || {};
          return {
            placement_id: row.id,
            placement_asset_id: row.asset_id,
            content_draft_id: row.content_draft_id,
            target: row.target,
            placement_status: row.status,
            asset_id: asset.id,
            display_name: asset.display_name,
            saga_id: saga.id,
            saga_status: saga.status
          };
      });
      return { results: rows };
    }
    if (/draft_title/i.test(this.sql)) {
      const placements = this.db.tables.get('asset_placement') || [];
      const drafts = this.db.tables.get('content_draft') || [];
      const rows = [...(this.db.tables.get('asset') || [])]
        .sort(byCreatedAt)
        .map(row => {
          const placement = [...placements]
            .filter(candidate => candidate.asset_id === row.id)
            .sort(byCreatedAt)
            .pop() || {};
          const draft = drafts.find(candidate => candidate.id === placement.content_draft_id) || {};
          return {
            ...row,
            placement_target: placement.target,
            placement_status: placement.status,
            placement_published_url: placement.published_url,
            placement_updated_at: placement.updated_at,
            draft_title: draft.title,
            draft_path: draft.draft_path
          };
        });
      return { results: rows };
    }
    if (/FROM\s+asset\s+WHERE\s+id\s*=\s*\?/i.test(this.sql)) {
      const row = (this.db.tables.get('asset') || []).find(candidate => candidate.id === this.values[0]);
      return { results: row ? [row] : [] };
    }
    if (/FROM\s+asset\b/i.test(this.sql)) {
      const rows = [...(this.db.tables.get('asset') || [])]
        .filter(row => row.status === 'staged')
        .sort(byCreatedAt);
      return { results: rows };
    }
    throw new Error(`Unsupported all SQL: ${this.sql}`);
  }

  runInsert() {
    const match = this.sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
    assert(match, `unparsed insert: ${this.sql}`);
    const columns = match[2].split(',').map(column => column.trim());
    const row = {};
    columns.forEach((column, index) => {
      row[column] = this.values[index];
    });
    this.db.insert(match[1], row);
    return { success: true };
  }

  runUpdate() {
    if (/UPDATE\s+asset_saga[\s\S]+retry_count\s*=\s*retry_count\s*\+\s*1/i.test(this.sql)) {
      const sagaId = this.values[4];
      const row = this.db.one('asset_saga', sagaId);
      Object.assign(row, {
        status: 'failed',
        resolution: this.values[0],
        last_error: this.values[1],
        retry_count: (row.retry_count || 0) + 1,
        next_retry_at: this.values[2],
        updated_at: this.values[3]
      });
      return { success: true };
    }

    const match = this.sql.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\?/i);
    assert(match, `unparsed update: ${this.sql}`);
    const table = match[1];
    const assignments = match[2]
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    const id = this.values[assignments.length];
    const row = this.db.one(table, id);

    assignments.forEach((assignment, index) => {
      const column = assignment.split('=')[0].trim();
      const literal = assignment.match(/=\s*'([^']*)'/);
      row[column] = literal ? literal[1] : this.values[index];
    });

    return { success: true };
  }
}

function byCreatedAt(a, b) {
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

(async () => {
  await testCreateAsset();
  await testCaptureImage();
  await testCaptureImageResolvesBareUnsplashId();
  await testPexelsProviderRoutes();
  await testPexelsProviderSearchFailureIsControlled();
  await testUnsplashProviderRoutes();
  await testUnsplashProviderSearchFailureIsControlled();
  await testCaptureProviderImageRejectsDisabledProvider();
  await testPixabayProviderRoutes();
  await testOpenverseSearchFiltersOutNcAndNdLicenses();
  await testOpenverseProviderRoutesAndUpstreamProvenance();
  await testWikimediaSearchAndCaptureExtractsExtmetadata();
  await testWikimediaUnknownLicenseNeedsProvenanceReview();
  await testSmithsonianProviderRoutesAreAlwaysCc0();
  await testLocConfidentPublicDomainGetsFlagsAssigned();
  await testLocAmbiguousRightsRoutesToNeedsProvenance();
  await testRecordAssetUseSucceedsForUnsplash();
  await testRecordAssetUseHasNoProvenanceForPlainAsset();
  await testRecordAssetUseFailsLoudlyOnProviderError();
  await testRecordAssetUseRejectsUnknownAsset();
  await testCreateReviewImageNeedUpsertsDraft();
  await testCreatePlacementWithSaga();
  await testListRoutes();
  await testPlacementLifecycleRoutes();
  await testAuthAndErrors();
  console.log('ledgerApiWorker tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
