# Implementation Plan

- [x] 1. Set up the `sync-b2bapi` package scaffold
  - Create `packages/sync-b2bapi/` with `package.json`, `tsconfig.json`, and `src/modules/sync_b2bapi/` directory structure mirroring `sync-akeneo`
  - Add `fast-check` and `pg` as dependencies
  - Register the package in the monorepo `turbo.json` and root `package.json` workspaces
  - _Requirements: 8.1, 8.2_

- [x] 2. Implement credentials validation and types
- [x] 2.1 Define `B2BApiCredentials` interface and `validateCredentials` function
  - Create `src/modules/sync_b2bapi/lib/credentials.ts` with the credentials interface and a validator that throws on missing required fields
  - Required fields: `dbHost`, `dbPort`, `dbName`, `dbUser`, `dbPassword`, `frontendId`, `pricingApiUrl`, `pricingApiKey`, `gci`
  - _Requirements: 8.3_

- [ ]* 2.2 Write property test for credentials validation
  - **Property 12: Credentials validation**
  - **Validates: Requirements 8.3**

- [x] 3. Implement cursor encoding/decoding
- [x] 3.1 Create `cursor.ts` with `encodeCursor` and `decodeCursor`
  - Encode `B2BApiCursor` (`afterUpdatedAt`, `afterId`, `maxUpdatedAt`) as JSON string
  - Decode validates the JSON shape and throws on invalid input
  - _Requirements: 7.1, 7.2_

- [ ]* 3.2 Write property test for cursor round-trip
  - **Property 4: Cursor round-trip**
  - **Validates: Requirements 7.1, 7.2**

- [x] 4. Implement `B2BApiDbClient`
- [x] 4.1 Create `db-client.ts` with PostgreSQL connection management using `pg`
  - Implement `queryProducts` with keyset pagination SQL (`WHERE (updated_at, id) > ($2, $3) ORDER BY updated_at ASC, id ASC LIMIT $4`)
  - Exclude price columns from SELECT
  - Implement `queryCategories`, `queryBrands`, `countProducts`, `close`
  - Clamp `batchSize` to max 1000
  - _Requirements: 3.1, 3.3, 3.4_

- [ ]* 4.2 Write property test for keyset pagination query shape
  - **Property 7: Keyset pagination query shape**
  - **Validates: Requirements 3.1**

- [ ]* 4.3 Write property test for batchSize clamping
  - **Property 8: BatchSize clamping**
  - **Validates: Requirements 3.3**

- [x] 5. Implement product field mapping
- [x] 5.1 Create `lib/mapper.ts` with `mapProductToImportItem` function
  - Map all non-price fields from `WebsiteProductRow` to `ImportItem` data payload per the field mapping table in the design
  - Explicitly exclude `net_price`, `gross_price`, `default_price_net`, `default_price_gross`
  - _Requirements: 1.2, 3.4_

- [ ]* 5.2 Write property test for product mapping completeness and price exclusion
  - **Property 1: Product mapping completeness and price exclusion**
  - **Validates: Requirements 1.2, 3.4**

- [x] 6. Implement `B2BApiCatalogImporter`
- [x] 6.1 Create `lib/catalog-importer.ts` with `upsertCategory`, `upsertBrand`, `upsertProduct`, and `reconcileProducts`
  - `upsertProduct` calls `upsertCategory` and `upsertBrand` first if the referenced entities don't exist
  - `reconcileProducts` marks products with `externalId` not in `seenExternalIds` as inactive
  - Match products by `symbol` as `externalId`
  - _Requirements: 1.3, 1.4, 1.5, 4.1, 4.2, 4.3, 4.4_

- [ ]* 6.2 Write property test for category hierarchy preservation
  - **Property 9: Category hierarchy preservation**
  - **Validates: Requirements 4.4**

- [ ]* 6.3 Write property test for sync idempotence
  - **Property 2: Sync idempotence (upsert)**
  - **Validates: Requirements 1.3**

- [ ]* 6.4 Write property test for reconciliation
  - **Property 3: Reconciliation removes absent products**
  - **Validates: Requirements 1.5**

- [x] 7. Implement `B2BApiDataSyncAdapter` stream logic
- [x] 7.1 Create `lib/adapter.ts` implementing `DataSyncAdapter`
  - `streamImport` for entity type `products`: loop with keyset cursor, yield `ImportBatch` per page, emit final batch with `hasMore: false`
  - `streamImport` for `categories` and `brands`: fetch all, yield single batch
  - `validateConnection`: run `countProducts` query, return `{ ok, details: { productCount } }`
  - `getMapping`: return static field mapping config
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 3.2, 6.1, 6.2, 6.3_

- [ ]* 7.2 Write property test for incremental sync filtering
  - **Property 5: Incremental sync filters by `updated_at`**
  - **Validates: Requirements 2.3**

- [ ]* 7.3 Write property test for resume without duplicates
  - **Property 6: Resume without duplicates**
  - **Validates: Requirements 2.2**

- [ ] 8. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement `B2BApiPricingDriver`
- [x] 9.1 Create `lib/pricing-driver.ts` with `createB2BApiPricingDriver`
  - Call `GET {pricingApiUrl}/product/prices/?gci={gci}&cid={customerId}&symbols={symbol}`
  - Map response `contractor_net_price` (or `net_price` fallback) to `PriceRow` with `kind: 'live'`
  - Return `null` on any error or timeout
  - Implement in-memory TTL cache keyed by `symbol+customerId`, default TTL 60s
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [ ]* 9.2 Write property test for pricing driver valid response mapping
  - **Property 10: Pricing driver returns valid PriceRow for valid API response**
  - **Validates: Requirements 5.1, 5.2**

- [ ]* 9.3 Write property test for pricing driver caching idempotence
  - **Property 11: Pricing driver caching idempotence**
  - **Validates: Requirements 5.5**

- [x] 10. Wire up the DI module and package exports
- [x] 10.1 Create `di.ts` calling `registerDataSyncAdapter` and `registerCatalogPricingResolver`
  - Mirror `sync-akeneo/di.ts` pattern exactly
  - Export `register(container: AppContainer)` as the primary entry point
  - _Requirements: 8.1, 8.2, 5.4_

- [ ] 11. Final Checkpoint — Ensure all tests pass, ask the user if questions arise.
