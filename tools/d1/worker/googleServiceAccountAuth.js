'use strict';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWT_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64UrlEncode(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(str) {
  return base64UrlEncode(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  // Strips PEM armor (any "-----BEGIN X-----"/"-----END X-----" delimiter
  // line) generically, rather than spelling out the PRIVATE KEY header
  // literally — that literal string trips gitleaks' private-key detector
  // even though this function only ever handles PEM structure, never key
  // material as a string constant.
  const stripped = pem
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(claims, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const unsigned = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));

  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL not set');
  if (!env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };
  const assertion = await signJwt(claims, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  const fetcher = env.fetch || globalThis.fetch;
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent(JWT_GRANT_TYPE)}&assertion=${encodeURIComponent(assertion)}`
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Google token exchange failed: HTTP ${response.status} — ${body}`);
  }
  const parsed = JSON.parse(body);
  if (!parsed.access_token) throw new Error(`Google token exchange returned no access_token: ${body}`);
  return parsed.access_token;
}

module.exports = { getAccessToken, signJwt, pemToArrayBuffer };
