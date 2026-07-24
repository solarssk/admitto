import { Badge, type BadgeVariant } from "@admitto/ui";
import { useNavigate } from "react-router";
import type { AuthUser, RoleAssignment } from "../api/types.js";
import { isAdmin, isSuperadmin } from "../auth/capabilities.js";
import { useDropdownMenu } from "./useDropdownMenu.js";

type RoleTier = "superadmin" | "admin" | "operator";

const ROLE_TIER_META: Record<RoleTier, { label: string; icon: string; badgeCls: string; variant: BadgeVariant }> = {
  superadmin: { label: "Superadmin", icon: "shield-star", badgeCls: "user-avatar__badge--superadmin", variant: "error" },
  admin: { label: "Admin", icon: "shield-check", badgeCls: "user-avatar__badge--admin", variant: "info" },
  operator: { label: "Operator", icon: "id-badge-2", badgeCls: "user-avatar__badge--operator", variant: "neutral" },
};

function roleTier(assignments: RoleAssignment[]): RoleTier {
  if (isSuperadmin(assignments)) return "superadmin";
  if (isAdmin(assignments)) return "admin";
  return "operator";
}

function avatarClassName(size?: "md"): string {
  return size ? `user-avatar user-avatar--${size}` : "user-avatar";
}

/** A generic person glyph + a role-tier icon badge, not initials — this is the one spot
 * naming the signed-in user, so the role (not just a name) needs to read at a glance. */
function RoleAvatar({ tier, size }: Readonly<{ tier: RoleTier; size?: "md" }>) {
  const meta = ROLE_TIER_META[tier];
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
  const { open, setOpen, close, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>();
  const tier = roleTier(assignments);
  const displayName = user.display_name || user.email.split("@")[0] || "Staff";

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
        <div className="user-menu__panel" role="menu" ref={panelRef}>
          <div className="user-menu__head">
            <RoleAvatar tier={tier} size="md" />
            <div className="user-menu__head-text">
              <strong>{displayName}</strong>
              <Badge variant={ROLE_TIER_META[tier].variant} outline>
                {ROLE_TIER_META[tier].label}
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
              navigate("/account");
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
          <form method="post" action="/logout">
            <button type="submit" role="menuitem" className="user-menu__item user-menu__item--danger">
              <span className="user-menu__item-icon">
                <i className="ti ti-logout" aria-hidden="true" />
              </span>
              <span className="user-menu__item-text">
                <strong>Sign out</strong>
              </span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
