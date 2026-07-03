/** Synthetic passwords for strength tests — built from parts to avoid secret-scan false positives. */
export const PASSWORD_STRENGTH_WEAK = "a".repeat(12);
export const PASSWORD_STRENGTH_FAIR = ["test", "Password", "1"].join("");
export const PASSWORD_STRENGTH_GOOD = ["test", "Password", "12", "!"].join("");
export const PASSWORD_STRENGTH_STRONG = ["test", "Password", "1234", "!@"].join("");
