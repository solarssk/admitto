/**
 * Samsung wordmark (Simple Icons, CC0: https://simpleicons.org - "Samsung"). Tabler Icons has no
 * plain Samsung brand glyph (only `brand-samsungpass`, a different product), so this fills in for
 * the Apple/Google rows' `<i className="ti ti-brand-...">` font glyphs. `fill="currentColor"`
 * (the source's own `#000000` swapped out) so it tints the same way inside
 * `.wallet-platform-row__icon`'s circle, including in dark mode.
 *
 * The source's own 24x24 viewBox is mostly empty - measured via getBBox() in a real browser
 * (not eyeballed): the glyph itself is only x:[0,24] y:[10.17,13.83], ~15% of the box's height.
 * Rendered at that nominal 24x24 size the word was a near-invisible sliver, which is what
 * prompted this fix - viewBox cropped to the true bounds (+ a little breathing room) so the
 * rendered box is exactly wordmark-shaped, then sized wide-and-short (not square, unlike the
 * Apple/Google glyphs) to fit inside the 40px circle without overflowing it.
 *
 * Only used in Event Settings' own Wallet row (a wide, short slot next to the Apple/Google
 * icon-font glyphs there). Everywhere else a Samsung glyph sits alongside Apple/Google's square
 * Tabler icons (Attendees' Wallet column, Attendee Detail's Wallet card) - see
 * {@link SamsungGlyphIcon} below for that square-shaped mark instead. */
export function SamsungWalletIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="-0.3 9.87 24.6 4.27"
      width="36"
      height="6.25"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="m19.8166 10.2808 0.0459 2.6934h-0.023l-0.7793 -2.6934h-1.2837v3.3925h0.8481l-0.0458 -2.785h0.023l0.8366 2.785h1.2264v-3.3925zm-16.149 0 -0.6418 3.427h0.9284l0.4699 -3.1175h0.0229l0.4585 3.1174h0.9169l-0.6304 -3.4269zm5.1805 0 -0.424 2.6132h-0.023l-0.424 -2.6132H6.5788l-0.0688 3.427h0.8596l0.023 -3.0832h0.0114l0.573 3.0831h0.8711l0.5731 -3.083h0.023l0.0228 3.083h0.8596l-0.0802 -3.4269zm-7.2664 2.4527c0.0343 0.0802 0.0229 0.1949 0.0114 0.2522 -0.0229 0.1146 -0.1031 0.2292 -0.3324 0.2292 -0.2177 0 -0.3438 -0.126 -0.3438 -0.3095v-0.3323H0v0.2636c0 0.7679 0.6074 0.9971 1.2493 0.9971 0.6189 0 1.1346 -0.2178 1.2149 -0.7794 0.0458 -0.298 0.0114 -0.4928 0 -0.5616 -0.1605 -0.722 -1.467 -0.9283 -1.5588 -1.3295 -0.0114 -0.0688 -0.0114 -0.1375 0 -0.1834 0.023 -0.1146 0.1032 -0.2292 0.3095 -0.2292 0.2063 0 0.321 0.126 0.321 0.3095v0.2063h0.8595v-0.2407c0 -0.745 -0.6762 -0.8596 -1.1576 -0.8596 -0.6074 0 -1.1117 0.2063 -1.2034 0.7564 -0.023 0.149 -0.0344 0.2866 0.0114 0.4585 0.1376 0.7106 1.364 0.9169 1.5358 1.3524m11.152 0c0.0343 0.0803 0.0228 0.1834 0.0114 0.2522 -0.023 0.1146 -0.1032 0.2292 -0.3324 0.2292 -0.2178 0 -0.3438 -0.126 -0.3438 -0.3095v-0.3323h-0.917v0.2636c0 0.7564 0.596 0.9857 1.2379 0.9857 0.6189 0 1.1232 -0.2063 1.2034 -0.7794 0.0459 -0.298 0.0115 -0.4814 0 -0.5616 -0.1375 -0.7106 -1.4327 -0.9284 -1.5243 -1.318 -0.0115 -0.0688 -0.0115 -0.1376 0 -0.1835 0.0229 -0.1146 0.1031 -0.2292 0.3094 -0.2292 0.1948 0 0.321 0.126 0.321 0.3095v0.2063h0.848v-0.2407c0 -0.745 -0.6647 -0.8596 -1.146 -0.8596 -0.6075 0 -1.1004 0.1948 -1.192 0.7564 -0.023 0.149 -0.023 0.2866 0.0114 0.4585 0.1376 0.7106 1.341 0.9054 1.513 1.3524m2.8882 0.4585c0.2407 0 0.3094 -0.1605 0.3323 -0.2522 0.0115 -0.0343 0.0115 -0.0917 0.0115 -0.126v-2.533h0.871v2.4642c0 0.0688 0 0.1948 -0.0114 0.2292 -0.0573 0.6419 -0.5616 0.8482 -1.192 0.8482 -0.6303 0 -1.1346 -0.2063 -1.192 -0.8482 0 -0.0344 -0.0114 -0.1604 -0.0114 -0.2292v-2.4642h0.871v2.533c0 0.0458 0 0.0916 0.0115 0.126 0 0.0917 0.0688 0.2522 0.3095 0.2522m7.1518 -0.0344c0.2522 0 0.3324 -0.1605 0.3553 -0.2522 0.0115 -0.0343 0.0115 -0.0917 0.0115 -0.126v-0.4929h-0.3553v-0.5043H24v0.917c0 0.0687 0 0.1145 -0.0115 0.2292 -0.0573 0.6303 -0.596 0.8481 -1.2034 0.8481 -0.6075 0 -1.1461 -0.2178 -1.2034 -0.8481 -0.0115 -0.1147 -0.0115 -0.1605 -0.0115 -0.2293v-1.444c0 -0.0574 0.0115 -0.172 0.0115 -0.2293 0.0802 -0.6419 0.596 -0.8482 1.2034 -0.8482s1.1347 0.2063 1.2034 0.8482c0.0115 0.1031 0.0115 0.2292 0.0115 0.2292v0.1146h-0.8596v-0.1948s0 -0.0803 -0.0115 -0.1261c-0.0114 -0.0802 -0.0802 -0.2521 -0.3438 -0.2521 -0.2521 0 -0.321 0.1604 -0.3438 0.2521 -0.0115 0.0458 -0.0115 0.1032 -0.0115 0.1605v1.5702c0 0.0458 0 0.0916 0.0115 0.126 0 0.0917 0.0917 0.2522 0.3323 0.2522"
      />
    </svg>
  );
}

/**
 * Samsung's own "S" ribbon mark (SVG Repo, CC0: https://www.svgrepo.com - "Samsung S"), square
 * like the Apple/Google Tabler glyphs it sits beside (Attendees' Wallet column, Attendee Detail's
 * Wallet card) - unlike {@link SamsungWalletIcon} above, which is wordmark-shaped for Event
 * Settings' own wide row. `width`/`height` in `em` (not a fixed px size) so it scales with the
 * caller's own `font-size`, the same trick an icon font glyph gets for free - callers pass the
 * exact same `attendees-table-v2__wallet-icon[--active]` classes the `<i className="ti ...">`
 * Apple/Google glyphs use, so `currentColor` picks up that class's `color`/`opacity` identically.
 *
 * Source is a rounded-square app-icon tile (white background + a fixed-blue mark) - only the mark
 * itself is kept here (no background, no fixed color) so it behaves like a monochrome glyph, not
 * a two-tone icon that can't be tinted muted/active/dark-mode the way its Apple/Google neighbors
 * are. viewBox cropped to the mark's own true bounds - measured via getBBox() in a real browser,
 * not eyeballed, the same way as SamsungWalletIcon's own crop above - plus a little breathing
 * room, since the source's full 512x512 viewBox is mostly empty margin around the mark. */
export function SamsungGlyphIcon({
  className,
  "aria-label": ariaLabel,
}: Readonly<{ className?: string; "aria-label": string }>): React.JSX.Element {
  return (
    <svg
      viewBox="112 50 288 412"
      width="1em"
      height="1em"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      <path
        fill="currentColor"
        d="M292.588 332.165c3.486 8.609 2.419 19.708 .783 26.396c-2.988 11.811-11.028 23.906 -34.65 23.906c-22.341 0-35.859 -12.807 -35.859 -32.302l0-34.436l-95.482 0l-.071 27.535c0 79.331 62.469 103.309 129.421 103.309c64.39 0 117.396-21.986 125.792 -81.324c4.34-30.736 1.067 -50.872 -.356 -58.485c-15.013-74.493 -150.124 -96.763 -160.157 -138.385c-1.708-7.115 -1.21 -14.728 -.356 -18.783c2.49-11.313 10.246 -23.835 32.515 -23.835c20.776 0 33.084 12.878 33.084 32.302c0 6.546 0 21.985 0 21.985l88.723 0l0-24.973c0-77.553 -69.584 -89.648 -119.958 -89.648c-63.323 0-115.048 20.918 -124.511 78.833c-2.561 16.009-2.917 30.238 .783 48.097c15.582 72.643 141.943 93.704 160.299 139.808z"
      />
    </svg>
  );
}
