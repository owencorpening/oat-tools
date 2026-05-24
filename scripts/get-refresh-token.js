#!/usr/bin/env node
// One-time script to get a Google OAuth refresh token.
// Run: node scripts/get-refresh-token.js
// Paste your client_id and client_secret from GCP Console when prompted.

const http     = require('http');
const https    = require('https');
const readline = require('readline');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

const REDIRECT_URI = 'http://localhost:3000';

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function waitForCode(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const err  = url.searchParams.get('error');
      res.end(code ? '<h2>Got it — you can close this tab.</h2>' : `<h2>Error: ${err}</h2>`);
      server.close();
      if (code) resolve(code); else reject(new Error(err));
    });
    server.listen(port, () => console.log(`\nListening on http://localhost:${port} ...`));
  });
}

function exchangeCode(clientId, clientSecret, code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('\nOAT Tools — Google OAuth Refresh Token Generator');
  console.log('─'.repeat(50));
  console.log('Go to: https://console.cloud.google.com/apis/credentials');
  console.log('Project: OAT Promote All Tables');
  console.log('Create an OAuth 2.0 Client ID → Desktop App → download JSON\n');

  const clientId     = await prompt('Paste client_id:     ');
  const clientSecret = await prompt('Paste client_secret: ');

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);

  const code   = await waitForCode(3000);
  const tokens = await exchangeCode(clientId, clientSecret, code);

  if (!tokens.refresh_token) {
    console.error('\nNo refresh_token in response:', tokens);
    process.exit(1);
  }

  console.log('\n✓ Success! Run these three commands:\n');
  console.log(`wrangler secret put GOOGLE_CLIENT_ID`);
  console.log(`  → paste: ${clientId}\n`);
  console.log(`wrangler secret put GOOGLE_CLIENT_SECRET`);
  console.log(`  → paste: ${clientSecret}\n`);
  console.log(`wrangler secret put GOOGLE_REFRESH_TOKEN`);
  console.log(`  → paste: ${tokens.refresh_token}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
