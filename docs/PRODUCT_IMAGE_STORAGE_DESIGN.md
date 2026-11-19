# HR UNIVERSE — Product Image Storage and Upload Design

## Decision

Product image upload is **not enabled yet**. The current `wrangler.toml` defines only the static `ASSETS` binding and the D1 `DB` binding; it has no R2 bucket binding. Do not implement a fake R2 binding, accept arbitrary external image URLs as uploaded files, or store image bytes in D1.

The public product query already reads the first `product_images.image_url` ordered by `sort_order`. Preserve that public read contract while designing a controlled storage pipeline.

## Existing image schema confirmed

Migration `0001_core_foundation.sql` defines `product_images` with `id`, `product_id`, nullable `variant_id`, required `image_url`, nullable `alt_text`, and `sort_order` (default 0), plus product/variant foreign keys. It has no storage key, media type, byte size, approval state, or lifecycle timestamps. The current public query selects the first image URL by sort order. Therefore a future migration must be additive and preserve existing image rows; do not repurpose `image_url` as an R2 object key or expose raw R2 keys.

## Required architecture before implementation

1. **Private object storage:** create a dedicated Cloudflare R2 bucket for catalog media, then add an explicit Worker binding (for example `PRODUCT_MEDIA`) only after the bucket exists and the deployment environment is known. Production and preview/staging buckets must be separate.
2. **Owner-only upload:** add a dedicated `POST /api/admin/catalog/images` route guarded by the existing owner-token authentication. Accept multipart file content only; never accept a client-supplied object key, bucket name, public URL, or filesystem path.
3. **Strict file validation:** allow JPEG, PNG and WebP only; enforce a small configurable byte ceiling (initial proposal: 5 MiB per image), verify file signatures rather than trusting the browser MIME header or extension, reject SVG/HTML/GIF and malformed files, and reject zero-byte uploads. If a safe image decoder/transform service is not available in the Worker runtime, do not claim dimensions or strip metadata—defer those checks to a trusted image pipeline.
4. **Opaque object keys:** generate a cryptographically random identifier on the server and use a fixed namespace such as `catalog/<opaque-id>.<verified-extension>`. Never incorporate the original filename, product name, SKU, or user path into the key. Avoid overwriting existing objects.
5. **Private-by-default delivery:** R2 must not be exposed through a public bucket hostname. Serve approved images through a same-origin Worker route that resolves an opaque image ID against an approved database record, sets a verified Content-Type, `X-Content-Type-Options: nosniff`, conservative cache headers, and rejects unknown/unapproved objects. Do not create a generic bucket proxy or path traversal surface.
6. **Database metadata and audit:** inspect the exact existing `product_images` schema and current migration history before writing SQL. Persist only the opaque object key, product association, verified media type, byte size, dimensions only if genuinely measured, sort order, approval state and timestamps. Pair metadata changes with append-only catalog audit events using the existing atomic D1 batch pattern. Never store image bytes or owner tokens in D1.
7. **Draft-first lifecycle:** new uploads remain private/unapproved and cannot be returned by `GET /api/products`. Owner must explicitly attach/approve an image for a draft product. Product activation and public image delivery must independently reject deleted, pending, or unapproved image records.
8. **Deletion and replacement:** use soft-delete/audit first, then a separately controlled object cleanup process. Do not delete an object before its database reference transition succeeds. Prevent public cache from serving deleted media longer than the chosen cache policy.
9. **Operational controls:** rate-limit upload attempts, cap files per request and per product, handle interrupted writes, return generic errors without exposing bucket keys, and test missing R2 binding, invalid signatures, oversized files, MIME mismatch, unauthorized access, failed D1 audit batches, orphan cleanup and public access denial.

## Release gates

- [ ] Confirm exact `product_images` schema from the ordered migrations and current production-safe schema snapshot.
- [ ] Create non-production R2 bucket and verify its binding in a disposable environment.
- [ ] Implement upload, private delivery, approval, reorder and soft-delete APIs.
- [ ] Add owner dashboard preview, progress/error handling and explicit approval controls.
- [ ] Add unit/integration tests for authentication, content validation, storage failure and database atomicity.
- [ ] Verify public product responses expose only approved same-origin image URLs.
- [ ] Run full CI against a temporary validation branch; do not merge a validation PR.
- [ ] Obtain explicit owner approval before production bucket creation, secret/binding changes, deployment or database migration.

## Current status (2026-11-19)

- Confirmed `wrangler.toml` has `ASSETS` and `DB` only; no R2 binding exists.
- Confirmed the public product query reads `product_images.image_url` and inspected the original table definition. The current schema has no upload metadata or approval lifecycle.
- No image upload route or R2 bucket has been created. No production resources or data were changed.


## Public catalog image URL privacy guard (2026-11-20)

- The public product API previously returned the stored `product_images.image_url` unchanged, and the storefront assigned it directly to an image `src`. That could reveal a third-party supplier/CDN hostname or a signed query string to customers.
- The Worker now emits only same-origin image paths. Third-party, protocol-relative, unsafe-scheme, API-route and malformed image URLs are returned as `null`; same-origin absolute URLs are normalized to a path and their query strings/fragments are stripped.
- Existing image records and schema are unchanged. This is a privacy guard, not an image upload/storage implementation: supplier-hosted images will remain hidden until copied into approved HR UNIVERSE-controlled storage.
- Regression tests cover local paths, relative paths, same-origin absolute URLs, external supplier URLs, protocol-relative URLs, unsafe schemes, API paths, and null values.
- Feature branch only. No R2 bucket, production migration, production deployment, paid service, or supplier account was changed.
