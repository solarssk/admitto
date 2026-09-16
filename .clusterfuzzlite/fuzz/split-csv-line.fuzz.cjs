// Fuzzes packages/shared/src/csvUtils.ts's splitCsvLine - the RFC 4180 field splitter that
// parses one line of an admin-uploaded attendee CSV import (packages/import/src/parser.ts).
// Hand-rolled char-by-char scanner (not a library), so its own index-advancement logic is the
// thing worth fuzzing for a hang or an out-of-bounds read, not a third-party dependency's bug.
const { splitCsvLine } = require("../.build/shared/csvUtils.cjs");

/**
 * @param { Buffer } data
 */
module.exports.fuzz = function (data) {
  splitCsvLine(data.toString("utf8"));
};
