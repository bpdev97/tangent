# Provider-safe HEIC/HEIF upload normalization

`FORK-IMAGE-001` makes HEIC and HEIF uploads usable across providers without teaching each provider
adapter about Apple image containers.

## Decision

Modern web clients use upstream's client-side HEIC conversion before the attachment upload queue.
Keep server normalization for inline attachments from mobile and older clients, before attachment
metadata, persistence paths, asset URLs, or provider dispatch are created. The canonical stored
attachment is JPEG in either path.

This is a fork-level compatibility boundary rather than a Hermes adapter workaround. Hermes Agent
0.19.0 rejects `.heic` and `.heif` in `image.attach` before its later image-routing code can inspect
or transcode the bytes. Other providers and browser previews also benefit from receiving the same
widely supported persisted format.

## Architecture

The compatibility upload path is:

```text
client data URL
  -> validate compressed-byte limit and image/HEIC identity
  -> detect HEIC/HEIF MIME or ISO BMFF ftyp brand
  -> worker-thread decode and JPEG encode
  -> create canonical metadata and .jpg persistence path
  -> persist bytes
  -> serve assets and dispatch to any provider
```

`apps/server/src/imageNormalization.ts` owns server-side format detection and conversion.
`apps/server/src/orchestration/Normalizer.ts` owns when conversion occurs for inline data URLs.
Upstream's web compressor and attachment queue own the current web path. Provider adapters remain
consumers of canonical attachments and must not add their own HEIC conversion.

Files that are not HEIC/HEIF remain byte-for-byte pass-through. Detection accepts a declared
HEIC/HEIF MIME type or a valid ISO-BMFF `ftyp` box containing a known HEIC major or compatible brand:
`heic`, `heix`, `hevc`, `hevx`, `heim`, `heis`, `hevm`, or `hevs`. This catches files whose generic
major brand is `mif1`/`msf1` but whose compatible list identifies HEIC. An
`application/octet-stream` data URL is accepted only when that signature check succeeds; unrelated
non-image payloads remain invalid. The `avif` brand is not treated as HEIC.

The first image in a HEIF sequence becomes the canonical JPEG; auxiliary images, depth maps, and
container metadata are intentionally not persisted.

## Output policy

- Output MIME type: `image/jpeg`.
- Output display extension: `.jpg`.
- JPEG quality attempts: 90, 75, then 60, stopping at the first result within the existing 10 MiB
  attachment limit.
- A lossless PNG output was rejected because photographic HEIC inputs can expand beyond the
  attachment budget.
- HDR and HEIF-specific metadata are not preserved.

## Resource and failure invariants

- CPU-heavy decode and encode work runs outside the server event loop in a worker thread.
- Compressed input remains subject to the existing 10 MiB upload limit.
- Declared dimensions are checked before allocating the decoded pixel buffer; images above 40
  megapixels are rejected.
- Conversion has a 30-second Effect timeout. Interruption or timeout terminates the worker.
- The worker has a constrained V8 heap and fixed output-quality attempts.
- Invalid input, excessive dimensions, oversized output, timeout, and worker failure become
  controlled orchestration errors. Decoder internals, local paths, and raw worker failures are not
  exposed to clients.

## Dependencies and packaging

The server declares `heic-decode` and `jpeg-js` as direct runtime dependencies. `heic-decode` brings
the `libheif-js` WASM decoder transitively. Keep these dependencies on the server package: the
worker resolves them at runtime from the packaged server installation.

When changing server bundling or dependency externalization, build the server bundle and verify
that a packaged installation can resolve both direct dependencies before shipping.

## Upstream sync and removal criteria

During an upstream sync, review changes to upload schemas, web conversion and upload queuing, data
URL parsing, image MIME inference, the shared orchestration normalizer, attachment paths, asset
serving, and provider image APIs. Keep conversion before persistence and provider dispatch.
Preserve pass-through behavior for JPEG, PNG, GIF, WebP, and AVIF.

Remove `FORK-IMAGE-001` only when every supported client normalizes before upload, or upstream adds
equivalent server ingestion for inline clients, and HEIC/HEIF works end to end across persistence,
browser assets, and providers that reject HEIC/HEIF paths or MIME types. Upstream's web-only
conversion does not cover mobile or older clients and is not yet an equivalent replacement.

## Compatibility baseline

On 2026-08-01, deterministic tests used a real HEIC fixture to verify declared-MIME detection,
compatible-brand detection, `application/octet-stream` ingestion, decoding, JPEG output, canonical
`.jpg`/`image/jpeg` metadata, attachment-path creation, and persisted JPEG bytes. Client rendering
and a real-provider upload are separate checks and must not be inferred from those server tests.

## Revalidation procedure

1. Run
   `vp test apps/server/src/imageNormalization.test.ts apps/server/src/orchestration/Normalizer.test.ts`.
2. Run the focused attachment tests for every affected provider.
3. Run `vp run --filter t3 build:bundle`, `vp check`, and `vp run typecheck`.
4. Upload a real HEIC through web and one representative mobile client. Confirm the persisted
   attachment uses `.jpg`, reports `image/jpeg`, renders in the conversation, and reaches the
   selected provider.
5. Verify JPEG, PNG, GIF, WebP, and AVIF remain byte-for-byte pass-through. Include a fixture whose
   HEIF identity appears only in compatible brands before claiming general signature detection.
6. Record only checks that actually ran; distinguish deterministic server tests, packaged-server
   checks, provider-binary smokes, and full client coverage.
