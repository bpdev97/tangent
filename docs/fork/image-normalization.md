# FORK-IMAGE-001: image normalization and mobile capture

## Why

iPhone photos are HEIC by default. Hermes rejects `.heic` and `.heif` attachments before it even
decodes them, and other providers and browser previews handle HEIC unevenly. Upstream's web client
converts HEIC before upload, but mobile and older clients send inline images that reach the server
unconverted. Tangent converts once, at the shared upload boundary, so every provider and every
stored attachment sees the same JPEG.

On the phone, large photos need shrinking before upload: raising the server's size limit would keep
slow phone transfers and large base64 drafts. Tangent also adds a Camera option to every composer,
which upstream lacks.

## Behavior

Server:

- Conversion happens once, before attachment metadata, storage paths, asset URLs, or provider
  dispatch are created. Providers only ever see the stored JPEG.
- HEIC is recognized by a declared HEIC or HEIF MIME type, or by an ISO-BMFF `ftyp` box with a known
  HEIC major or compatible brand (`heic`, `heix`, `hevc`, `hevx`, `heim`, `heis`, `hevm`, `hevs`).
  An `application/octet-stream` upload is accepted only when that check passes. AVIF's `avif` brand
  is not HEIC.
- Other formats pass through byte for byte.
- Decoding runs in a resource-limited worker thread: images over 40 megapixels are rejected before
  allocation, conversion times out after 30 seconds, and the worker is terminated on timeout.
- Output is JPEG (`image/jpeg`, `.jpg`), trying quality 90, 75, then 60 until it fits the existing
  10 MiB limit. The first image of a HEIF sequence is kept; depth maps, auxiliary images, HDR, and
  HEIF metadata are not.
- Failures become controlled errors that do not expose decoder internals or local paths.
- `heic-decode` and `jpeg-js` are direct server dependencies and stay external in the server bundle.
  Keep `libheif-js` pinned to 1.19.8 until its tiled-image regression is fixed; 1.23.2 rejects a
  valid 16×16 fixture.

Mobile:

- Library, camera, clipboard, and share-sheet images all go through one preparation helper before
  the unchanged 10 MiB upload limit.
- Images within the limit keep their bytes. Larger inputs up to 50 MiB get bounded re-encoding: PNG
  stays PNG to keep transparency; oversized GIF and WebP are rejected rather than losing animation.
  Temporary files and native resources are released on success and failure.
- Camera sits directly below Photo Library in the new-thread, existing-thread, question, and review
  composers, including on servers without generic file uploads. Cancelling or denying permission
  keeps the draft.
- The attachment menu uses the native menu patch's `fixedOrder` so iOS does not reverse the order
  when the menu opens upward.
- Native dependency or camera permission changes require a native iOS build; they cannot ship as an
  OTA update.

## Upstream hooks

Planned:

- `apps/server/src/ws.ts`: one call in `persistChatAttachments` before the bytes are written, plus
  the HTTP upload route if it accepts images.
- Mobile composers' attachment menus, the image inputs, and the menu-order patch.
- The server package manifest, CLI external-package list, and lockfile.

Fork-owned: `apps/server/src/imageNormalization.ts`, `apps/server/src/testFixtures/heic.ts`,
`apps/mobile/src/lib/prepareComposerImage.ts`, and their tests.

## Resolving conflicts

- Upload ingestion: take upstream's version and put the conversion call back before metadata and
  path creation. If upstream moves ingestion, move the call with it; there must be exactly one
  conversion point.
- If upstream adds its own mobile shrinking, keep whichever covers all four input paths with the
  same bounds, and drop the other.
- Mobile composers: re-add the Camera option next to Photo Library in every composer upstream has.

## Never

- Never convert images inside a provider adapter.
- Never change bytes of non-HEIC images on the server.
- Never raise the 10 MiB upload limit to avoid shrinking on the phone.
- Never flatten an oversized animated GIF or WebP silently.

## Remove when

- Server part: every supported client converts HEIC before upload, or upstream converts inline
  uploads on the server, and HEIC works end to end across storage, previews, and providers.
- Mobile part: upstream prepares images across all four input paths with the same bounds and offers
  camera capture in the same composers.

## Verify

Server tests with a real HEIC fixture (detection by MIME and by compatible brand, octet-stream
ingestion, JPEG output, stored path and bytes) and pass-through for JPEG, PNG, GIF, WebP, and AVIF.
Mobile tests for the preparation helper. Before shipping a dependency change, build the server
bundle and confirm a packaged install resolves the decoder.
