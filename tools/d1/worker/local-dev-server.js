'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { handleRequest } = require('./index');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;

function main() {
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const dbPath = process.env.LEDGER_SQLITE_PATH || path.join(__dirname, '.wrangler/state/local-ledger.sqlite');
  const db = createD1Database(dbPath);
  const env = {
    DB: db,
    LEDGER_API_TOKEN: process.env.LEDGER_API_TOKEN || '',
    UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || '',
    PEXELS_ACCESS_KEY: process.env.PEXELS_ACCESS_KEY || '',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '',
    SHEET_ID: process.env.SHEET_ID || ''
  };

  const server = http.createServer((req, res) => {
    handleNodeRequest(req, res, env).catch(error => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    });
  });

  server.listen(port, host, () => {
    console.log(`OAT ledger Worker dev server listening at http://${host}:${port}`);
    console.log(`SQLite ledger: ${dbPath}`);
  });
}

function createD1Database(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(fs.readFileSync(path.join(__dirname, '../migrations/0001_image_pipeline.sql'), 'utf8'));
  return new SqliteD1Database(sqlite);
}

async function handleNodeRequest(req, res, env) {
  const request = await toFetchRequest(req);
  const response = await handleRequest(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function toFetchRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const body = chunks.length === 0 ? undefined : Buffer.concat(chunks);
      resolve(new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
      }));
    });
  });
}

class SqliteD1Database {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.sqlite.prepare(sql));
  }
}

class SqliteD1Statement {
  constructor(statement) {
    this.statement = statement;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    this.statement.run(...this.values);
    return { success: true };
  }

  async all() {
    return { results: this.statement.all(...this.values) };
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createD1Database,
  SqliteD1Database,
  SqliteD1Statement,
  handleNodeRequest
};
