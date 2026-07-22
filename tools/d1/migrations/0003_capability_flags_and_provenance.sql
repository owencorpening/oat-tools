-- Capability flags let each provider module state what its license actually
-- permits, instead of every caller re-deriving it from a license string.
-- Nullable (not just true/false) because some sources — Library of Congress
-- in particular — don't reliably state rights per item; null means "unknown,
-- needs human review," which is a different fact than "known false."
ALTER TABLE asset ADD COLUMN requires_attribution INTEGER;
ALTER TABLE asset ADD COLUMN allows_commercial_use INTEGER;
ALTER TABLE asset ADD COLUMN allows_modification INTEGER;

-- Aggregators (Openverse) index content hosted elsewhere. `provider` stays
-- the API we actually queried ("openverse"); these two columns carry the
-- true upstream chain (e.g. source "flickr", original_source_url the
-- photo's page on flickr.com) distinct from Openverse's own attribution.
ALTER TABLE asset ADD COLUMN original_source TEXT;
ALTER TABLE asset ADD COLUMN original_source_url TEXT;

ALTER TABLE asset ADD COLUMN license_url TEXT;
