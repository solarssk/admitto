/** Discourage password managers from treating check-in search fields as login forms. */
export const checkinSearchFieldAttrs = {
  autoComplete: "off",
  role: "searchbox",
  spellCheck: false,
  "data-bwignore": "",
  "data-lpignore": "true",
  "data-1p-ignore": "",
  "data-form-type": "other",
} as const;
