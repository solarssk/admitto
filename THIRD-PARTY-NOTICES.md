# Third-party notices

Attribution for components redistributed with Admitto at runtime (production image / served assets). These licenses apply to those components only; Admitto application code is under [Apache License 2.0](LICENSE). See also the short Apache [NOTICE](NOTICE).

This file is informational. Prefer package-local license files in `node_modules` (or the image) as the authoritative text for each dependency.

## Fonts (SIL Open Font License 1.1)

- Packages: `@fontsource/ibm-plex-sans`, `@fontsource/inter`, `@fontsource/manrope`, `@fontsource/space-grotesk`
- License: OFL-1.1
- Notes: Font software remains under OFL-1.1. Preserve copyright notices and the OFL text when redistributing the font files. Full license text ships with each package (for example `node_modules/@fontsource/*/LICENSE`).

## libvips (via sharp)

- Packages: `sharp` and platform packages `@img/sharp-libvips-*`
- License: LGPL-3.0-or-later for libvips / sharp-libvips native binaries; `sharp` itself is Apache-2.0 (see the sharp package `LICENSE`)
- Notes: Admitto links to prebuilt libvips binaries. LGPL obligations apply to that library, not to Admitto application code. When distributing binaries that include libvips, retain LGPL notices and license text from the sharp / sharp-libvips packages.
