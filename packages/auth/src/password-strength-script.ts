import { PASSWORD_MIN_LENGTH } from "./constants.js";
import { scorePasswordStrengthInline, tooShortProgressScore } from "./password-strength.js";

/** Shared auth-page styles for password strength and confirm-match hints. */
export const AUTH_PASSWORD_STRENGTH_CSS = `
.auth-password-slot {
  position: relative;
}
.auth-password-strength {
  position: absolute;
  top: calc(100% + 0.5rem);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.75rem;
}
.auth-password-strength--empty {
  display: none;
}
.auth-password-strength__bar {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.25rem;
}
.auth-password-strength__segment {
  height: 0.5rem;
  border-radius: 999px;
  background: var(--at-gray-200);
  transition: background-color 0.15s ease-out;
}
.auth-password-strength__segment--weak { background: var(--at-red); }
.auth-password-strength__segment--fair { background: var(--at-yellow); }
.auth-password-strength__segment--good { background: var(--at-blue); }
.auth-password-strength__segment--strong { background: var(--at-green); }
.auth-password-strength__label {
  flex-shrink: 0;
  min-width: 4.5rem;
  text-align: right;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--at-gray-600);
}
.auth-password-strength__label--weak { color: var(--at-red); }
.auth-password-strength__label--fair { color: var(--at-yellow); }
.auth-password-strength__label--good { color: var(--at-blue); }
.auth-password-strength__label--strong { color: var(--at-green); }
.auth-confirm-match--ok { color: var(--at-green-600); }
.auth-confirm-match--warn { color: var(--at-gray-500); }
`;

const AUTH_PASSWORD_STRENGTH_SEGMENTS_HTML =
  '<span class="auth-password-strength__segment"></span>'.repeat(4);

/** SSR password strength meter shell (updated by passwordStrengthAuthScript on input). */
export function renderAuthPasswordStrengthMeterHtml(inputId: string): string {
  const meterId = `${inputId}-strength`;
  return `<div class="auth-password-strength auth-password-strength--empty" id="${meterId}" role="status" aria-live="polite">
    <div class="auth-password-strength__bar" aria-hidden="true">${AUTH_PASSWORD_STRENGTH_SEGMENTS_HTML}</div>
    <span class="auth-password-strength__label"></span>
  </div>`;
}

/** Inline script for setup / change-password pages — embeds the same scorer as @admitto/auth. */
export function passwordStrengthAuthScript(scriptNonce: string): string {
  const tooShortSource = tooShortProgressScore.toString();
  const scorerSource = scorePasswordStrengthInline.toString();
  return `<script nonce="${scriptNonce}">
(function () {
  var MIN = ${PASSWORD_MIN_LENGTH};
  var tooShortProgressScore = ${tooShortSource};
  var score = ${scorerSource};

  function appendDescribedBy(input, id) {
    var tokens = (input.getAttribute("aria-describedby") || "").split(/\\s+/).filter(Boolean);
    if (tokens.indexOf(id) === -1) tokens.push(id);
    input.setAttribute("aria-describedby", tokens.join(" "));
  }

  function ensureMeter(input) {
    var slot = input.closest(".auth-password-slot");
    if (!slot) return null;
    var meter = slot.querySelector(".auth-password-strength");
    if (!meter) {
      meter = document.createElement("div");
      meter.className = "auth-password-strength auth-password-strength--empty";
      meter.setAttribute("role", "status");
      meter.setAttribute("aria-live", "polite");
      meter.innerHTML =
        '<div class="auth-password-strength__bar" aria-hidden="true">' +
        '<span class="auth-password-strength__segment"></span>'.repeat(4) +
        '</div><span class="auth-password-strength__label"></span>';
      slot.appendChild(meter);
      var meterId = input.id + "-strength";
      meter.id = meterId;
      appendDescribedBy(input, meterId);
    }
    return meter;
  }

  function clearMeter(meter) {
    meter.classList.add("auth-password-strength--empty");
    meter.removeAttribute("aria-label");
    var label = meter.querySelector(".auth-password-strength__label");
    if (label) {
      label.textContent = "";
      label.className = "auth-password-strength__label";
    }
    var segments = meter.querySelectorAll(".auth-password-strength__segment");
    for (var i = 0; i < segments.length; i++) {
      segments[i].className = "auth-password-strength__segment";
    }
  }

  function updateMeter(input) {
    var meter = ensureMeter(input);
    if (!meter) return;
    var result = score(input.value, MIN);
    if (result.level === "empty") {
      clearMeter(meter);
      return;
    }
    meter.classList.remove("auth-password-strength--empty");
    meter.setAttribute("aria-label", "Password strength: " + result.label);
    var label = meter.querySelector(".auth-password-strength__label");
    if (label) {
      label.textContent = result.label;
      label.className = "auth-password-strength__label auth-password-strength__label--" + result.level;
    }
    var segments = meter.querySelectorAll(".auth-password-strength__segment");
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      seg.className = "auth-password-strength__segment";
      if (i < result.score) seg.className += " auth-password-strength__segment--" + result.level;
    }
  }

  function wireMatch(confirmInput, passwordInput) {
    var field = confirmInput.closest(".auth-field");
    if (!field) return;
    var hint = field.querySelector(".auth-confirm-match");
    if (!hint) {
      hint = document.createElement("p");
      hint.className = "auth-field-hint auth-confirm-match";
      hint.id = confirmInput.id + "-match";
      hint.setAttribute("role", "status");
      hint.setAttribute("aria-live", "polite");
      field.appendChild(hint);
      appendDescribedBy(confirmInput, hint.id);
    }
    function update() {
      if (!confirmInput.value) {
        hint.textContent = "";
        hint.className = "auth-field-hint auth-confirm-match";
        return;
      }
      var matches = confirmInput.value === passwordInput.value;
      hint.textContent = matches ? "Passwords match." : "Passwords do not match yet.";
      hint.className = "auth-field-hint auth-confirm-match " + (matches ? "auth-confirm-match--ok" : "auth-confirm-match--warn");
    }
    confirmInput.addEventListener("input", update);
    passwordInput.addEventListener("input", update);
  }

  var password = document.getElementById("password");
  if (password) {
    password.addEventListener("input", function () { updateMeter(password); });
    updateMeter(password);
  }
  var confirm = document.getElementById("confirm_password") || document.getElementById("password_confirm");
  if (confirm && password) {
    wireMatch(confirm, password);
  }
})();
</script>`;
}
