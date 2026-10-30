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
 *   listbox. A pick writes the text of the suggestion into the box, and any other text stays as it was typed;
 * - runs the password screen of an event whose way in is the password (`#reg-password`). "Continue" looks only that
 *   something is typed (a space counts, nothing is trimmed), keeps it in the variable `password`, and shows what the
 *   server wrote hidden (`data-after-password`): the server judges the password once, with the form, and there is no
 *   request that only asks. The password is sent in the body of the form and goes nowhere else: not into an address,
 *   a cookie or storage, and not into the page, where only its own box holds it. The answer `403 access_denied` turns
 *   the guest back to the screen, with the sentence under the field and the focus in it, and the form keeps what was
 *   typed in it. The security check starts again after this answer, as it does after every other.
 *
 * - gives the guest's companion (D-E5) a part of the form of its own, when the event takes one. The box
 *   `data-companion-toggle` ("I am bringing a guest") opens the panel `data-companion-panel`. While it is not ticked, every
 *   field in the panel is hidden, disabled and not required, so it is neither checked nor sent. The questions of the panel
 *   are kept apart from the guest's own (`askedCompanion`), and a condition refers only to the questions of its own panel.
 *   What is sent is `companions: [{ name, answers }]`, read from the fields of the panel. The companion is kept nowhere else.
 *
 * Nothing the guest typed is put in an address, and the page has no cookie.
 *
 * An event that switched the styled boxes on (D-E9) gets a second script after this one (./form-controls-script.ts). This one does
 * not know it and is the same text with or without it: the two meet only in the page, where the second leaves the answer of a
 * styled box in a hidden `data-control` that this one reads like any other.
 */

import { esc } from "../ticket-page.js";
import { REGISTRATION_STYLED_CONTROLS_SCRIPT } from "./form-controls-script.js";

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
  var toggle = form.querySelector("[data-companion-toggle]");
  var companionPanel = form.querySelector("[data-companion-panel]");
  var asked = Object.create(null);
  var askedCompanion = Object.create(null);

  // Whether a field is in the panel of the guest's companion, and whether the guest brings one.
  function inCompanion(box) {
    return companionPanel !== null && companionPanel.contains(box);
  }

  function companionOn() {
    return toggle !== null && toggle.checked;
  }

  boxes.forEach(function (box) {
    var key = box.getAttribute("data-custom");
    if (key !== null) (inCompanion(box) ? askedCompanion : asked)[key] = box;
  });
  var challenge = form.querySelector('[data-kind="challenge"]');
  var captcha = form.querySelector(".cf-turnstile");
  var gate = document.getElementById("reg-password");
  var gateBox = gate ? gate.querySelector("[data-password-field]") : null;
  var gateInput = gate ? document.getElementById("f-password") : null;
  var gateGo = gate ? document.getElementById("reg-password-continue") : null;
  var behindGate = Array.prototype.slice.call(document.querySelectorAll("[data-after-password]"));
  var password = null;
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
    manyFields: " fields need your attention. They are marked in red.",
    noPassword: "Enter the event password.",
    badPassword: "That password did not work. Check it and try again."
  };
  var token = "";
  var busy = false;
  var pickers = [];

  function control(box) {
    return box.querySelector("[data-control]");
  }

  function setError(box, message) {
    var ctl = control(box);
    var text = box.querySelector("[data-msg-text]");
    box.classList.add("has-error");
    if (text) text.textContent = message;
    // The button of a choice has no aria-invalid (a button has no such state); the message it is described by says it.
    var picker = box.querySelector("[data-picker-trigger]");
    if (picker) picker.classList.add("searchable-select__trigger--invalid");
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
    var picker = box.querySelector("[data-picker-trigger]");
    if (picker) picker.classList.remove("searchable-select__trigger--invalid");
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
  // A field of the companion's panel is asked only while the guest brings a companion, and its condition names a question
  // of that panel.
  function isShown(box) {
    var inside = inCompanion(box);
    if (inside && !companionOn()) return false;
    var field = box.getAttribute("data-show-when-field");
    if (field === null) return true;
    var source = (inside ? askedCompanion : asked)[field];
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
    var picker = box.querySelector("[data-picker-trigger]");
    if (picker) picker.disabled = !on;
    if (!on) {
      clearError(box);
      pickers.forEach(function (item) { if (item.box === box) item.close(false); });
    }
  }

  // The notice at the top counts the marked fields. A question that goes away with its mark is not one any more: the
  // count drops, and the notice goes with the last mark.
  function recount() {
    var marked = boxes.filter(function (box) { return box.classList.contains("has-error"); }).length;
    if (marked === 0) summary.hidden = true;
    else summaryText.textContent = marked === 1 ? TEXT.oneField : marked + TEXT.manyFields;
  }

  // Shows and hides the questions that wait for a condition and the fields of the companion's panel, and the panel of the
  // companion while the guest brings one, and the panels that hold the questions under a condition while any is asked.
  function sync() {
    var unmarked = false;
    boxes.forEach(function (box) {
      if (!box.hasAttribute("data-show-when-field") && !inCompanion(box)) return;
      var on = isShown(box);
      if (box.hidden !== on) return;
      if (!on && box.classList.contains("has-error")) unmarked = true;
      setShown(box, on);
    });
    if (companionPanel) companionPanel.hidden = !companionOn();
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
    var first = list[0].box.querySelector("[data-picker-trigger]") || control(list[0].box);
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
    var companionName = "";
    var companionAnswers = Object.create(null);
    var companionAnswered = 0;
    boxes.forEach(function (box) {
      var kind = box.getAttribute("data-kind");
      var custom = box.getAttribute("data-custom");
      if (!isShown(box)) return;
      var value = valueOf(box);
      if (value === "") return;
      if (inCompanion(box)) {
        if (custom !== null) {
          companionAnswers[custom] = value;
          companionAnswered += 1;
        } else if (kind === "name") {
          companionName = value;
        }
      } else if (custom !== null) {
        answers[custom] = value;
        answered += 1;
      } else if (kind === "name" || kind === "email" || kind === "text") {
        body[box.getAttribute("data-field")] = value;
      }
    });
    if (answered > 0) body.custom_data = answers;
    if (companionOn()) {
      var companion = { name: companionName };
      if (companionAnswered > 0) companion.answers = companionAnswers;
      body.companions = [companion];
    }
    body.terms = true;
    body.consents = Array.prototype.slice
      .call(form.querySelectorAll("[data-consent]"))
      .filter(function (box) { return box.checked; })
      .map(function (box) { return box.getAttribute("data-consent"); });
    body.challenge = token;
    if (password !== null) body.password = password;
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

  // Shows the password screen and hides what is behind it, or the other way round.
  function showGate(on) {
    gate.hidden = !on;
    behindGate.forEach(function (part) { part.hidden = on; });
  }

  // "Continue": only that something is typed. A space is a character of a password, so nothing is trimmed.
  function goOn() {
    if (gateInput.value === "") {
      setError(gateBox, TEXT.noPassword);
      gateInput.focus();
      return;
    }
    clearError(gateBox);
    password = gateInput.value;
    showGate(false);
    var first = form.querySelector("[data-control]");
    if (first && first.focus) first.focus();
  }

  // The server turned the password away: back to the screen, the sentence under the field, the focus in the field. What the
  // guest typed in the form stays where it is. The box keeps the password that was tried, to be corrected.
  function turnBack() {
    password = null;
    showGate(true);
    setError(gateBox, TEXT.badPassword);
    gateInput.focus();
  }

  function fail(status, data) {
    resetChallenge();
    setBusy(false);
    if (status === 403 && gate && data && data.error === "access_denied") {
      turnBack();
      return;
    }
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

  // A choice is the product's searchable select: a button that shows the answer and, under it, a panel of rows, with a
  // search box past six of them. The real select stays in the form, hidden. It holds the answer that the rest of this
  // script reads and that a browser restores, and the panel only writes into it and tells the form that it changed.
  function setUpPicker(wrap) {
    var select = wrap.querySelector("select");
    var trigger = wrap.querySelector("[data-picker-trigger]");
    var text = wrap.querySelector("[data-picker-text]");
    var panel = wrap.querySelector("[data-picker-panel]");
    var search = wrap.querySelector("[data-picker-search]");
    var none = wrap.querySelector("[data-picker-empty]");
    var list = panel.querySelector("ul");
    var rows = Array.prototype.slice.call(panel.querySelectorAll(".searchable-select__option"));
    var wasOpen = false;

    function nameOf(row) {
      return row.querySelector(".searchable-select__name").textContent;
    }

    // The button says what is chosen, or the empty row's words, as a placeholder, while nothing is.
    function refresh() {
      var chosen = rows[0];
      rows.forEach(function (row) {
        var on = row.getAttribute("data-value") === select.value;
        if (on) chosen = row;
        if (on && select.value !== "") row.setAttribute("aria-current", "true");
        else row.removeAttribute("aria-current");
      });
      text.textContent = nameOf(chosen);
      text.className = select.value === "" ? "searchable-select__placeholder" : "searchable-select__label";
    }

    // The rows that the search box lets through. The empty row is not an answer, so a search leaves it out.
    function filter() {
      var needle = search ? search.value.trim().toLowerCase() : "";
      var shown = 0;
      rows.forEach(function (row, index) {
        var on = index === 0 ? needle === "" : nameOf(row).toLowerCase().indexOf(needle) !== -1;
        row.parentNode.hidden = !on;
        if (on) shown += 1;
      });
      none.hidden = shown !== 0;
    }

    function visibleRows() {
      return rows.filter(function (row) { return !row.parentNode.hidden; });
    }

    function open() {
      if (trigger.disabled) return;
      if (search) search.value = "";
      filter();
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      trigger.classList.add("searchable-select__trigger--open");
      var chosen = rows.filter(function (row) { return row.getAttribute("data-value") === select.value; })[0];
      (search || chosen || rows[0]).focus();
      if (panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
      // A phone puts its keyboard over the lower half of the page while the search box has the focus: the button goes
      // to the top, once the keyboard is up, so that the rows stay in view above it.
      if (search && window.matchMedia && window.matchMedia("(pointer: coarse)").matches && trigger.scrollIntoView) {
        setTimeout(function () { if (!panel.hidden) trigger.scrollIntoView({ block: "start", behavior: "smooth" }); }, 350);
      }
    }

    function close(back) {
      if (panel.hidden) return;
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.classList.remove("searchable-select__trigger--open");
      if (back) trigger.focus();
    }

    function pick(value) {
      select.value = value;
      close(true);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function step(delta) {
      var items = search ? [search].concat(visibleRows()) : visibleRows();
      var at = items.indexOf(document.activeElement);
      var next = at === -1 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, at + delta));
      if (items[next]) items[next].focus();
    }

    // A press on the button closes the panel that the focus leaving it already closed (a browser that does not focus a
    // button when it is pressed), so what the panel was when the press began decides what the click does.
    trigger.addEventListener("mousedown", function () { wasOpen = !panel.hidden; });
    trigger.addEventListener("click", function () {
      if (wasOpen || !panel.hidden) close(false);
      else open();
      wasOpen = false;
    });
    if (search) search.addEventListener("input", filter);
    // Keep the focus where it is while a row is pressed, so that the panel is still there for the click that follows.
    list.addEventListener("mousedown", function (event) { event.preventDefault(); });
    list.addEventListener("click", function (event) {
      var row = event.target && event.target.closest ? event.target.closest(".searchable-select__option") : null;
      if (row) pick(row.getAttribute("data-value"));
    });
    wrap.addEventListener("keydown", function (event) {
      if (event.isComposing) return;
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        close(true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (panel.hidden) open();
        else step(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Enter" && event.target === search) {
        // Enter in the search box picks the first row that is left, and does not send the form.
        event.preventDefault();
        if (visibleRows()[0]) pick(visibleRows()[0].getAttribute("data-value"));
      }
    });
    wrap.addEventListener("focusout", function (event) {
      if (!panel.hidden && !(event.relatedTarget && wrap.contains(event.relatedTarget))) close(false);
    });
    document.addEventListener("pointerdown", function (event) {
      if (!panel.hidden && !wrap.contains(event.target)) close(false);
    });
    select.addEventListener("change", refresh);
    pickers.push({ box: wrap.closest("[data-field]"), close: close, refresh: refresh });
  }
  Array.prototype.slice.call(form.querySelectorAll("[data-picker]")).forEach(setUpPicker);

  // The state a browser restores into the form (a reload, the way back) can leave a choice made and a condition met.
  function restore() {
    pickers.forEach(function (item) { item.refresh(); });
    sync();
  }
  restore();
  window.addEventListener("pageshow", restore);
  if (gate) {
    gateGo.addEventListener("click", goOn);
    gateInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      goOn();
    });
    gateInput.addEventListener("input", function () { clearError(gateBox); });
    gateGo.disabled = false;
  }
  submit.disabled = false;
})();
`;

/**
 * The `<script>` element, under the nonce of this response. For an event that switched the styled boxes on there is a second
 * element after it, with the script of ./form-controls-script.ts under the same nonce. Without the switch the answer is the one
 * element it always was, byte for byte.
 */
export function renderFormScript(nonce: string, styledControls = false): string {
  const first = `<script nonce="${esc(nonce)}">${REGISTRATION_FORM_SCRIPT}</script>`;
  return styledControls ? `${first}\n  <script nonce="${esc(nonce)}">${REGISTRATION_STYLED_CONTROLS_SCRIPT}</script>` : first;
}
