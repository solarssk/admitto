import { useState } from "react";
import { Badge, Spinner, useToast } from "@admitto/ui";
import { useNavigate } from "react-router";
import { signOut } from "../api/client.js";
import type { AuthUser, RoleAssignment } from "../api/types.js";
import { isAdmin, isSuperadmin } from "../auth/capabilities.js";
import { ROLE_BADGE_VARIANT, ROLE_LABELS, type StaffRole } from "../auth/role-labels.js";
import { clearSignOutInProgress, markSignOutInProgress } from "../auth/sign-out-in-progress.js";
import { loadWithTimeout } from "../utils/load-timeout.js";
import { useDropdownMenu } from "./useDropdownMenu.js";

type RoleTier = StaffRole;

const ROLE_TIER_ICON: Record<RoleTier, { icon: string; badgeCls: string }> = {
  superadmin: { icon: "shield-star", badgeCls: "user-avatar__badge--superadmin" },
  admin: { icon: "shield-check", badgeCls: "user-avatar__badge--admin" },
  operator: { icon: "id-badge-2", badgeCls: "user-avatar__badge--operator" },
};

function roleTier(assignments: RoleAssignment[]): RoleTier {
  if (isSuperadmin(assignments)) return "superadmin";
  if (isAdmin(assignments)) return "admin";
  return "operator";
}

const SIGN_OUT_FAILED_MESSAGE = "Could not sign out. Try again.";

/** Where the browser goes once the session is revoked: the identity provider's own logout page for
 * a single sign-on session (so the provider's session ends too), otherwise the sign-in page. The
 * page goes there itself instead of posting a form that the server redirects, because the page's
 * `form-action 'self'` policy also applies to the redirect target of a form post. Only an http(s)
 * address from the server is followed. */
function signOutDestination(endSessionUrl: string | null): string {
  if (endSessionUrl) {
    try {
      const url = new URL(endSessionUrl);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      // Not an address: the sign-in page is the only safe place left to go.
    }
  }
  return "/login";
}

function avatarClassName(size?: "md"): string {
  return size ? `user-avatar user-avatar--${size}` : "user-avatar";
}

/** A generic person glyph + a role-tier icon badge, not initials — this is the one spot
 * naming the signed-in user, so the role (not just a name) needs to read at a glance. */
function RoleAvatar({ tier, size }: Readonly<{ tier: RoleTier; size?: "md" }>) {
  const meta = ROLE_TIER_ICON[tier];
  return (
    <span className={avatarClassName(size)}>
      <i className="ti ti-user" aria-hidden="true" />
      <span className={`user-avatar__badge ${meta.badgeCls}`}>
        <i className={`ti ti-${meta.icon}`} aria-hidden="true" />
      </span>
    </span>
  );
}

/** Topbar user menu: avatar + role-tier badge trigger, "My account" and "Sign out" —
 * consolidates what used to be three separate topbar elements (RoleBadge, name, raw
 * sign-out button) into one dropdown. */
export function UserMenu({ user, assignments }: Readonly<{ user: AuthUser; assignments: RoleAssignment[] }>) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { open, setOpen, close, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
    gap: 8,
  });
  const [signingOut, setSigningOut] = useState(false);
  const tier = roleTier(assignments);
  const displayName = user.display_name || user.email;

  async function handleSignOut() {
    // A busy row keeps its focus (`aria-disabled`, not `disabled`), so the click is ignored here.
    if (signingOut) return;
    setSigningOut(true);
    markSignOutInProgress();
    const limit = loadWithTimeout();
    let endSessionUrl: string | null;
    try {
      endSessionUrl = await signOut(limit.signal);
    } catch {
      clearSignOutInProgress();
      setSigningOut(false);
      addToast(SIGN_OUT_FAILED_MESSAGE, "error");
      return;
    } finally {
      limit.done();
    }
    // The page is left for good, so the row stays busy until the browser has gone.
    markSignOutInProgress();
    window.location.assign(signOutDestination(endSessionUrl));
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        ref={triggerRef}
      >
        <RoleAvatar tier={tier} />
        <span className="user-menu__name">{displayName}</span>
        <i className="ti ti-chevron-down user-menu__chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="user-menu__panel" role="menu" ref={panelRef} style={panelStyle}>
          <div className="user-menu__head">
            <RoleAvatar tier={tier} size="md" />
            <div className="user-menu__head-text">
              <strong>{displayName}</strong>
              <Badge variant={ROLE_BADGE_VARIANT[tier]} outline>
                {ROLE_LABELS[tier]}
              </Badge>
            </div>
          </div>
          <div className="user-menu__divider" />
          <button
            type="button"
            role="menuitem"
            className="user-menu__item"
            onClick={() => {
              close();
              void navigate("/account");
            }}
          >
            <span className="user-menu__item-icon">
              <i className="ti ti-user-circle" aria-hidden="true" />
            </span>
            <span className="user-menu__item-text">
              <strong>My account</strong>
            </span>
          </button>
          <div className="user-menu__divider" />
          <button
            type="button"
            role="menuitem"
            className="user-menu__item user-menu__item--danger"
            aria-disabled={signingOut || undefined}
            aria-busy={signingOut || undefined}
            onClick={() => void handleSignOut()}
          >
            <span className="user-menu__item-icon">
              {signingOut ? (
                <Spinner size="sm" aria-hidden="true" />
              ) : (
                <i className="ti ti-logout" aria-hidden="true" />
              )}
            </span>
            <span className="user-menu__item-text">
              <strong>Sign out</strong>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
