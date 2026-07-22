-- Provider-specific asset metadata, needed to satisfy Unsplash API Guidelines
-- (photographer profile link, download_location ping receipt) without
-- forcing every provider through the same shape.

ALTER TABLE asset ADD COLUMN provider TEXT;
ALTER TABLE asset ADD COLUMN provider_id TEXT;
ALTER TABLE asset ADD COLUMN photographer_url TEXT;
ALTER TABLE asset ADD COLUMN download_location TEXT;
ALTER TABLE asset ADD COLUMN retrieved_at TEXT;
ALTER TABLE asset ADD COLUMN raw_provider_record TEXT;
ALTER TABLE asset ADD COLUMN download_location_pinged_at TEXT;
