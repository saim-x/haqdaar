# Haqdaar — multi-stage image (docs/03 §6.5)
#
# Stage 1 builds the React PWA. Stage 2 installs the Python backend and copies
# the built assets to /app/static, which app.main mounts at "/" when present.
# Set BUILD_FRONTEND=false to skip stage 1 (worker image, backend-only builds).

ARG PYTHON_VERSION=3.12

# --- stage 1: frontend ------------------------------------------------------
FROM node:20-alpine AS frontend

ARG BUILD_FRONTEND=true

WORKDIR /build

# Copy inputs explicitly so local environment files and Windows dependencies
# cannot enter the Linux build.
COPY frontend/package.json frontend/package-lock.json frontend/index.html frontend/postcss.config.js frontend/tailwind.config.js frontend/tsconfig.json frontend/vite.config.ts ./frontend/
COPY frontend/src/ ./frontend/src/
COPY frontend/public/ ./frontend/public/
RUN if [ "$BUILD_FRONTEND" = "true" ] && [ -f frontend/package.json ]; then \
        cd frontend && npm ci --no-audit --no-fund && npm run build; \
    else \
        mkdir -p frontend/dist && echo "frontend build skipped" > frontend/dist/.skipped; \
    fi

# --- stage 2: backend -------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libpq for psycopg, libgl/libglib for opencv-python-headless, curl for probes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 \
        libglib2.0-0 \
        libgl1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/pyproject.toml ./pyproject.toml
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini

RUN pip install .

COPY --from=frontend /build/frontend/dist ./static

RUN mkdir -p /data/uploads \
    && useradd --create-home --uid 10001 haqdaar \
    && chown -R haqdaar:haqdaar /app /data

USER haqdaar

ENV UPLOAD_DIR=/data/uploads \
    STATIC_DIR=/app/static \
    APP_ENV=prod

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
