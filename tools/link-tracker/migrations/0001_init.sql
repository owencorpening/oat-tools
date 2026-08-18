CREATE TABLE links (
  slug TEXT PRIMARY KEY,
  destination_url TEXT NOT NULL,
  campaign_label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT
);

CREATE INDEX idx_clicks_slug ON clicks(slug);
