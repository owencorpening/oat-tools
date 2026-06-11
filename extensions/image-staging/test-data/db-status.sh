#!/bin/bash
# db-status.sh — Show the current state of the test D1 database

set -e

DB_PATH="/tmp/oat-test-ledger/local-ledger.sqlite"

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found at $DB_PATH"
  echo "Run setup-test.sh first to create the database."
  exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "D1 Database Status: $DB_PATH"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "STAGED ASSETS:"
echo "───────────────────────────────────────────────────────────────"
sqlite3 "$DB_PATH" << 'EOF'
.headers on
.mode column
.width 20 40 20 20
SELECT
  id,
  slug,
  display_name,
  status
FROM asset
WHERE status = 'staged'
ORDER BY created_at DESC;
EOF

echo ""
echo "ALL ASSETS (by status):"
echo "───────────────────────────────────────────────────────────────"
sqlite3 "$DB_PATH" << 'EOF'
.headers on
.mode column
SELECT
  status,
  COUNT(*) as count
FROM asset
GROUP BY status;
EOF

echo ""
echo "TOTAL ASSET COUNT:"
echo "───────────────────────────────────────────────────────────────"
sqlite3 "$DB_PATH" << 'EOF'
SELECT COUNT(*) as total_assets FROM asset;
EOF

echo ""
