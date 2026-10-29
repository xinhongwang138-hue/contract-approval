#!/bin/bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contract_app') THEN
      CREATE ROLE contract_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
    END IF;
  END
  \$\$;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO contract_app;
  GRANT USAGE ON SCHEMA public TO contract_app;
EOSQL

if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'contract_test'" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" | grep -q 1; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "CREATE DATABASE contract_test OWNER ${POSTGRES_USER}"
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "contract_test" <<-EOSQL
  GRANT CONNECT ON DATABASE contract_test TO contract_app;
  GRANT USAGE ON SCHEMA public TO contract_app;
EOSQL
