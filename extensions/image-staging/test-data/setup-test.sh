#!/bin/bash
# setup-test.sh — Set up ad-hoc test environment with local D1 ledger
#
# Creates a fresh local D1 database, copies test files, and launches VSCode.
# Everything is self-contained and cleaned up by teardown-test.sh.

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
TEST_DATA_DIR="$SCRIPT_DIR"
TEST_IMAGES_DIR="$TEST_DATA_DIR/downloads"
TEST_REPO_DIR="$TEST_DATA_DIR/repo"

DOWNLOADS_DIR="$HOME/Downloads"
TEST_REPO_COPY="$HOME/test-repo-oat"
LEDGER_PID_FILE="/tmp/oat-test-ledger.pid"
LEDGER_PORT=8787
TEST_DB_DIR="/tmp/oat-test-ledger"
TEST_DB_PATH="$TEST_DB_DIR/local-ledger.sqlite"

echo "Setting up ad-hoc test environment..."
echo ""

# 1. Cleanup old test data
echo "1. Cleaning up old test data..."
rm -f "$DOWNLOADS_DIR/water-droplet-unsplash.png"
rm -f "$DOWNLOADS_DIR/ocean-wave-pexels.png"
rm -f "$DOWNLOADS_DIR/solar-panel-getty.png"
rm -f "$DOWNLOADS_DIR/wind-turbine-shutterstock.png"
rm -f "$DOWNLOADS_DIR/forest-landscape.png"
rm -f "$DOWNLOADS_DIR/ChatGPT Image Jun 10 2026, 03_22_45 PM.png"
if [ -d "$TEST_REPO_COPY" ]; then
  rm -rf "$TEST_REPO_COPY"
fi
# Kill any existing ledger process (by PID or port)
if [ -f "$LEDGER_PID_FILE" ]; then
  kill $(cat "$LEDGER_PID_FILE") 2>/dev/null || true
  rm -f "$LEDGER_PID_FILE"
fi
# Also kill any process on the ledger port
lsof -i :$LEDGER_PORT 2>/dev/null | grep -v COMMAND | awk '{print $2}' | xargs -r kill 2>/dev/null || true

# Clear the test database directory so we start fresh
rm -rf "$TEST_DB_DIR"
mkdir -p "$TEST_DB_DIR"

echo "   ✓ Old test data removed"

# 2. Copy fresh test images
echo "2. Copying fresh test images to $DOWNLOADS_DIR"
cp "$TEST_IMAGES_DIR"/*.png "$DOWNLOADS_DIR/"
echo "   ✓ Copied 6 test images"

# 3. Copy fresh test repo
echo "3. Copying fresh test repo to $TEST_REPO_COPY"
cp -r "$TEST_REPO_DIR" "$TEST_REPO_COPY"
echo "   ✓ Copied repo structure"

# 4. Start local D1 ledger server with test database
echo "4. Starting local D1 ledger server..."
cd "$REPO_ROOT"
LEDGER_SQLITE_PATH="$TEST_DB_PATH" PEXELS_ACCESS_KEY="${PEXELS_ACCESS_KEY}" npm run ledger:dev:node > /tmp/oat-test-ledger.log 2>&1 &
LEDGER_PID=$!
echo $LEDGER_PID > "$LEDGER_PID_FILE"

# Wait for ledger to be ready
sleep 2
for i in {1..10}; do
  if curl -s "http://localhost:$LEDGER_PORT/health" > /dev/null 2>&1; then
    echo "   ✓ Ledger server started on http://localhost:$LEDGER_PORT"
    break
  fi
  if [ $i -eq 10 ]; then
    echo "   ✗ Ledger server failed to start. Check logs:"
    echo "     cat /tmp/oat-test-ledger.log"
    kill $LEDGER_PID 2>/dev/null || true
    rm -f "$LEDGER_PID_FILE"
    exit 1
  fi
  sleep 1
done

# 5. Launch VSCode with environment variable pointing to local ledger
echo "5. Preparing to open VSCode..."
echo "   ✓ Ledger configured via environment variable"

echo ""
echo "✓ Setup complete! Opening VSCode..."
echo ""

# Launch VSCode with environment variable for ledger
# Must pass as part of the command, not just export
OAT_IMAGES_LEDGER_API_URL="http://localhost:$LEDGER_PORT" code "$TEST_REPO_COPY" &

echo ""
echo "Ledger server running (PID: $LEDGER_PID)"
echo ""
echo "When done testing, run:"
echo "  extensions/image-staging/test-data/teardown-test.sh"
echo ""
