# Integration Tests for OAT Image Staging

Integration tests verify end-to-end workflows by simulating real VSCode environments and user interactions. They complement unit tests by catching issues that only surface when components work together.

## Overview

**imagePanelProviderIntegration.test.js** — Tests the complete image placement workflow:
1. Open markdown file in valid location (substack-ideas or carousel.md)
2. Stage an image
3. Click "Place Figure"
4. Verify placement metadata is saved to ledger
5. Verify snippet is written to editor
6. Clean up external state (Downloads folder)

## Pattern for OAT Extensions

This integration test serves as a template for other extensions in the monorepo. Follow this structure:

### File Organization

```
extensions/<extension>/test/
├── <unit-tests>.test.js          # Unit tests for individual functions
├── <integration>.test.js          # Integration test (this pattern)
├── fixtures/                      # Test data
│   └── test-repo/                # Minimal repo structure
│       ├── substack-ideas/        # For placement tests
│       │   └── test-series/
│       │       └── test-draft.md
│       └── images/                # Output directory for placed images
├── INTEGRATION_TESTS.md           # This file
└── README.md                      # General test documentation
```

### Integration Test Structure

```javascript
/**
 * <feature>Integration.test.js
 *
 * Tests the happy path for <feature>.
 * Demonstrates the pattern for integration testing across OAT extensions.
 */

// 1. Setup: paths, fixtures, test data
const fixturesDir = path.join(__dirname, 'fixtures', 'test-repo');
const testFilePath = path.join(fixturesDir, '...');

// 2. Create or mock external dependencies
function createTestData() { /* ... */ }
function createMockProvider() { /* ... */ }

// 3. Write test function that:
//    - Sets up fixture data
//    - Calls the feature being tested
//    - Verifies results
//    - Cleans up external state
async function testHappyPath() {
  // Setup
  createTestData();
  try {
    // Execute
    const result = await feature();
    // Assert
    assert(result.ok);
  } finally {
    // Cleanup (remove files from Downloads, temp dirs, etc)
    cleanupExternalState();
  }
}

async function run() {
  await testHappyPath();
  console.log('integration tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
```

## Key Principles

1. **Non-Destructive** — Always clean up. Test data in `/tmp` or Downloads is temporary.
2. **Self-Contained** — Fixtures should be committed to the repo. Tests don't depend on external services.
3. **Fast** — Integration tests simulate interactions; they don't actually launch VSCode.
4. **Maintainable** — Mock VSCode, file system, and external APIs so tests stay stable.
5. **Clear Assertions** — Each test verifies specific outcomes from the happy path.

## Running Integration Tests

```bash
# Run all image-staging tests (including integration)
npm run test:image-staging

# Run just the integration test
node extensions/image-staging/test/imagePanelProviderIntegration.test.js
```

## Extending to Other Extensions

When adding a similar test for another extension:

1. Create `extensions/<extension>/test/fixtures/test-repo/` with minimal structure
2. Create `extensions/<extension>/test/<feature>Integration.test.js`
3. Add to `package.json` test script
4. Create `extensions/<extension>/test/INTEGRATION_TESTS.md` (copy this file, adapt for your feature)

## Troubleshooting

- **Module not found errors**: Check that fixtures path is correct relative to test file
- **Image file not created**: Ensure `fs.writeFileSync()` gets full absolute path
- **VSCode mock missing properties**: Add to fakeVscode object in test file
- **Cleanup not running**: Make sure cleanup is in `finally` block, not after `run()`
