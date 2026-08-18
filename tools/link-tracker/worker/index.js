'use strict';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ig') return renderLandingPage(env);

    if (path === '/admin/create' && request.method === 'POST') {
      return handleCreate(request, env);
    }

    if (path === '/admin/export' && request.method === 'GET') {
      return handleExport(request, env);
    }

    // Anything else is treated as a slug redirect: /xyz123
    const slug = path.replace(/^\//, '');
    if (!slug) return json({ error: 'No slug given' }, 400);

    return handleRedirect(slug, request, env);
  },
};

// ── Redirect + click logging ──────────────────────────────────────────────

async function handleRedirect(slug, request, env) {
  const link = await env.DB.prepare(
    'SELECT destination_url FROM links WHERE slug = ?'
  ).bind(slug).first();

  if (!link) return json({ error: 'Unknown slug' }, 404);

  const url = new URL(request.url);
  await env.DB.prepare(
    `INSERT INTO clicks (slug, timestamp, referrer, utm_source, utm_medium, utm_campaign)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    slug,
    new Date().toISOString(),
    request.headers.get('referer') || null,
    url.searchParams.get('utm_source') || null,
    url.searchParams.get('utm_medium') || null,
    url.searchParams.get('utm_campaign') || null
  ).run();

  return Response.redirect(link.destination_url, 302);
}

// ── Admin: create a link ────────────────────────────────────────────────────

async function handleCreate(request, env) {
  if (!isAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { slug, destination_url, campaign_label } = body;
  if (!slug || !destination_url || !campaign_label) {
    return json({ error: 'slug, destination_url, and campaign_label are all required' }, 400);
  }
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return json({ error: 'slug must be alphanumeric + hyphens only' }, 400);
  }

  const existing = await env.DB.prepare('SELECT slug FROM links WHERE slug = ?').bind(slug).first();
  if (existing) return json({ error: `Slug "${slug}" already exists` }, 409);

  await env.DB.prepare(
    'INSERT INTO links (slug, destination_url, campaign_label, created_at) VALUES (?, ?, ?, ?)'
  ).bind(slug, destination_url, campaign_label, new Date().toISOString()).run();

  return json({
    slug,
    tracked_url: `${new URL(request.url).origin}/${slug}`,
    destination_url,
    campaign_label,
  });
}

// ── Admin: export click log (for future stats-scraper integration) ─────────

async function handleExport(request, env) {
  if (!isAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { results } = await env.DB.prepare(
    `SELECT c.slug, l.campaign_label, l.destination_url, c.timestamp, c.referrer,
            c.utm_source, c.utm_medium, c.utm_campaign
     FROM clicks c JOIN links l ON c.slug = l.slug
     ORDER BY c.timestamp DESC`
  ).all();

  return json({ clicks: results });
}

// ── Instagram bio landing page ──────────────────────────────────────────────

async function renderLandingPage(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, campaign_label FROM links WHERE campaign_label LIKE 'ig-%' ORDER BY created_at DESC LIMIT 3`
  ).all();

  if (results.length === 0) {
    return new Response('<!DOCTYPE html><html><body><p>No active campaigns.</p></body></html>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const items = results.map(
    r => `<a class="link" href="/${r.slug}">${escapeHtml(r.campaign_label)}</a>`
  ).join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:Arial,sans-serif;background:#0a1e26;color:#fff;display:flex;flex-direction:column;
    align-items:center;padding:40px 20px;gap:16px;}
  .link{display:block;width:100%;max-width:400px;padding:16px;background:#005f73;color:#fff;
    text-decoration:none;text-align:center;border-radius:8px;font-weight:bold;}
  .link:hover{background:#0a7d94;}
</style></head>
<body>
${items}
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
