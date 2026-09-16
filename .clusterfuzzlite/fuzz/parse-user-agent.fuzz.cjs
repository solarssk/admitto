// Fuzzes apps/admin/src/utils/parseUserAgent.ts's parseUserAgent/parseUserAgentWithVersion -
// pure regex matching over a stored request User-Agent header (e.g. WalletPass.user_agent),
// attacker-controlled at request time. The file's own comments already document one prior
// SonarCloud super-linear-backtracking finding (S8786) on this exact input; this harness gives
// that fix (and any future pattern added to BROWSER_PATTERNS/OS_PATTERNS) a way to be checked
// continuously instead of only at review time.
const { parseUserAgent, parseUserAgentWithVersion } = require("../.build/admin/parseUserAgent.cjs");

/**
 * @param { Buffer } data
 */
module.exports.fuzz = function (data) {
  const ua = data.toString("utf8");
  parseUserAgent(ua);
  parseUserAgentWithVersion(ua);
};
