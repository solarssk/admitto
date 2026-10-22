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
 * - gives the Turnstile widget its three callbacks and tells the guest when the widget cannot load;
 * - asks a question only when its condition is met. A question with a condition (`data-show-when-field`, the key of
 *   the question it depends on, and `data-show-when-value`) is hidden and disabled and not required until the
 *   answer to that question is exactly that value, which is what `isQuestionShown` of `@admitto/shared` decides.
 *   The answer to a Yes/No is "true" when it is ticked or Yes, else none; a choice is the text of its option. It is
 *   not that function's code and the page has no copy of its logic: it compares two strings, and a test runs this
 *   script against `isQuestionShown` for every case. A question that is not asked is not checked and not sent, and
 *   what the guest typed in it is kept, so it is there again when the question comes back;
 * - gives a text box that has suggestions (`data-combo`) a list under it: it filters the rows the server wrote by
 *   what is typed, marks the match, and picks with the mouse, a tap or the keys. It is an ARIA combobox with a
 *   listbox. A pick writes the text of the suggestion into the box, and any other text stays as it was typed.
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
  var panels = Array.prototype.slice.call(form.querySelectorAll("[data-reveal]"));
  var asked = Object.create(null);
  boxes.forEach(function (box) {
    var key = box.getAttribute("data-custom");
    if (key !== null) asked[key] = box;
  });
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

  // Whether a question is asked now. One without a condition always is. One with a condition is when the question it
  // names, which has no condition of its own, has exactly that answer: the same rule as isQuestionShown, which reads
  // "true" for a ticked Yes/No and the text of the option for a choice, and takes no answer for a match of nothing.
  function isShown(box) {
    var field = box.getAttribute("data-show-when-field");
    if (field === null) return true;
    var source = asked[field];
    if (!source || source.hasAttribute("data-show-when-field")) return false;
    return valueOf(source) === box.getAttribute("data-show-when-value");
  }

  // A question that is not asked is hidden, and its control is disabled and not required, so that no browser rule or
  // autofill touches it. What the guest typed stays in the control.
  function setShown(box, on) {
    var ctl = control(box);
    box.hidden = !on;
    if (ctl) {
      ctl.disabled = !on;
      if (box.hasAttribute("data-required")) ctl.required = on;
    }
    if (!on) clearError(box);
  }

  // The notice at the top counts the marked fields. A question that goes away with its mark is not one any more: the
  // count drops, and the notice goes with the last mark.
  function recount() {
    var marked = boxes.filter(function (box) { return box.classList.contains("has-error"); }).length;
    if (marked === 0) summary.hidden = true;
    else summaryText.textContent = marked === 1 ? TEXT.oneField : marked + TEXT.manyFields;
  }

  // Shows and hides the questions that wait for a condition, and the panel that holds them while any is asked.
  function sync() {
    var unmarked = false;
    boxes.forEach(function (box) {
      if (!box.hasAttribute("data-show-when-field")) return;
      var on = isShown(box);
      if (box.hidden !== on) return;
      if (!on && box.classList.contains("has-error")) unmarked = true;
      setShown(box, on);
    });
    panels.forEach(function (panel) {
      panel.hidden = panel.querySelector("[data-show-when-field]:not([hidden])") === null;
    });
    if (unmarked) recount();
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
      var message = isShown(box) ? problem(box) : "";
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
      if (isShown(box) && Object.prototype.hasOwnProperty.call(errors, key) && typeof errors[key] === "string" && errors[key] !== "") {
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
      if (!isShown(box)) return;
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
    sync();
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

  // A text box with suggestions: an ARIA combobox whose popup is a listbox of rows the server wrote. Each row holds its
  // suggestion in data-value; the box keeps any text, and a pick only writes the suggestion's text into it.
  function setUpCombo(wrap) {
    var input = wrap.querySelector("input");
    var panel = wrap.querySelector("[data-combo-panel]");
    var list = wrap.querySelector('[role="listbox"]');
    var none = wrap.querySelector("[data-combo-empty]");
    var custom = wrap.querySelector("[data-combo-custom]");
    var box = wrap.closest("[data-field]");
    var suggestions = Array.prototype.slice.call(list.querySelectorAll('[role="option"]:not([data-combo-custom])'));
    var rows = [];
    var active = -1;

    function setActive(index) {
      active = index;
      rows.forEach(function (row, n) { row.setAttribute("aria-selected", n === index ? "true" : "false"); });
      if (index < 0) {
        input.removeAttribute("aria-activedescendant");
        return;
      }
      input.setAttribute("aria-activedescendant", rows[index].id);
      if (rows[index].scrollIntoView) rows[index].scrollIntoView({ block: "nearest" });
    }

    function close() {
      panel.hidden = true;
      input.setAttribute("aria-expanded", "false");
      setActive(-1);
    }

    function pick(value) {
      input.value = value;
      clearError(box);
      close();
    }

    // The text of a row with the part that matches in bold. The offsets are for the lower-case text, so a letter
    // whose lower case has another length (some capitals of other alphabets) turns the marking off for that row.
    function mark(row, text, at, length) {
      var name = row.querySelector(".searchable-select__name");
      name.textContent = "";
      if (at < 0) {
        name.textContent = text;
        return;
      }
      var strong = document.createElement("strong");
      strong.textContent = text.slice(at, at + length);
      name.appendChild(document.createTextNode(text.slice(0, at)));
      name.appendChild(strong);
      name.appendChild(document.createTextNode(text.slice(at + length)));
    }

    function render() {
      var typed = input.value.trim();
      var needle = typed.toLowerCase();
      var exact = false;
      rows = [];
      suggestions.forEach(function (row) {
        var text = row.getAttribute("data-value");
        var lower = text.toLowerCase();
        var at = needle === "" ? 0 : lower.indexOf(needle);
        row.hidden = at === -1;
        if (at === -1) return;
        if (lower === needle) exact = true;
        mark(row, text, needle === "" || lower.length !== text.length ? -1 : at, needle.length);
        rows.push(row);
      });
      var offer = typed !== "" && !exact;
      none.hidden = !(typed !== "" && rows.length === 0);
      custom.hidden = !offer;
      if (offer) {
        custom.setAttribute("data-value", typed);
        custom.querySelector(".searchable-select__name").textContent = "Use “" + typed + "” as written";
        rows.push(custom);
      }
      panel.hidden = rows.length === 0;
      input.setAttribute("aria-expanded", String(rows.length > 0));
      setActive(-1);
    }

    function move(key) {
      if (panel.hidden) render();
      if (rows.length === 0) return;
      var last = rows.length - 1;
      var next = active + 1;
      if (key === "ArrowUp") next = active < 0 ? last : active - 1;
      setActive(Math.max(0, Math.min(last, next)));
    }

    input.addEventListener("focus", render);
    input.addEventListener("click", function () { if (panel.hidden) render(); });
    input.addEventListener("input", render);
    input.addEventListener("blur", close);
    input.addEventListener("keydown", function (event) {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key);
      } else if (event.key === "Enter" && !panel.hidden && active >= 0) {
        event.preventDefault();
        pick(rows[active].getAttribute("data-value"));
      } else if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        close();
      }
    });
    // Keep the focus in the box while a row is pressed, so the list is still there for the click that follows.
    list.addEventListener("mousedown", function (event) { event.preventDefault(); });
    list.addEventListener("click", function (event) {
      var row = event.target && event.target.closest ? event.target.closest('[role="option"]') : null;
      if (row && !row.hidden) pick(row.getAttribute("data-value"));
    });
  }
  Array.prototype.slice.call(form.querySelectorAll("[data-combo]")).forEach(setUpCombo);

  // The state a browser restores into the form (a reload, the way back) can leave a condition met.
  sync();
  window.addEventListener("pageshow", sync);
  submit.disabled = false;
})();
`;

/** The `<script>` element, under the nonce of this response. */
export function renderFormScript(nonce: string): string {
  return `<script nonce="${esc(nonce)}">${REGISTRATION_FORM_SCRIPT}</script>`;
}
