/**
 * The second script of the registration page: the styled boxes of an event that switched them on (D-E9).
 *
 * Like the first script (./form-script.ts) it is a fixed text, the same for every event and every request: nothing from the
 * database is put into it, what it reads is `data-*` attributes and text the server wrote, and everything it draws is set as text
 * or as an attribute, never as HTML. It runs under the same nonce, and the page's policy is the one it was: no new source, no
 * inline style, no `eval`. Only a page of an event with the switch on carries it. The first script runs first and is not changed
 * by this one: the two meet only in the page.
 *
 * What it does, for a field marked `data-styled="phone"` (./form-controls.ts says which questions are):
 * - puts the product's country button before the number box, with a list under it that has a search box. The list is an ARIA
 *   combobox with a listbox, as the list of suggestions of a text box is (`data-combo` of the first script): the search box
 *   holds the focus and names the row that is active with `aria-activedescendant`. A pick writes the code, and the focus returns
 *   to the button. Arrows move the row, Home and End go to the first and the last while the search box is empty, typing filters
 *   by the name of the country and by its code, Enter picks the active row (the first one when none is), Escape closes the list
 *   and a press outside it, or Tab, closes it too. A letter typed on the button opens the list with that letter in the search box,
 *   and an arrow on the button of a list that is open goes into it;
 * - sends the number as the staff app composes it: the code and the digits of the number (`+48500100200`), or the number as it
 *   was typed while no code is picked. A number typed or pasted with a `+` and a code the list knows sets the button, so the
 *   code is never in the answer twice. The box takes what a phone number is written with (digits, spaces, dashes, dots, brackets
 *   and one leading +). The three small rules are those of `composePhoneE164`, `splitPhoneForPicker` and `sanitizeContactPhoneInput`
 *   of `@admitto/shared`, and a test runs this script against them for a table of numbers;
 * - leaves the contract alone: the body, the answers and the sentence of a refused answer (`data-invalid`) are the first script's.
 *
 * How it meets the first script. A phone box follows the pattern of a choice there: the real control stays in the form as the
 * carrier of the answer, and a stand-in is what the guest uses. Here the carrier is a hidden input that this script adds as the
 * first `data-control` of the field, and it always holds the answer as it is sent. The stand-in is the browser's own number box,
 * which keeps its id, its label, its note and its place, and carries `data-picker-trigger`, the hook that the first script already
 * marks, disables and focuses for a choice (the first problem of the form gets the focus there, not in the hidden carrier). What
 * the first script sets on the carrier and the stand-in cannot get by that hook (the `required` of a question that waits for a
 * condition, and the `aria-invalid` of an error) is copied across by an observer.
 *
 * The list of countries is the hidden list of data rows `#reg-phone-countries` (name, ISO code and dial code, the same list as
 * the staff app). The rows of the list are built from it the first time it opens. If the page lacks any of what the script needs,
 * it does nothing, and the browser's own box stays what it is.
 *
 * The window that the country list opens in (`setUpWindow`) is small and shared on purpose: it opens and closes under a button, sets
 * `aria-expanded`, closes on a press outside, on Escape and when the focus leaves, and gives the focus back. The date and time
 * boxes that follow use it as the phone does.
 */

/** The script, without its `<script>` tag. */
export const REGISTRATION_STYLED_CONTROLS_SCRIPT = String.raw`
(function () {
  "use strict";
  var form = document.getElementById("reg-form");
  if (!form) return;

  // A window under a button: the list of countries of the phone box, and the calendar and the list of times to come. The
  // button is the trigger, the panel is what opens, and the scope holds both and nothing else that takes the focus. What
  // the panel does when it opens is up to the box (hooks.opened); a box with a search box says so (hooks.keyboard), so that
  // a phone, which puts its keyboard over the lower half of the page, brings the button to the top once the keyboard is up.
  function setUpWindow(scope, trigger, panel, hooks) {
    var pressedOpen = false;

    function isOpen() {
      return !panel.hidden;
    }

    function open() {
      if (trigger.disabled || isOpen()) return;
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      trigger.classList.add("searchable-select__trigger--open");
      if (hooks.opened) hooks.opened();
      if (panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
      if (hooks.keyboard && window.matchMedia && window.matchMedia("(pointer: coarse)").matches && trigger.scrollIntoView) {
        setTimeout(function () { if (isOpen()) trigger.scrollIntoView({ block: "start", behavior: "smooth" }); }, 350);
      }
    }

    function close(back) {
      if (!isOpen()) return;
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.classList.remove("searchable-select__trigger--open");
      if (hooks.closed) hooks.closed();
      if (back) trigger.focus();
    }

    // A press on the button closes the panel that the focus leaving it already closed (a browser that does not focus a
    // button when it is pressed), so what the panel was when the press began decides what the click does.
    trigger.addEventListener("mousedown", function () { pressedOpen = isOpen(); });
    trigger.addEventListener("click", function () {
      if (pressedOpen || isOpen()) close(false);
      else open();
      pressedOpen = false;
    });
    scope.addEventListener("keydown", function (event) {
      if (event.isComposing) return;
      if (event.key === "Escape" && isOpen()) {
        event.preventDefault();
        close(true);
      }
    });
    scope.addEventListener("focusout", function (event) {
      if (isOpen() && !(event.relatedTarget && scope.contains(event.relatedTarget))) close(false);
    });
    document.addEventListener("pointerdown", function (event) {
      if (isOpen() && !scope.contains(event.target)) close(false);
    });
    return { open: open, close: close, isOpen: isOpen };
  }

  // The countries, from the data rows the server wrote. A flag is the two regional-indicator letters of the ISO code, which
  // is how the staff app's list gets it too. The first country of a dial code stands for the code (several share one).
  function readCountries(data) {
    var list = Array.prototype.slice.call(data.children).map(function (item) {
      var iso = item.getAttribute("data-iso") || "";
      return {
        iso: iso,
        name: item.textContent || "",
        dial: item.getAttribute("data-dial") || "",
        flag: iso.length === 2 ? String.fromCodePoint(127397 + iso.charCodeAt(0), 127397 + iso.charCodeAt(1)) : ""
      };
    });
    var byIso = Object.create(null);
    var byDial = Object.create(null);
    list.forEach(function (country) {
      byIso[country.iso] = country;
      if (!(country.dial in byDial)) byDial[country.dial] = country;
    });
    // The longest code first, so that +1242 is not read as +1 and a rest.
    var codes = Object.keys(byDial).sort(function (a, b) { return b.length - a.length; });
    return { list: list, byIso: byIso, byDial: byDial, codes: codes };
  }

  // The rules of sanitizeContactPhoneInput, splitPhoneForPicker and composePhoneE164 of @admitto/shared.
  function clean(value, allowPlus) {
    var cleaned = value.replace(/\s/g, " ").replace(/[^\d ().+-]/g, "");
    var bare = cleaned.replace(/\+/g, "");
    return allowPlus && cleaned.replace(/^\s+/, "").charAt(0) === "+" ? "+" + bare : bare;
  }

  function split(countries, text) {
    var value = text.trim();
    for (var i = 0; i < countries.codes.length; i += 1) {
      var code = countries.codes[i];
      if (value.indexOf(code) === 0) return { dial: code, national: value.slice(code.length).trim() };
    }
    return { dial: "", national: value };
  }

  function compose(dial, national) {
    var number = national.trim();
    if (!dial) return number;
    return number ? dial + number.replace(/\D/g, "") : "";
  }

  // The name of a country matches what is typed anywhere in it; its code matches from the start (the + is optional).
  function matches(country, needle) {
    if (country.name.toLowerCase().indexOf(needle) !== -1) return true;
    return country.dial.slice(1).indexOf(needle.replace(/^\+/, "")) === 0;
  }

  // The words of the field's label, without the mark of a required field, which is not part of its name.
  function labelOf(box) {
    var label = box.querySelector("label");
    var words = "";
    if (label) {
      Array.prototype.slice.call(label.childNodes).forEach(function (node) {
        if (node.nodeType === 3) words += node.textContent;
      });
    }
    return words.trim() || "Phone number";
  }

  function setUpPhone(box, kit, countries) {
    var field = box.querySelector("[data-control]");
    var wrap = field ? field.parentNode : null;
    var host = wrap ? wrap.parentNode : null;
    var template = kit.content.firstElementChild;
    if (!field || !host || !template) return;

    var part = template.cloneNode(true);
    var trigger = part.querySelector("[data-phone-trigger]");
    var flagText = part.querySelector("[data-phone-flag]");
    var dialText = part.querySelector("[data-phone-dial]");
    var panel = part.querySelector("[data-phone-panel]");
    var search = part.querySelector("[data-phone-search]");
    var list = part.querySelector("[data-phone-list]");
    var none = part.querySelector("[data-phone-empty]");
    var carrier = document.createElement("input");
    var name = labelOf(box);
    var base = field.id;
    var dial = "";
    var chosen = null;
    var built = [];
    var shown = [];
    var active = -1;
    var current = null;
    var popup;

    // The answer as it is sent: the code and the digits, or the number as typed while there is no code. The first script
    // reads it from the carrier, the first data-control of the field.
    function show() {
      flagText.textContent = chosen ? chosen.flag : "";
      dialText.textContent = dial === "" ? "No code" : dial;
      dialText.classList.toggle("reg-phone__dial--empty", dial === "");
      trigger.setAttribute("aria-label", name + " country code, " + (chosen ? chosen.name + " " + dial : "no code selected"));
      carrier.value = compose(dial, field.value);
    }

    function setCode(country) {
      chosen = country;
      dial = country ? country.dial : "";
    }

    // A number typed or pasted with a + and a code of the list sets the button, and the rest stays in the box.
    function onType() {
      var text = clean(field.value, true);
      var next = text.charAt(0) === "+" ? split(countries, text) : { dial: dial, national: text };
      if (next.dial !== dial) setCode(next.dial === "" ? null : countries.byDial[next.dial]);
      if (field.value !== next.national) field.value = next.national;
      show();
    }

    function pick(country) {
      setCode(country);
      var text = clean(field.value, false);
      if (field.value !== text) field.value = text;
      show();
      popup.close(true);
      // Choosing a code is an edit of the field: the form clears its error and asks its conditions again.
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function countryOf(row) {
      return countries.byIso[row.getAttribute("data-iso")];
    }

    // The row that shows which country is picked (aria-current), and the row that is active (aria-selected, and named by
    // aria-activedescendant of the search box).
    function mark() {
      built.forEach(function (item) {
        if (chosen && item.country === chosen) item.row.setAttribute("aria-current", "true");
        else item.row.removeAttribute("aria-current");
      });
    }

    function setActive(index) {
      if (current) current.setAttribute("aria-selected", "false");
      active = index;
      current = index >= 0 ? shown[index] : null;
      if (!current) {
        search.removeAttribute("aria-activedescendant");
        return;
      }
      current.setAttribute("aria-selected", "true");
      search.setAttribute("aria-activedescendant", current.id);
      if (current.scrollIntoView) current.scrollIntoView({ block: "nearest" });
    }

    // What is typed in the search box narrows the list. While something is typed the first row is the active one, so that
    // Enter has a row to take; with nothing typed the active row is the one picked, if there is one.
    function filter() {
      var needle = search.value.trim().toLowerCase();
      shown = [];
      built.forEach(function (item) {
        var on = needle === "" || matches(item.country, needle);
        item.row.hidden = !on;
        if (on) shown.push(item.row);
      });
      none.hidden = shown.length !== 0;
      var picked = shown.filter(function (row) { return row.getAttribute("aria-current") === "true"; })[0];
      setActive(needle !== "" ? (shown.length > 0 ? 0 : -1) : (picked ? shown.indexOf(picked) : -1));
    }

    function build() {
      if (built.length > 0) return;
      var rows = document.createDocumentFragment();
      countries.list.forEach(function (country) {
        var row = document.createElement("li");
        var flag = document.createElement("span");
        var label = document.createElement("span");
        var code = document.createElement("span");
        row.className = "searchable-select__option reg-phone__option";
        row.id = base + "-opt-" + country.iso;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", "false");
        row.setAttribute("data-iso", country.iso);
        flag.className = "reg-phone__flag";
        flag.setAttribute("aria-hidden", "true");
        flag.textContent = country.flag;
        label.className = "searchable-select__name";
        label.textContent = country.name;
        code.className = "reg-phone__option-code";
        code.textContent = country.dial;
        row.appendChild(flag);
        row.appendChild(label);
        row.appendChild(code);
        rows.appendChild(row);
        built.push({ country: country, row: row });
      });
      list.insertBefore(rows, none);
    }

    function move(key) {
      if (shown.length === 0) return;
      var last = shown.length - 1;
      var next = key === "ArrowUp" ? (active < 0 ? last : active - 1) : active + 1;
      setActive(Math.max(0, Math.min(last, next)));
    }

    function onSearchKey(event) {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key);
      } else if ((event.key === "Home" || event.key === "End") && search.value === "") {
        // With text in the box these keys move the cursor in it, as in any text box.
        event.preventDefault();
        if (shown.length > 0) setActive(event.key === "Home" ? 0 : shown.length - 1);
      } else if (event.key === "Enter") {
        // Enter picks a row, and does not send the form.
        event.preventDefault();
        var row = shown[active >= 0 ? active : 0];
        if (row) pick(countryOf(row));
      }
    }

    function onTriggerKey(event) {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // On the button of a list that is open (the focus came back with Shift+Tab), an arrow goes into the list.
        event.preventDefault();
        if (popup.isOpen()) search.focus();
        else popup.open();
      } else if (!popup.isOpen() && event.key.length === 1 && event.key !== " ") {
        // A letter typed on the button opens the list with that letter already in the search box.
        event.preventDefault();
        popup.open();
        search.value = event.key;
        filter();
      }
    }

    // The ids of the parts come from the id of the field, which is its position (f-q3), never from text.
    trigger.id = base + "-country";
    panel.id = base + "-panel";
    list.id = base + "-list";
    search.id = base + "-search";
    trigger.setAttribute("aria-controls", panel.id);
    search.setAttribute("aria-controls", list.id);
    popup = setUpWindow(part, trigger, panel, {
      keyboard: true,
      opened: function () {
        build();
        search.value = "";
        mark();
        filter();
        search.focus();
      }
    });
    search.addEventListener("input", filter);
    search.addEventListener("keydown", onSearchKey);
    trigger.addEventListener("keydown", onTriggerKey);
    // Keep the focus in the search box while a row, or the edge of the panel, is pressed: the focus leaving the panel closes
    // it, and the click on a row has to find the list still there.
    panel.addEventListener("mousedown", function (event) { if (event.target !== search) event.preventDefault(); });
    list.addEventListener("click", function (event) {
      var row = event.target && event.target.closest ? event.target.closest('[role="option"]') : null;
      if (row && !row.hidden) pick(countryOf(row));
    });

    // The carrier is the field's first data-control; the stand-in is the number box it was, which the first script now marks
    // and focuses as it does the button of a choice.
    carrier.type = "hidden";
    carrier.setAttribute("data-control", "");
    carrier.disabled = field.disabled;
    carrier.required = field.required;
    var line = document.createElement("div");
    line.className = "reg-phone";
    host.insertBefore(line, wrap);
    host.insertBefore(carrier, line);
    line.appendChild(part);
    line.appendChild(wrap);
    field.removeAttribute("data-control");
    field.setAttribute("data-picker-trigger", "");
    field.setAttribute("inputmode", "tel");
    field.addEventListener("input", onType);
    field.addEventListener("change", onType);

    // What the first script sets on the carrier, and the stand-in and the button cannot get by the hook: the question that
    // waits for a condition is required and not disabled once it is asked, and an error is announced by aria-invalid.
    function mirror() {
      var invalid = carrier.getAttribute("aria-invalid") === "true";
      if (invalid) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
      field.classList.toggle("at-input--invalid", invalid);
      field.required = carrier.required;
      field.disabled = carrier.disabled;
      trigger.disabled = carrier.disabled;
      if (carrier.disabled) popup.close(false);
    }
    if (typeof MutationObserver === "function") {
      new MutationObserver(mirror).observe(carrier, { attributes: true, attributeFilter: ["aria-invalid", "required", "disabled"] });
    }
    // A number the browser filled in before the script ran sets the button, as one typed does.
    onType();
    mirror();
  }

  var kit = document.getElementById("reg-phone-kit");
  var data = document.getElementById("reg-phone-countries");
  var phones = Array.prototype.slice.call(form.querySelectorAll('[data-styled="phone"]'));
  if (kit && kit.content && data && phones.length > 0) {
    var countries = readCountries(data);
    phones.forEach(function (box) { setUpPhone(box, kit, countries); });
  }
})();
`;
