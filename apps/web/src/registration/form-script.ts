/**
 * The one script of the registration page.
 *
 * It is a fixed text, the same for every event and every request: nothing from the database is put
 * into it. What it needs to know about the form (which fields exist, which are required, what to say
 * when one is empty, which question an answer belongs to) is read from `data-*` attributes the
 * server wrote, and everything it prints is set as text, never as HTML. It runs under a per-response
 * nonce (see ./form-page.ts) and needs no other script apart from Cloudflare's own widget.
 *
 * What it does:
 * - checks the form in the browser, without moving anything: an error goes into the slot that is
 *   already under the field. The first problem gets the focus, and a notice with the count is read
 *   out. A form whose terms are not accepted, or whose challenge is not solved, is never sent;
 * - sends the answers as JSON with `fetch` (the contract is in ./form-contract.ts) and shows what the
 *   server says: "Check your inbox", an error under a field, or "Try again in a moment". A field that
 *   carries its own sentence for a refused answer (`data-invalid`: a long text, a date, a time, a phone
 *   number) shows that sentence and never the server's text;
 * - gives the Turnstile widget its three callbacks and tells the guest when the widget cannot load.
 *
 * Nothing the guest typed is put in an address, and the page has no cookie.
 */

import { esc } from "../ticket-page.js";

/** The script, without its `<script>` tag. */
export const REGISTRATION_FORM_SCRIPT = String.raw`
(function () {
  "use strict";
  var form = document.getElementById("reg-form");
  var submit = document.getElementById("reg-submit");
  if (!form || !submit) return;
  var label = document.getElementById("reg-submit-label");
  var summary = document.getElementById("reg-error");
  var summaryText = document.getElementById("reg-error-text");
  var done = document.getElementById("reg-done");
  var doneTitle = document.getElementById("reg-done-title");
  var doneEmail = document.getElementById("reg-done-email");
  var again = document.getElementById("reg-again");
  var regions = Array.prototype.slice.call(document.querySelectorAll("[data-hide-when-done]"));
  var boxes = Array.prototype.slice.call(form.querySelectorAll("[data-field]"));
  var challenge = form.querySelector('[data-kind="challenge"]');
  var captcha = form.querySelector(".cf-turnstile");
  var sendLabel = label.textContent;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var TIMEOUT_MS = 30000;
  var WIDGET_WAIT_MS = 10000;
  var TEXT = {
    sending: "Sending…",
    retry: "Try again in a moment.",
    failed: "Something went wrong. Check your details and try again.",
    noCheck: "The security check did not load. Reload the page. If it keeps failing, allow challenges.cloudflare.com.",
    oneField: "1 field needs your attention. It is marked in red.",
    manyFields: " fields need your attention. They are marked in red."
  };
  var token = "";
  var busy = false;

  function control(box) {
    return box.querySelector("[data-control]");
  }

  function setError(box, message) {
    var ctl = control(box);
    var text = box.querySelector("[data-msg-text]");
    box.classList.add("has-error");
    if (text) text.textContent = message;
    if (!ctl || ctl.tagName === "DIV") return;
    ctl.setAttribute("aria-invalid", "true");
    if (ctl.tagName === "SELECT") ctl.classList.add("at-select--invalid");
    else if (ctl.tagName === "TEXTAREA") ctl.classList.add("at-textarea--invalid");
    else if (ctl.type !== "checkbox") ctl.classList.add("at-input--invalid");
  }

  function clearError(box) {
    var ctl = control(box);
    var text = box.querySelector("[data-msg-text]");
    box.classList.remove("has-error");
    if (text) text.textContent = "";
    if (!ctl) return;
    ctl.removeAttribute("aria-invalid");
    ctl.classList.remove("at-input--invalid");
    ctl.classList.remove("at-select--invalid");
    ctl.classList.remove("at-textarea--invalid");
  }

  function clearAll() {
    boxes.forEach(clearError);
    summary.hidden = true;
  }

  function valueOf(box) {
    var ctl = control(box);
    var kind = box.getAttribute("data-kind");
    if (kind === "terms" || kind === "flag") return ctl.checked ? "true" : "";
    if (kind === "challenge") return token;
    if (kind === "select" || kind === "choice") return ctl.value;
    return ctl.value.trim();
  }

  // A date or time the guest began and did not finish reads as empty. Left alone, it would be dropped from what is sent without a word.
  function unfinished(box) {
    var ctl = control(box);
    return !!(ctl && ctl.validity && ctl.validity.badInput);
  }

  function problem(box) {
    var value = valueOf(box);
    var message = box.getAttribute("data-message") || "";
    if (value === "" && unfinished(box)) return box.getAttribute("data-invalid") || message;
    if (value === "") return box.hasAttribute("data-required") ? message : "";
    if (box.getAttribute("data-kind") === "email" && !EMAIL.test(value)) return message;
    return "";
  }

  function validate() {
    var found = [];
    boxes.forEach(function (box) {
      var message = problem(box);
      if (message) found.push({ box: box, message: message });
    });
    return found;
  }

  function showProblems(list) {
    list.forEach(function (item) { setError(item.box, item.message); });
    summaryText.textContent = list.length === 1 ? TEXT.oneField : list.length + TEXT.manyFields;
    summary.hidden = false;
    var first = control(list[0].box);
    if (first && first.focus) first.focus();
  }

  function showNotice(message) {
    summaryText.textContent = message;
    summary.hidden = false;
    if (summary.scrollIntoView) summary.scrollIntoView({ block: "center" });
    summary.focus();
  }

  function showServerErrors(errors) {
    var found = [];
    boxes.forEach(function (box) {
      var key = box.getAttribute("data-field");
      if (Object.prototype.hasOwnProperty.call(errors, key) && typeof errors[key] === "string" && errors[key] !== "") {
        // The field's own sentence when it has one: the server's text for it is not put on the page.
        found.push({ box: box, message: box.getAttribute("data-invalid") || errors[key] });
      }
    });
    if (found.length === 0) return false;
    showProblems(found);
    return true;
  }

  function buildBody() {
    var body = {};
    var answers = Object.create(null);
    var answered = 0;
    boxes.forEach(function (box) {
      var kind = box.getAttribute("data-kind");
      var custom = box.getAttribute("data-custom");
      var value = valueOf(box);
      if (value === "") return;
      if (custom !== null) {
        answers[custom] = value;
        answered += 1;
      } else if (kind === "name" || kind === "email" || kind === "text") {
        body[box.getAttribute("data-field")] = value;
      }
    });
    if (answered > 0) body.custom_data = answers;
    body.terms = true;
    body.consents = Array.prototype.slice
      .call(form.querySelectorAll("[data-consent]"))
      .filter(function (box) { return box.checked; })
      .map(function (box) { return box.getAttribute("data-consent"); });
    body.challenge = token;
    return body;
  }

  function setBusy(on) {
    busy = on;
    submit.disabled = on;
    if (on) submit.setAttribute("aria-busy", "true");
    else submit.removeAttribute("aria-busy");
    label.textContent = on ? TEXT.sending : sendLabel;
  }

  function resetChallenge() {
    token = "";
    if (captcha && window.turnstile && window.turnstile.reset) {
      try { window.turnstile.reset(captcha); } catch (ignored) { /* the widget is not ready */ }
    }
  }

  // The address shown is the one that was sent, not what the field holds now: the guest can edit it while the request is out.
  function succeed(email) {
    resetChallenge();
    setBusy(false);
    doneEmail.textContent = email;
    regions.forEach(function (region) { region.hidden = true; });
    done.hidden = false;
    doneTitle.focus();
  }

  function fail(status, data) {
    resetChallenge();
    setBusy(false);
    var invalid = status === 400 || status === 422;
    if (invalid && data && data.errors && typeof data.errors === "object" && showServerErrors(data.errors)) return;
    // 0 is no answer at all: the request failed or ran out of time.
    showNotice(status === 0 || status === 429 || status === 503 ? TEXT.retry : TEXT.failed);
  }

  function send(body) {
    setBusy(true);
    var aborter = typeof AbortController === "function" ? new AbortController() : null;
    var timer = aborter ? setTimeout(function () { aborter.abort(); }, TIMEOUT_MS) : null;
    fetch(form.getAttribute("action"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: aborter ? aborter.signal : undefined
    }).then(function (response) {
      return response.json().then(
        function (data) { return { status: response.status, data: data }; },
        function () { return { status: response.status, data: null }; }
      );
    }).then(function (answer) {
      if (timer) clearTimeout(timer);
      if (answer.status === 200 && answer.data && answer.data.ok === true) succeed(body.email || "");
      else fail(answer.status, answer.data);
    }, function () {
      if (timer) clearTimeout(timer);
      fail(0, null);
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) return;
    clearAll();
    var problems = validate();
    if (problems.length > 0) showProblems(problems);
    else send(buildBody());
  });

  function onEdit(event) {
    var box = event.target && event.target.closest ? event.target.closest("[data-field]") : null;
    if (box) clearError(box);
  }
  form.addEventListener("input", onEdit);
  form.addEventListener("change", onEdit);

  again.addEventListener("click", function () {
    done.hidden = true;
    regions.forEach(function (region) { region.hidden = false; });
    resetChallenge();
    var first = form.querySelector("[data-control]");
    if (first && first.focus) first.focus();
  });

  function challengeProblem() {
    if (challenge) setError(challenge, TEXT.noCheck);
  }
  window.admittoTurnstileDone = function (value) {
    token = value;
    if (challenge) clearError(challenge);
  };
  window.admittoTurnstileExpired = function () { token = ""; };
  window.admittoTurnstileError = function () { token = ""; challengeProblem(); };
  if (captcha) {
    setTimeout(function () { if (!window.turnstile && !token) challengeProblem(); }, WIDGET_WAIT_MS);
  }

  submit.disabled = false;
})();
`;

/** The `<script>` element, under the nonce of this response. */
export function renderFormScript(nonce: string): string {
  return `<script nonce="${esc(nonce)}">${REGISTRATION_FORM_SCRIPT}</script>`;
}
