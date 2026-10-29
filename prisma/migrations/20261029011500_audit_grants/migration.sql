-- Runtime role for the application. Created by db/init/01-init.sh in local/dev setups.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contract_app') THEN
    RAISE EXCEPTION 'role contract_app is missing; run db/init/01-init.sh or create it manually';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO contract_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO contract_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO contract_app;

-- Append-only tables: the application may insert and read, never mutate or truncate.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditLog" FROM contract_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "FlowEventLog" FROM contract_app;

-- Keep future tables usable by the runtime role without re-granting.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO contract_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO contract_app;
