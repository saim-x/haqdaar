#!/bin/sh
# Haqdaar container entrypoint for single-service deploys.
#
# docker-compose overrides `command` for both the api and worker services, so the
# local stack keeps its own explicit migrate/seed/worker steps. This script is
# what runs when a platform (Render, Railway, Fly, Cloud Run) starts the image
# with no command override.
#
# It does five things the bare `uvicorn` CMD cannot:
#   1. binds to $PORT, which every PaaS injects;
#   2. points MOCK_BASE_URL at this same process, because the app reaches its
#      simulated DPI services over HTTP (docs/03 invariant 4);
#   3. rewrites managed-Postgres URLs to the psycopg 3 driver this image ships;
#   4. re-signs the specimen cards when QR_HMAC_SECRET is not the dev default;
#   5. migrates, seeds, and re-stages the cards before serving.

set -eu

PORT="${PORT:-8000}"

# The mock boundary is a real HTTP call to ourselves, so it must follow $PORT.
MOCK_BASE_URL="${MOCK_BASE_URL:-http://127.0.0.1:${PORT}/mock}"
export MOCK_BASE_URL

# Render/Neon/Supabase/Railway hand out `postgres://` or `postgresql://`, which
# SQLAlchemy routes to psycopg2. Only psycopg 3 is installed here.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "haqdaar: DATABASE_URL is not set - attach a Postgres instance first" >&2
  exit 1
fi
case "${DATABASE_URL}" in
  postgres://*) DATABASE_URL="postgresql+psycopg://${DATABASE_URL#postgres://}" ;;
  postgresql://*) DATABASE_URL="postgresql+psycopg://${DATABASE_URL#postgresql://}" ;;
esac
export DATABASE_URL

echo "haqdaar: migrating (port ${PORT}, mock ${MOCK_BASE_URL})"
alembic upgrade head

# The specimen cards baked into the image are signed with the dev QR secret.
# A deployed QR_HMAC_SECRET would make every genuine card fail signature
# verification and come back TAMPER_SUSPECTED, so regenerate the pack with the
# secret this process will actually use. Deterministic, ~1.2 s.
if [ "${QR_HMAC_SECRET:-dev-qr-secret-change-me}" != "dev-qr-secret-change-me" ]; then
  echo "haqdaar: regenerating specimen cards for the deployed QR secret"
  python -c "from app.mocks.doc_generator import generate_demo_docs; print(generate_demo_docs(force=True)['count'])" \
    || echo "haqdaar: specimen regeneration skipped"
fi

echo "haqdaar: seeding demo world"
python -m app.mocks.seed --if-empty

# Free tiers have no persistent disk: the database survives a restart but
# UPLOAD_DIR does not, and `--if-empty` skips the staging step on an already
# seeded database. Re-copy the specimen cards on every boot.
python -c "from app.mocks.seed import _stage_demo_documents; print(_stage_demo_documents())" \
  || echo "haqdaar: demo document staging skipped"

echo "haqdaar: starting uvicorn"
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --proxy-headers \
  --forwarded-allow-ips="*"
