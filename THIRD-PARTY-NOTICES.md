# Third-party notices

Attribution for components redistributed with Admitto at runtime (production image / served assets). These licenses apply to those components only; Admitto application code is under [Apache License 2.0](LICENSE). See also the short Apache [NOTICE](NOTICE).

This file is informational. Prefer package-local license files in `node_modules` (or the image) as the authoritative text for each dependency.

## Fonts (SIL Open Font License 1.1)

- Packages: `@fontsource/ibm-plex-sans`, `@fontsource/inter`, `@fontsource/manrope`, `@fontsource/space-grotesk`
- License: OFL-1.1
- Notes: Font software remains under OFL-1.1. Preserve copyright notices and the OFL text when redistributing the font files. Full license text ships with each package (for example `node_modules/@fontsource/*/LICENSE`).

## libvips (via sharp)

- Packages: `sharp`, platform packages `@img/sharp-libvips-*`, and `@img/sharp-wasm32`
- License: LGPL-3.0-or-later for libvips / sharp-libvips native binaries and the wasm32 build; `sharp` itself is Apache-2.0 (see the sharp package `LICENSE`)
- Notes: Admitto links to prebuilt libvips binaries. LGPL obligations apply to that library, not to Admitto application code. When distributing binaries that include libvips, retain LGPL notices and license text from the sharp / sharp-libvips / sharp-wasm32 packages.

## elkjs

- Package: `elkjs`
- License: EPL-2.0
- Notes: Graph-layout engine used only through its public API, unmodified. EPL-2.0 is a file-level (weak) copyleft license - its share-alike obligation applies to modifications of elkjs's own source files, not to code that merely calls it, so it does not extend to Admitto application code. Retain the package's own `LICENSE`/notice files when redistributing.

## lightningcss

- Packages: `lightningcss` and platform package `lightningcss-darwin-arm64`
- License: MPL-2.0
- Notes: CSS parser/transformer used unmodified as part of Vite's build pipeline (dev/build tooling, not shipped in the runtime server image). MPL-2.0 is also file-level copyleft - applies to modifications of lightningcss's own source, not to code that uses it as a library.
