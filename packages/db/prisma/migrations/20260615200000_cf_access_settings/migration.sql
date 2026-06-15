-- Cloudflare Access settings (prompt 16c): SystemSettings seed defaults.
INSERT INTO "SystemSettings" ("key", "value_json", "updated_at") VALUES
    ('cf_access_enabled', 'false', NOW()),
    ('cf_access_team_domain', '""', NOW()),
    ('cf_access_aud', '[]', NOW()),
    ('cf_access_protected_prefixes', '["/admin","/api/admin"]', NOW())
ON CONFLICT ("key") DO NOTHING;
