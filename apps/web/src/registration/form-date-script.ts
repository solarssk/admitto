/**
 * The date box of the registration page's second script (./form-controls-script.ts), and the field that holds a date or a date and
 * time. Like the rest of that script it is a fixed text: nothing from the database is put into it, it reads the `data-*` attributes
 * and the templates the server wrote (./form-controls.ts), and everything it draws is set as text or as an attribute, never as HTML.
 *
 * What the date box is. The browser's own date box of a question stays in the form with its id, its label, its note and its message
 * (the page's, not this script's), and the script turns it into a text box: the date in a readable form (`04/11/2026`, in the order
 * the guest's browser writes it), a button with a calendar beside it, and under it, in the flow of the form, a month to pick from.
 * The month is ARIA's date picker dialog: a grid of days whose cells carry the full date as their name, `aria-selected`, roving
 * focus and the keys of that pattern (arrows move by a day and a week, Home and End go to the start and the end of the week, Page
 * Up and Page Down by a month, with Shift by a year, Enter and Space pick, Escape closes and gives the focus back to the button).
 * The title of the month is a live region, so a screen reader hears the month change. The panel is in the flow and not laid over the
 * form because the card of the page clips what sticks out of it.
 *
 * What it takes from the guest. Typing is for the formats the staff app's date box takes (`yyyy-mm-dd`, and day, month and year in
 * the order of the guest's browser, with a dot, a slash, a dash or a space between): the one rule of `parseFlexibleCalendarDate`,
 * ported, and a test runs this script against `isDateAnswer` of `@admitto/shared` for a table of texts. A text that is no date is
 * a date begun and not finished, which is what the first script already asks of a native date box (`validity.badInput`).
 *
 * How the field meets the first script, as the phone box does. A hidden control that this script adds is the field's first
 * `data-control` and holds the answer exactly as it is sent (`YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm`, or nothing); the guest's boxes
 * are stand-ins. The first script marks, disables and focuses the box that carries `data-picker-trigger` (the date text box) and
 * reads the carrier; what it sets on the carrier that the stand-ins cannot get by that hook (`required`, `disabled`, `aria-invalid`)
 * is copied across by an observer. The carrier answers `validity.badInput` for the first script, which asks it whether a date or a
 * time was begun and not finished.
 *
 * Words and habits. The names of the months and days are in the language of the page (`lang`), which is how a reader hears them. The
 * order of day, month and year, the first day of the week and a 12 or 24-hour clock are the guest's own region's, as a browser's
 * date box has them. If the browser cannot do what this needs (`Intl.DateTimeFormat.formatToParts`), the script does nothing and the
 * browser's box stays.
 */

/** The start of the date and time code (an inner function, so that none of its names meets one of the phone box) with the date box. */
export const DATE_BOX_SCRIPT = String.raw`
  (function () {
    var dateKit = document.getElementById("reg-date-kit");
    if (!dateKit || !dateKit.content || typeof Intl !== "object" || typeof Intl.DateTimeFormat !== "function" ||
        typeof Intl.DateTimeFormat.prototype.formatToParts !== "function") return;
    // The time box, for a form that asks a date and time: the code that follows registers it here (see ./form-time-script.ts).
    var timeSupport = null;

    // The words are in the language of the page; the habits are the guest's. A tag with an extension keeps only its language and region.
    var pageTag = (document.documentElement.getAttribute("lang") || "en").split("-u-")[0];
    var guestTag = ((navigator.languages && navigator.languages[0]) || navigator.language || pageTag).split("-u-")[0];

    // Always the Gregorian calendar and Latin digits: the date that goes to the server is that one, and a text typed in Latin digits
    // is what the parser reads.
    function formatter(tag, options) {
      try {
        return new Intl.DateTimeFormat(tag + "-u-ca-gregory-nu-latn", options);
      } catch (ignored) {
        return new Intl.DateTimeFormat("en-u-ca-gregory-nu-latn", options);
      }
    }

    function pad(number, size) {
      var text = String(number);
      while (text.length < size) text = "0" + text;
      return text;
    }

    // A moment on the UTC calendar with the year as written (Date.UTC reads the years 0 to 99 as 1900 to 1999).
    function utc(year, month, day) {
      var moment = new Date(0);
      moment.setUTCFullYear(year, month - 1, day);
      return moment;
    }

    // The rule of isDateAnswer of @admitto/shared: a day that exists in the calendar, in a year of four digits.
    function daysIn(year, month) {
      if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
      return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
    }

    function isDay(year, month, day) {
      return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
    }

    function isoOf(year, month, day) {
      return pad(year, 4) + "-" + pad(month, 2) + "-" + pad(day, 2);
    }

    function partsOf(iso) {
      return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
    }

    function momentOf(iso) {
      var parts = partsOf(iso);
      return utc(parts.y, parts.m, parts.d);
    }

    function today() {
      var now = new Date();
      return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    }

    // Day 0 is a Sunday, as getUTCDay numbers them. A browser that cannot say gets the week of the staff app, which starts on Monday.
    function firstDayOf(tag) {
      try {
        var info = new Intl.Locale(tag);
        var week = typeof info.getWeekInfo === "function" ? info.getWeekInfo() : info.weekInfo;
        if (week && week.firstDay >= 1 && week.firstDay <= 7) return week.firstDay % 7;
      } catch (ignored) {
        // An engine without week data keeps the Monday.
      }
      return 1;
    }

    var monthTitle = formatter(pageTag, { month: "long", year: "numeric", timeZone: "UTC" });
    var dayName = formatter(pageTag, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    var weekdayShort = formatter(pageTag, { weekday: "short", timeZone: "UTC" });
    var weekdayLong = formatter(pageTag, { weekday: "long", timeZone: "UTC" });
    var first = firstDayOf(guestTag);

    // The order of the parts and the mark between them, as the guest's browser writes a numeric date. Only the order and the mark are
    // taken: the parts are written with two digits for the day and the month and four for the year, whatever the locale does.
    var order = [];
    var separator = "/";
    formatter(guestTag, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" })
      .formatToParts(utc(2023, 11, 25))
      .forEach(function (part) {
        if (part.type === "day" || part.type === "month" || part.type === "year") order.push(part.type);
        else if (order.length === 1) separator = part.value.replace(/[^./-]/g, "").charAt(0) || "/";
      });
    if (order.length !== 3) order = ["day", "month", "year"];

    function showDate(iso) {
      var parts = partsOf(iso);
      var text = { day: pad(parts.d, 2), month: pad(parts.m, 2), year: pad(parts.y, 4) };
      return order.map(function (type) { return text[type]; }).join(separator);
    }

    function datePattern() {
      var text = { day: "dd", month: "mm", year: "yyyy" };
      return order.map(function (type) { return text[type]; }).join(separator);
    }

    // With a day and a month that cannot be told apart (04/11) the order of the guest's browser says which is which.
    function dayAndMonth(a, b) {
      if (a > 31 || b > 31) return null;
      if (a > 12 && b <= 12) return { d: a, m: b };
      if (b > 12 && a <= 12) return { d: b, m: a };
      if (a > 12 && b > 12) return null;
      return order[0] === "month" ? { d: b, m: a } : { d: a, m: b };
    }

    // The rule of parseFlexibleCalendarDate of the staff app: yyyy-mm-dd, or three numbers split by dots, slashes, dashes or spaces
    // with the year as the first or the last of them. The date, as YYYY-MM-DD, or nothing when the text is no date.
    function readDate(raw) {
      var text = raw.trim();
      var year;
      var month;
      var day;
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
        var dashed = text.split("-");
        year = Number(dashed[0]);
        month = Number(dashed[1]);
        day = Number(dashed[2]);
        return isDay(year, month, day) ? isoOf(year, month, day) : "";
      }
      var chunks = text.split(/[./\s-]+/).filter(Boolean);
      if (chunks.length !== 3) return "";
      var digits = chunks.every(function (chunk) { return /^\d+$/.test(chunk); });
      if (!digits) return "";
      var numbers = chunks.map(Number);
      var at = -1;
      chunks.forEach(function (chunk, index) {
        if (at === -1 && chunk.length === 4 && numbers[index] >= 1000) at = index;
      });
      if (at === 0) {
        year = numbers[0];
        month = numbers[1];
        day = numbers[2];
      } else if (at === 2) {
        var both = dayAndMonth(numbers[0], numbers[1]);
        if (!both) return "";
        year = numbers[2];
        month = both.m;
        day = both.d;
      } else {
        return "";
      }
      return isDay(year, month, day) ? isoOf(year, month, day) : "";
    }

    // The words of the field's label, without the mark of a required field, which is not part of its name.
    function nameOf(box) {
      var label = box.querySelector("label");
      var words = "";
      if (label) {
        Array.prototype.slice.call(label.childNodes).forEach(function (node) {
          if (node.nodeType === 3) words += node.textContent;
        });
      }
      return words.trim() || "Date";
    }

    // The date box. The text box is the form's own date box (now a text box), the calendar button and the month are the kit's. The box
    // keeps the text the state was worked out from (shown) and the date that text is (iso, or nothing when it is no date), and tells
    // the field when either changes (hooks.changed). hooks.clearAll empties the whole answer, which is the date and the time of a
    // date and time.
    function makeDateBox(field, pop, base, name, hooks) {
      var trigger = pop.querySelector("[data-date-trigger]");
      var panel = pop.querySelector("[data-date-panel]");
      var monthText = pop.querySelector("[data-date-month]");
      var grid = pop.querySelector("[data-date-grid]");
      var weekdays = pop.querySelector("[data-date-weekdays]");
      var body = pop.querySelector("[data-date-rows]");
      var prev = pop.querySelector("[data-date-prev]");
      var next = pop.querySelector("[data-date-next]");
      var clear = pop.querySelector("[data-date-clear]");
      var todayButton = pop.querySelector("[data-date-today]");
      var iso = "";
      var shown = "";
      var view = { y: 1970, m: 1 };
      var cursor = 1;
      var cells = [];
      var popup;

      trigger.id = base + "-cal";
      panel.id = base + "-calpanel";
      monthText.id = base + "-month";
      trigger.setAttribute("aria-controls", panel.id);
      grid.setAttribute("aria-labelledby", monthText.id);
      panel.setAttribute("aria-label", name + ", choose date");

      // The state follows the text, unless it already does. A text that is no date leaves the date empty and the box begun.
      function follow() {
        if (field.value === shown) return;
        shown = field.value;
        var text = shown.trim();
        iso = text === "" ? "" : readDate(text);
      }

      function setDate(value) {
        iso = value;
        shown = value === "" ? "" : showDate(value);
        field.value = shown;
      }

      function relabel() {
        trigger.setAttribute("aria-label", name + (iso === "" ? ", choose date" : ", change date, " + dayName.format(momentOf(iso))));
      }

      // The names of the days and the six rows of seven cells, made once, the first time the month opens. Six rows always, so that the
      // panel does not change its height from one month to the next.
      function build() {
        if (cells.length > 0) return;
        for (var column = 0; column < 7; column += 1) {
          var head = document.createElement("th");
          var named = utc(2024, 1, 7 + ((first + column) % 7));
          head.className = "reg-date__wd";
          head.setAttribute("scope", "col");
          head.setAttribute("abbr", weekdayLong.format(named));
          head.textContent = weekdayShort.format(named);
          weekdays.appendChild(head);
        }
        for (var week = 0; week < 6; week += 1) {
          var row = document.createElement("tr");
          for (var weekday = 0; weekday < 7; weekday += 1) {
            var cell = document.createElement("td");
            cell.className = "reg-date__day";
            cell.setAttribute("role", "gridcell");
            row.appendChild(cell);
            cells.push(cell);
          }
          body.appendChild(row);
        }
      }

      function offset() {
        return (utc(view.y, view.m, 1).getUTCDay() - first + 7) % 7;
      }

      function cellOf(day) {
        return cells[offset() + day - 1];
      }

      // The month on show: the title, and for each cell the day, its name, whether it is the picked date and whether it is today. The
      // cell that has the cursor is the one in the order of the Tab key.
      function render() {
        monthText.textContent = monthTitle.format(utc(view.y, view.m, 1));
        var start = offset();
        var count = daysIn(view.y, view.m);
        var now = today();
        var current = isoOf(now.y, now.m, now.d);
        cells.forEach(function (cell, index) {
          var day = index - start + 1;
          if (day < 1 || day > count) {
            cell.textContent = "";
            cell.classList.add("reg-date__day--blank");
            cell.setAttribute("aria-hidden", "true");
            ["aria-label", "aria-selected", "aria-current", "tabindex", "data-iso"].forEach(function (attribute) { cell.removeAttribute(attribute); });
            return;
          }
          var dayIso = isoOf(view.y, view.m, day);
          cell.textContent = String(day);
          cell.classList.remove("reg-date__day--blank");
          cell.removeAttribute("aria-hidden");
          cell.setAttribute("data-iso", dayIso);
          cell.setAttribute("aria-label", dayName.format(utc(view.y, view.m, day)));
          cell.setAttribute("aria-selected", dayIso === iso ? "true" : "false");
          if (dayIso === current) cell.setAttribute("aria-current", "date");
          else cell.removeAttribute("aria-current");
          cell.setAttribute("tabindex", day === cursor ? "0" : "-1");
        });
      }

      // Shows the month of (y, m) with the cursor on day d, or the last day of that month when it is shorter. A year outside 1 to 9999 is
      // not a date, so the month stays where it is.
      function moveTo(y, m, d, focus) {
        if (y < 1 || y > 9999) return;
        view.y = y;
        view.m = m;
        cursor = Math.min(d, daysIn(y, m));
        render();
        if (focus) cellOf(cursor).focus();
      }

      function stepDays(days) {
        var moment = utc(view.y, view.m, cursor + days);
        moveTo(moment.getUTCFullYear(), moment.getUTCMonth() + 1, moment.getUTCDate(), true);
      }

      function stepMonths(months, focus) {
        var moment = utc(view.y, view.m + months, 1);
        moveTo(moment.getUTCFullYear(), moment.getUTCMonth() + 1, cursor, focus);
      }

      function column() {
        return (utc(view.y, view.m, cursor).getUTCDay() - first + 7) % 7;
      }

      function pick(value) {
        setDate(value);
        hooks.changed();
        popup.close(true);
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }

      function onCellKey(event) {
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        var key = event.key;
        if (key === "ArrowLeft") stepDays(-1);
        else if (key === "ArrowRight") stepDays(1);
        else if (key === "ArrowUp") stepDays(-7);
        else if (key === "ArrowDown") stepDays(7);
        else if (key === "Home") stepDays(-column());
        else if (key === "End") stepDays(6 - column());
        else if (key === "PageUp" || key === "PageDown") {
          var sign = key === "PageUp" ? -1 : 1;
          if (event.shiftKey) moveTo(view.y + sign, view.m, cursor, true);
          else stepMonths(sign, true);
        } else if (key === "Enter" || key === " ") {
          // The cell that has the focus is the one picked, which is the cursor's unless a press moved the focus without the cursor.
          var focused = event.target && event.target.getAttribute ? event.target.getAttribute("data-iso") : null;
          pick(focused || isoOf(view.y, view.m, cursor));
        } else return;
        event.preventDefault();
      }

      popup = setUpWindow(pop, trigger, panel, {
        opened: function () {
          build();
          var start = iso === "" ? today() : partsOf(iso);
          view.y = start.y;
          view.m = start.m;
          cursor = start.d;
          render();
          cellOf(cursor).focus();
        }
      });

      body.addEventListener("keydown", onCellKey);
      body.addEventListener("click", function (event) {
        var cell = event.target && event.target.closest ? event.target.closest("td") : null;
        var value = cell ? cell.getAttribute("data-iso") : null;
        if (value) pick(value);
      });
      prev.addEventListener("click", function () { stepMonths(-1, false); });
      next.addEventListener("click", function () { stepMonths(1, false); });
      todayButton.addEventListener("click", function () {
        var now = today();
        pick(isoOf(now.y, now.m, now.d));
      });
      clear.addEventListener("click", function () {
        hooks.clearAll();
        popup.close(true);
      });

      function onType() {
        follow();
        hooks.changed();
      }

      // On leaving the box a date that was typed in another way is written the way the box writes it.
      function onChange() {
        follow();
        if (iso !== "") {
          var written = showDate(iso);
          if (field.value !== written) {
            field.value = written;
            shown = written;
          }
        }
        hooks.changed();
      }

      field.addEventListener("input", onType);
      field.addEventListener("change", onChange);
      field.addEventListener("keydown", function (event) {
        if (event.isComposing || event.ctrlKey || event.metaKey || event.key !== "ArrowDown") return;
        event.preventDefault();
        popup.open();
      });

      return {
        input: field,
        trigger: trigger,
        popup: popup,
        clear: clear,
        value: function () { return iso; },
        typed: function () { return field.value.trim() !== ""; },
        broken: function () { return field.value.trim() !== "" && iso === ""; },
        set: setDate,
        relabel: relabel
      };
    }
`;

/**
 * The field of a date, or of a date and time (the time box is added before this, for a form that asks a date and time), and the start
 * of the code: it finds every field the server marked, and sets each up. It closes the function that DATE_BOX_SCRIPT opened.
 */
export const DATE_FIELD_SCRIPT = String.raw`
    // A date field: the carrier, the date box and, for a date and time, the time box. The answer is the date, or the date and the time
    // as YYYY-MM-DDTHH:mm; a date without a time, a time without a date and a text that is neither are a box begun and not finished.
    function setUpField(box, withTime) {
      var field = box.querySelector("[data-control]");
      var wrap = field ? field.parentNode : null;
      var host = wrap ? wrap.parentNode : null;
      var dateRoot = dateKit.content.firstElementChild;
      var timeRoot = withTime && timeSupport && timeSupport.kit && timeSupport.kit.content ? timeSupport.kit.content.firstElementChild : null;
      if (!field || !host || !dateRoot || (withTime && !timeRoot)) return;

      var base = field.id;
      var name = nameOf(box);
      var initial = field.value;
      var cut = initial.indexOf("T");
      var carrier = document.createElement("input");
      var line = document.createElement("div");
      var unfinished = false;
      var datePart = dateRoot.cloneNode(true);
      var timePart = timeRoot ? timeRoot.cloneNode(true) : null;
      var date;
      var time = null;

      function refresh() {
        var day = date.value();
        var clock = time ? time.value() : "";
        if (time) {
          unfinished = date.broken() || time.broken() || (day === "") !== (clock === "");
          carrier.value = day !== "" && clock !== "" ? day + "T" + clock : "";
        } else {
          unfinished = date.broken();
          carrier.value = day;
        }
        date.relabel();
        if (time) time.relabel();
      }

      function clearAll() {
        date.set("");
        if (time) time.set("");
        refresh();
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }

      date = makeDateBox(field, datePart, base, name, { changed: refresh, clearAll: clearAll });
      if (timePart) time = timeSupport.make(timePart, base, name, { changed: refresh });
      datePart.querySelector("[data-date-clear]").hidden = box.hasAttribute("data-required");

      // The carrier is the field's first data-control, which the first script reads; the text boxes are the stand-ins, and the date
      // text box carries the hook that the first script marks, disables and focuses.
      carrier.type = "hidden";
      carrier.setAttribute("data-control", "");
      carrier.disabled = field.disabled;
      carrier.required = field.required;
      Object.defineProperty(carrier, "validity", { configurable: true, get: function () { return { badInput: unfinished }; } });

      line.className = time ? "reg-dt reg-dt--pair" : "reg-dt";
      host.insertBefore(line, wrap);
      host.insertBefore(carrier, line);
      line.appendChild(wrap);
      line.appendChild(datePart);
      if (timePart) line.appendChild(timePart);
      field.removeAttribute("data-control");
      field.setAttribute("data-picker-trigger", "");
      field.type = "text";
      field.setAttribute("autocapitalize", "none");
      field.setAttribute("spellcheck", "false");
      field.placeholder = datePattern();
      if (time) {
        field.setAttribute("aria-label", name + ", date");
        time.input.setAttribute("aria-label", name + ", time");
        if (field.getAttribute("aria-describedby")) time.input.setAttribute("aria-describedby", field.getAttribute("aria-describedby"));
      }

      // A value the browser filled in before the script ran is read as a typed one is.
      date.set(readDate(cut === -1 ? initial : initial.slice(0, cut)));
      if (time) time.set(cut === -1 ? "" : timeSupport.read(initial.slice(cut + 1)));
      refresh();

      var inputs = time ? [field, time.input] : [field];
      var triggers = time ? [date.trigger, time.trigger] : [date.trigger];
      // What the first script sets on the carrier, and the stand-ins cannot get by the hook: the question that waits for a condition is
      // required and not disabled once it is asked, and an error is announced by aria-invalid.
      function mirror() {
        var invalid = carrier.getAttribute("aria-invalid") === "true";
        inputs.forEach(function (input) {
          if (invalid) input.setAttribute("aria-invalid", "true");
          else input.removeAttribute("aria-invalid");
          input.classList.toggle("at-input--invalid", invalid);
          input.required = carrier.required;
          input.disabled = carrier.disabled;
        });
        triggers.forEach(function (trigger) { trigger.disabled = carrier.disabled; });
        if (carrier.disabled) {
          date.popup.close(false);
          if (time) time.popup.close(false);
        }
      }
      if (typeof MutationObserver === "function") {
        new MutationObserver(mirror).observe(carrier, { attributes: true, attributeFilter: ["aria-invalid", "required", "disabled"] });
      }
      mirror();
    }

    Array.prototype.slice.call(form.querySelectorAll('[data-styled="date"]')).forEach(function (box) { setUpField(box, false); });
    if (timeSupport) {
      Array.prototype.slice.call(form.querySelectorAll('[data-styled="datetime"]')).forEach(function (box) { setUpField(box, true); });
    }
  })();
`;
