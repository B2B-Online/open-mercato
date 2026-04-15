# Requirements Document

## Introduction

This feature integrates b2bapi/ishark product catalog data into open-mercato by implementing a `DataSyncAdapter` (following the existing Akeneo sync pattern) that bulk-imports products directly from the ishark database via the `WebsiteProductsView` SQL view. Direct database access is used instead of the REST API to achieve the throughput required for catalogs with millions of products. Each open-mercato tenant is configured with a specific `frontendId` (ishark `frontend_id`) that scopes the sync to a single website. Prices are intentionally excluded from the sync — they are resolved at runtime via live driver connections modeled after the Greencheck distributor driver pattern, calling the existing b2bapi price endpoint (`/product/prices/`). A new `sync-b2bapi` package is created inside the open-mercato monorepo to house the adapter, live pricing driver, and related infrastructure.

## Glossary

- **b2bapi**: The Django/Python backend that exposes product data via the ishark-models ORM and a REST API.
- **ishark**: The shared Django model library; `WebsiteProductsView` is a read-only database view that aggregates product catalog data per website/frontend.
- **WebsiteProductsView**: A managed=False Django model backed by the `website_products_view` SQL view in the ishark database. Contains product identity, category, brand, descriptions, images, flags, and a stored `net_price`/`gross_price` (not used for live pricing).
- **open-mercato**: The TypeScript/Node.js e-commerce platform. Products live in the `catalog` module as `CatalogProduct` and `CatalogProductVariant` entities.
- **DataSyncAdapter**: The open-mercato interface (`packages/core/src/modules/data_sync/lib/adapter.ts`) that defines `streamImport`, `getMapping`, and `validateConnection` for batch data ingestion.
- **sync-b2bapi**: The new open-mercato package (`packages/sync-b2bapi`) that implements the `DataSyncAdapter` for b2bapi/ishark products.
- **Live Pricing Driver**: A runtime connector that queries a distributor or supplier API for real-time price and availability, analogous to the Greencheck `driver_eval` / `SUPPLIER_AVAILABILITY` pattern.
- **B2BAPI Pricing Driver**: The specific live pricing driver in `sync-b2bapi` that calls the b2bapi REST endpoint to retrieve current prices for a product by symbol/SKU.
- **CatalogPricingResolver**: The open-mercato hook (`registerCatalogPricingResolver`) that intercepts price resolution and delegates to an external source.
- **Cursor**: A serialized string encoding pagination state (last seen `updated_at` timestamp and offset/page URL) used to resume interrupted syncs.
- **Batch**: A fixed-size slice of products streamed from b2bapi during a sync run; default size is 100 records.
- **GCI**: Greencheck supplier identifier used to route availability/pricing requests to the correct distributor driver.
- **frontendId**: The ishark `frontend_id` integer that identifies which website/storefront's products to sync. Each open-mercato tenant is configured with exactly one `frontendId`.
- **Symbol**: The unique product identifier in the ishark/b2bapi system (`WebsiteProductsView.symbol`), mapped to `externalId` in open-mercato.
- **Reconciliation**: The process of marking open-mercato catalog products as inactive or deleted when they are no longer present in the b2bapi source after a full sync.

---

## Requirements

### Requirement 1

**User Story:** As a catalog administrator, I want to bulk-import products from b2bapi into open-mercato, so that the open-mercato catalog reflects the full ishark product catalog without manual data entry.

#### Acceptance Criteria

1. WHEN a sync job is started for entity type `products`, THE sync-b2bapi adapter SHALL stream products from the ishark `website_products_view` SQL view using a direct database connection, filtered by the configured `frontendId`, in batches of configurable size (default 100).
2. WHEN a product batch is fetched, THE sync-b2bapi adapter SHALL map each `WebsiteProductsView` record to a `CatalogProduct` (and optionally `CatalogProductVariant`) using the configured field mapping.
3. WHEN a product already exists in open-mercato (matched by `symbol` as `externalId`), THE sync-b2bapi adapter SHALL update the existing record rather than create a duplicate.
4. WHEN a product does not yet exist in open-mercato, THE sync-b2bapi adapter SHALL create a new `CatalogProduct` record with all mapped fields populated.
5. WHEN a full sync completes, THE sync-b2bapi adapter SHALL reconcile the catalog by marking products absent from the b2bapi source as inactive in open-mercato.

---

### Requirement 2

**User Story:** As a platform engineer, I want the product sync to be resumable and incremental, so that interrupted syncs can continue without re-processing millions of records from the beginning.

#### Acceptance Criteria

1. WHEN a sync batch is yielded, THE sync-b2bapi adapter SHALL include a cursor string encoding the current pagination state (last `updated_at` and page offset).
2. WHEN a sync job is restarted with a previously stored cursor, THE sync-b2bapi adapter SHALL resume fetching from the position encoded in that cursor without re-processing earlier records.
3. WHEN an incremental sync is triggered (cursor present), THE sync-b2bapi adapter SHALL request only products with `updated_at` greater than the timestamp stored in the cursor.
4. WHEN the b2bapi source returns no more pages, THE sync-b2bapi adapter SHALL emit a final batch with `hasMore: false` and a cursor encoding the maximum `updated_at` seen during the run.

---

### Requirement 3

**User Story:** As a platform engineer, I want the product sync to perform efficiently at millions of records, so that full catalog imports complete in a reasonable time without exhausting memory or database connections.

#### Acceptance Criteria

1. WHEN streaming products, THE sync-b2bapi adapter SHALL fetch records using keyset pagination on `(updated_at, id)` directly against the ishark PostgreSQL read replica, to avoid performance degradation at high offsets.
2. WHEN processing a batch, THE sync-b2bapi adapter SHALL not hold more than one batch of product records in memory at a time.
3. WHEN querying the ishark database, THE sync-b2bapi adapter SHALL support a configurable `batchSize` parameter with a maximum of 1000 records per query.
4. WHEN mapping product fields, THE sync-b2bapi adapter SHALL exclude all price fields (`net_price`, `gross_price`, `default_price_net`, `default_price_gross`) from the synced payload.

---

### Requirement 4

**User Story:** As a catalog administrator, I want product categories and brands to be synced alongside products, so that the open-mercato catalog has a complete taxonomy without orphaned references.

#### Acceptance Criteria

1. WHEN the entity type `categories` is synced, THE sync-b2bapi adapter SHALL import ishark `Category` records and map them to open-mercato catalog categories, preserving the parent-child hierarchy.
2. WHEN the entity type `brands` is synced, THE sync-b2bapi adapter SHALL import ishark `Brand` records and map them to open-mercato catalog brands.
3. WHEN a product references a category or brand that does not yet exist in open-mercato, THE sync-b2bapi adapter SHALL create the missing category or brand before creating the product.
4. WHEN a category's `path` field encodes a hierarchy, THE sync-b2bapi adapter SHALL reconstruct the full ancestor chain in open-mercato using the dot-separated path.

---

### Requirement 5

**User Story:** As a storefront developer, I want product prices to be resolved in real time from the b2bapi pricing endpoint, so that customers always see current prices without waiting for a sync cycle.

#### Acceptance Criteria

1. WHEN a price is requested for a product in open-mercato, THE B2BAPI Pricing Driver SHALL call the existing b2bapi price endpoint (`/product/prices/?gci=<GCI>&cid=<customer_code>&symbols=<symbol>`) with the product `symbol`, `GCI`, and optional `customer_code` parameters.
2. WHEN the b2bapi price endpoint returns a valid price, THE B2BAPI Pricing Driver SHALL return a `PriceRow` compatible with the open-mercato `CatalogPricingResolver` interface.
3. WHEN the b2bapi price endpoint returns an error or times out, THE B2BAPI Pricing Driver SHALL return `null` so that open-mercato falls back to the next registered pricing resolver.
4. WHEN the B2BAPI Pricing Driver is registered, THE sync-b2bapi package SHALL call `registerCatalogPricingResolver` with a configurable priority so that it can be ordered relative to other resolvers.
5. WHEN a price response is received, THE B2BAPI Pricing Driver SHALL cache the result for a configurable TTL (default 60 seconds) per `symbol`+`customerId` key to reduce redundant API calls.

---

### Requirement 6

**User Story:** As a platform engineer, I want the b2bapi connection to be validated before a sync starts, so that misconfigured credentials or unreachable endpoints are detected early.

#### Acceptance Criteria

1. WHEN `validateConnection` is called, THE sync-b2bapi adapter SHALL perform a test query against the ishark database (e.g. `SELECT COUNT(*) FROM website_products_view WHERE frontend_id = <frontendId>`) using the provided credentials and return `{ ok: true }` on success.
2. IF the database connection fails or the query returns an error, THEN THE sync-b2bapi adapter SHALL return `{ ok: false, message: <error description> }`.
3. WHEN `validateConnection` succeeds, THE sync-b2bapi adapter SHALL include discovery metadata (total product count for the configured `frontendId`) in the `details` field of the result.

---

### Requirement 7

**User Story:** As a developer, I want the b2bapi product data to be serializable and deserializable without loss, so that the sync pipeline can safely checkpoint and resume state.

#### Acceptance Criteria

1. WHEN a cursor is produced by the sync-b2bapi adapter, THE sync-b2bapi adapter SHALL encode the cursor as a valid JSON string.
2. WHEN a cursor JSON string is parsed, THE sync-b2bapi adapter SHALL produce a cursor object equivalent to the one that was encoded.
3. WHEN a product batch item is serialized to the `ImportItem` data payload, THE sync-b2bapi adapter SHALL include all mapped non-price fields without data loss.

---

### Requirement 8

**User Story:** As a platform engineer, I want the sync-b2bapi package to integrate cleanly into the open-mercato monorepo, so that it follows the same conventions as the existing sync-akeneo package.

#### Acceptance Criteria

1. WHEN the sync-b2bapi package is registered, THE sync-b2bapi DI module SHALL call `registerDataSyncAdapter` with the b2bapi adapter, following the same pattern as `sync-akeneo/di.ts`.
2. WHEN the sync-b2bapi package is built, THE sync-b2bapi package SHALL export a `register(container)` function as its primary entry point.
3. WHEN the sync-b2bapi adapter is configured, THE sync-b2bapi adapter SHALL accept credentials as a plain object containing `dbHost`, `dbPort`, `dbName`, `dbUser`, `dbPassword`, `frontendId`, `pricingApiUrl`, and `pricingApiKey` fields.
