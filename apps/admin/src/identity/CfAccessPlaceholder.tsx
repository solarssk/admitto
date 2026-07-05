import { Card, Badge } from "@admitto/ui";

/**
 * Cloudflare Access sub-tab anchor (slice 2). The full SPA editor lands in
 * slice 4 (#266); until then this panel summarises the current state and
 * bridges to the legacy HTML editor at /admin/auth/cf-access.
 */
export function CfAccessPlaceholder() {
  return (
    <div className="identity-section__panels">
      <Card title="Cloudflare Access">
        <div className="settings-row">
          <div className="settings-row__text">
            <strong>Cloudflare Zero Trust protection</strong>
            <p>
              The redesigned Cloudflare Access editor is part of the ongoing Settings → Identity
              migration. You can still review and change the current configuration in the existing
              editor.
            </p>
            <div className="cf-access-summary__badges">
              <Badge variant="neutral" dot>SPA editor coming soon</Badge>
            </div>
          </div>
          <a className="at-btn at-btn--secondary" href="/admin/auth/cf-access">
            <span>Open current editor</span>
          </a>
        </div>
      </Card>
    </div>
  );
}
