#!/bin/bash
# teardown-test.sh — Clean up ad-hoc test environment and stop ledger server

set -e

DOWNLOADS_DIR="$HOME/Downloads"
TEST_REPO_COPY="$HOME/test-repo-oat"
LEDGER_PID_FILE="/tmp/oat-test-ledger.pid"
TEST_DB_DIR="/tmp/oat-test-ledger"

echo "Cleaning up test environment..."
echo ""

# 1. Stop ledger server
echo "1. Stopping D1 ledger server..."
if [ -f "$LEDGER_PID_FILE" ]; then
  LEDGER_PID=$(cat "$LEDGER_PID_FILE")
  if kill -0 "$LEDGER_PID" 2>/dev/null; then
    kill "$LEDGER_PID"
    wait "$LEDGER_PID" 2>/dev/null || true
    echo "   ✓ Ledger server stopped (PID: $LEDGER_PID)"
  fi
  rm -f "$LEDGER_PID_FILE"
else
  echo "   (No ledger server running)"
fi

# 2. Remove test images
echo "2. Removing test images from $DOWNLOADS_DIR"
rm -f "$DOWNLOADS_DIR/water-droplet-unsplash.png"
rm -f "$DOWNLOADS_DIR/ocean-wave-pexels.png"
rm -f "$DOWNLOADS_DIR/solar-panel-getty.png"
rm -f "$DOWNLOADS_DIR/wind-turbine-shutterstock.png"
rm -f "$DOWNLOADS_DIR/forest-landscape.png"
rm -f "$DOWNLOADS_DIR/ChatGPT Image Jun 10 2026, 03_22_45 PM.png"
echo "   ✓ Removed 6 test images"

# 3. Remove test repo
echo "3. Removing test repo from $TEST_REPO_COPY"
if [ -d "$TEST_REPO_COPY" ]; then
  rm -rf "$TEST_REPO_COPY"
  echo "   ✓ Removed test repo"
else
  echo "   (No test repo found)"
fi

# 4. Remove test database
echo "4. Removing test database from $TEST_DB_DIR"
if [ -d "$TEST_DB_DIR" ]; then
  rm -rf "$TEST_DB_DIR"
  echo "   ✓ Removed test database"
else
  echo "   (No test database found)"
fi

echo ""
echo "✓ Cleanup complete!"
echo ""
