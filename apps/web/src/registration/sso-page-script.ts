/**
 * The second script of the page of an event whose way in is the company sign-in (D-C4), after the one script of the form
 * (./form-script.ts), under the same nonce. The first is the same text with or without it and does not know it; only the page
 * of this way in carries this one, so every other page is the page it was, byte for byte.
 *
 * It does one thing. The sign-in lasts 30 minutes, and a guest can leave the form open for longer. The server then answers
 * the send with `401 sign_in_required` (./form-contract.ts), and the first script would call that "something went wrong". This
 * script reloads the page on that status, and the server draws its sign-in screen. It reads nothing from the page and writes
 * nothing to it: it only looks at the status of an answer the page was going to read anyway, and passes the answer on unchanged.
 *
 * A fixed text, the same for every event and every request: nothing from the database is put into it.
 */
import { esc } from "../ticket-page.js";

export const REGISTRATION_SSO_SCRIPT = String.raw`
(function () {
  "use strict";
  var send = window.fetch;
  if (typeof send !== "function") return;
  window.fetch = function () {
    return send.apply(window, arguments).then(function (response) {
      if (response.status === 401) window.location.reload();
      return response;
    });
  };
})();
`;

/** The `<script>` element, under the nonce of this response. */
export function renderSsoScript(nonce: string): string {
  return `<script nonce="${esc(nonce)}">${REGISTRATION_SSO_SCRIPT}</script>`;
}
