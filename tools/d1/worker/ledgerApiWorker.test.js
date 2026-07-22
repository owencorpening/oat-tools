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
  assert.deepStrictEqual(body.providers, []);

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
  assert.deepStrictEqual(body.providers, [{ id: 'pexels', label: 'Pexels' }]);

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
  assert.deepStrictEqual(body.providers, [{ id: 'unsplash', label: 'Unsplash' }]);

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
  assert.strictEqual(row.provider, 'unsplash');
  assert.strictEqual(row.provider_id, 'eOvv6TjnSjc');
  assert.strictEqual(row.photographer_url, 'https://unsplash.com/@unsplash-photographer');
  assert.strictEqual(row.download_location, 'https://api.unsplash.com/photos/eOvv6TjnSjc/download');
  assert(row.retrieved_at, 'retrieved_at should be set at capture time');
  assert.strictEqual(JSON.parse(row.raw_provider_record).id, 'eOvv6TjnSjc');
}

async function testDownloadLocationPingSucceedsForUnsplash() {
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
    jsonRequest(`/assets/${asset.id}/download-location-ping`, {}),
    env
  );
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.strictEqual(body.skipped, false);
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

async function testDownloadLocationPingSkipsNonUnsplashAssets() {
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

  const response = await handleRequest(jsonRequest('/assets/asset-plain/download-location-ping', {}), env);
  const body = await response.json();

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(body, { assetId: 'asset-plain', skipped: true });
  assert.strictEqual(env.DB.one('asset', 'asset-plain').download_location_pinged_at, undefined);
}

async function testDownloadLocationPingFailsLoudlyOnProviderError() {
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
    jsonRequest(`/assets/${asset.id}/download-location-ping`, {}),
    env
  );

  assert.strictEqual(response.status, 502);
  assert.strictEqual(env.DB.one('asset', asset.id).download_location_pinged_at, undefined);
}

async function testDownloadLocationPingRejectsUnknownAsset() {
  const env = { DB: new FakeD1() };
  const response = await handleRequest(jsonRequest('/assets/does-not-exist/download-location-ping', {}), env);
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
  await testDownloadLocationPingSucceedsForUnsplash();
  await testDownloadLocationPingSkipsNonUnsplashAssets();
  await testDownloadLocationPingFailsLoudlyOnProviderError();
  await testDownloadLocationPingRejectsUnknownAsset();
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
