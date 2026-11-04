/**
 * The time box of a date and time, in the registration page's second script (./form-controls-script.ts). It is added to that script
 * only for a form that asks a date and time, in the middle of the code of the date box (./form-date-script.ts), whose helpers it uses.
 * Like the rest of the script it is a fixed text, and everything it draws is set as text or as an attribute.
 *
 * What it is. Beside the date box of a date and time (the browser's own box, turned into a text box) the script puts a second text box
 * for the time of day and a clock button. The text takes what the staff app's time box takes (`18`, `1800`, `18:00`, `6pm`, `6:30 PM`,
 * `630p.m.`): the rule of its `parseFlexibleTime`, ported, and a test runs this script against a table of texts. The list that the clock
 * opens is the staff app's too: a column of hours, a column of minutes and, for a 12-hour clock, a column of AM and PM; the same range
 * (hours 0 to 23, minutes 0 to 59) and the same step (one minute). Nothing of a time zone is here: the answer is the clock at the
 * event and the server reads it in the zone of the event, which the note under the box names.
 *
 * The keys. Each column is a listbox whose options take the focus in turn (roving tabindex). Up and Down move to the next and the
 * previous option and choose it, Home and End go to the first and the last, Left and Right go to the neighbouring column, Space chooses
 * the option that has the focus, Enter chooses it and closes the list, Escape closes it, and Tab goes on to the next column and out
 * of the list. In the text box Down opens the list. A choice in a column completes the time with the default of the part not chosen yet
 * (09 for the hour, 00 for the minute), as the staff app does, so the answer is a whole time after the first press.
 *
 * It uses the window that the country list uses (`setUpWindow` of ./form-controls-script.ts) and the text box follows the pattern of
 * the date box: the state follows the text, and a time typed in another way is written the way the box writes it on leaving it.
 */

/** The time box, inside the function that DATE_BOX_SCRIPT opened. */
export const TIME_BOX_SCRIPT = String.raw`
    // A 12-hour clock when the guest's region has one; either way the box takes both ways of writing a time.
    var twelveHour = (function () {
      var cycle = formatter(guestTag, { hour: "numeric" }).resolvedOptions().hourCycle;
      return cycle === "h11" || cycle === "h12";
    })();

    // The rule of parseFlexibleTime of the staff app, in the 24-hour form the answer is sent in: HH:mm, or nothing when the text is no
    // time. A lone digit is a time begun ("2" may be the start of "23"), unless a meridiem follows it ("6 pm").
    function readTime(raw) {
      var text = raw.trim().toLowerCase().split(".").join("");
      var match = /^(\d{1,4})(?:[: ](\d{1,2}))?\s*(am|pm)?$/.exec(text);
      if (!match) return "";
      var digits = match[1];
      var meridiem = match[3];
      if (!match[2] && !meridiem && digits.length < 2) return "";
      var hours;
      var minutes;
      if (match[2]) {
        hours = Number(digits);
        minutes = Number(match[2]);
      } else if (digits.length <= 2) {
        hours = Number(digits);
        minutes = 0;
      } else {
        hours = Number(digits.slice(0, -2));
        minutes = Number(digits.slice(-2));
      }
      if (minutes > 59 || (meridiem ? hours < 1 || hours > 12 : hours > 23)) return "";
      var whole = meridiem ? (hours % 12) + (meridiem === "pm" ? 12 : 0) : hours;
      return pad(whole, 2) + ":" + pad(minutes, 2);
    }

    // A time as the box writes it: 18:30, or 6:30 PM on a 12-hour clock.
    function showTime(clock) {
      if (!twelveHour) return clock;
      var hours = Number(clock.slice(0, 2));
      return (hours % 12 || 12) + ":" + clock.slice(3, 5) + " " + (hours < 12 ? "AM" : "PM");
    }

    // The time box. The text box and the clock button are the kit's. It keeps the text its state was worked out from (shown) and the time
    // that text is (clock, HH:mm, or nothing when it is no time), and tells the field when either changes (hooks.changed).
    function makeTimeBox(root, base, name, hooks) {
      var input = root.querySelector("[data-time-input]");
      var pop = root.querySelector("[data-time-pop]");
      var trigger = pop.querySelector("[data-time-trigger]");
      var panel = pop.querySelector("[data-time-panel]");
      var columns = [
        { kind: "hour", list: pop.querySelector("[data-time-hours]"), items: [] },
        { kind: "minute", list: pop.querySelector("[data-time-minutes]"), items: [] },
        { kind: "meridiem", list: pop.querySelector("[data-time-meridiem]"), items: [] }
      ];
      var shownColumns = twelveHour ? columns : columns.slice(0, 2);
      var clock = "";
      var shown = "";
      var built = false;
      var popup;

      input.id = base + "-time";
      trigger.id = base + "-clock";
      panel.id = base + "-clockpanel";
      trigger.setAttribute("aria-controls", panel.id);
      panel.setAttribute("aria-label", name + ", choose time");
      input.placeholder = twelveHour ? "--:-- AM" : "--:--";

      function setClock(value) {
        clock = value;
        shown = value === "" ? "" : showTime(value);
        input.value = shown;
      }

      function relabel() {
        trigger.setAttribute("aria-label", name + (clock === "" ? ", choose time" : ", change time, " + shown));
      }

      function follow() {
        if (input.value === shown) return;
        shown = input.value;
        var text = shown.trim();
        clock = text === "" ? "" : readTime(text);
      }

      // The options, made once, the first time the list opens. Each carries its number, and the text on it is a number or AM or PM.
      function build() {
        if (built) return;
        built = true;
        var hours = [];
        for (var hour = twelveHour ? 1 : 0; hour <= (twelveHour ? 12 : 23); hour += 1) hours.push(hour);
        var minutes = [];
        for (var minute = 0; minute < 60; minute += 1) minutes.push(minute);
        var parts = [
          { column: columns[0], values: hours, text: function (value) { return pad(value, 2); } },
          { column: columns[1], values: minutes, text: function (value) { return pad(value, 2); } }
        ];
        if (twelveHour) parts.push({ column: columns[2], values: [0, 1], text: function (value) { return value === 0 ? "AM" : "PM"; } });
        parts.forEach(function (part) {
          part.values.forEach(function (value) {
            var item = document.createElement("li");
            item.className = "reg-time__opt";
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", "false");
            item.setAttribute("tabindex", "-1");
            item.setAttribute("data-value", String(value));
            item.textContent = part.text(value);
            part.column.list.appendChild(item);
            part.column.items.push(item);
          });
        });
        pop.querySelector("[data-time-meridiem-col]").hidden = !twelveHour;
        panel.classList.toggle("reg-time--twelve", twelveHour);
      }

      // The option that is chosen has aria-selected and is the one in the order of the Tab key of its column; with no time yet, the
      // option a first press would start from is.
      function mark(column, chosen, start) {
        column.items.forEach(function (item) {
          var value = Number(item.getAttribute("data-value"));
          item.setAttribute("aria-selected", value === chosen ? "true" : "false");
          item.setAttribute("tabindex", (chosen >= 0 ? value === chosen : value === start) ? "0" : "-1");
        });
      }

      function paint() {
        var hour = clock === "" ? -1 : Number(clock.slice(0, 2));
        var minute = clock === "" ? -1 : Number(clock.slice(3, 5));
        mark(columns[0], hour < 0 ? -1 : twelveHour ? hour % 12 || 12 : hour, 9);
        mark(columns[1], minute, 0);
        if (twelveHour) mark(columns[2], hour < 0 ? -1 : hour < 12 ? 0 : 1, 0);
      }

      function tabbable(column) {
        return column.items.filter(function (item) { return item.getAttribute("tabindex") === "0"; })[0] || column.items[0];
      }

      // A choice in a column. What the other column has not been given yet starts from its default (09, 00, AM).
      function choose(column, item) {
        var value = Number(item.getAttribute("data-value"));
        var hour = clock === "" ? 9 : Number(clock.slice(0, 2));
        var minute = clock === "" ? 0 : Number(clock.slice(3, 5));
        if (column.kind === "hour") hour = twelveHour ? (value % 12) + (hour >= 12 ? 12 : 0) : value;
        else if (column.kind === "minute") minute = value;
        else hour = (hour % 12) + (value === 1 ? 12 : 0);
        setClock(pad(hour, 2) + ":" + pad(minute, 2));
        hooks.changed();
        paint();
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      function columnOf(item) {
        return shownColumns.filter(function (column) { return column.items.indexOf(item) !== -1; })[0];
      }

      function indexFor(key, at, last) {
        if (key === "ArrowDown") return Math.min(last, at + 1);
        if (key === "ArrowUp") return Math.max(0, at - 1);
        return key === "Home" ? 0 : last;
      }

      function onOptionKey(event) {
        var item = event.target;
        var column = item && item.getAttribute && item.getAttribute("role") === "option" ? columnOf(item) : null;
        if (!column || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        var key = event.key;
        if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
          var target = column.items[indexFor(key, column.items.indexOf(item), column.items.length - 1)];
          target.focus();
          choose(column, target);
        } else if (key === "ArrowLeft" || key === "ArrowRight") {
          var neighbour = shownColumns[shownColumns.indexOf(column) + (key === "ArrowRight" ? 1 : -1)];
          if (neighbour) tabbable(neighbour).focus();
        } else if (key === "Enter" || key === " ") {
          choose(column, item);
          if (key === "Enter") popup.close(true);
        } else return;
        event.preventDefault();
      }

      popup = setUpWindow(pop, trigger, panel, {
        opened: function () {
          build();
          paint();
          tabbable(columns[0]).focus();
        }
      });

      panel.addEventListener("keydown", onOptionKey);
      panel.addEventListener("click", function (event) {
        var item = event.target && event.target.closest ? event.target.closest('[role="option"]') : null;
        var column = item ? columnOf(item) : null;
        if (column) {
          item.focus();
          choose(column, item);
        }
      });

      function onType() {
        follow();
        paint();
        hooks.changed();
      }

      // On leaving the box a time that was typed in another way is written the way the box writes it.
      function onChange() {
        follow();
        if (clock !== "") {
          var written = showTime(clock);
          if (input.value !== written) {
            input.value = written;
            shown = written;
          }
        }
        paint();
        hooks.changed();
      }

      input.addEventListener("input", onType);
      input.addEventListener("change", onChange);
      input.addEventListener("keydown", function (event) {
        if (event.isComposing || event.ctrlKey || event.metaKey || event.key !== "ArrowDown") return;
        event.preventDefault();
        popup.open();
      });

      return {
        input: input,
        trigger: trigger,
        popup: popup,
        value: function () { return clock; },
        typed: function () { return input.value.trim() !== ""; },
        broken: function () { return input.value.trim() !== "" && clock === ""; },
        set: setClock,
        relabel: relabel
      };
    }

    timeSupport = { kit: document.getElementById("reg-time-kit"), make: makeTimeBox, read: readTime };
`;
