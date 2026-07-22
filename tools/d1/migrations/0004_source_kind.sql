-- source_kind was captured at intake (downloads / ai-generated / user-provided)
-- but never persisted, so placeAsset always fell through to the download-by-URL
-- path even for local files — it never recognized a local upload as local, and
-- so never cleaned up the Downloads original after placing it.
ALTER TABLE asset ADD COLUMN source_kind TEXT;
