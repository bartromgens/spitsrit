# syntax=docker/dockerfile:1
# One combined image: Django serves the Angular build (gantry contract L6).
ARG NODE_VERSION
ARG PYTHON_VERSION

FROM node:${NODE_VERSION}-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx ng build --source-map

# build.yml exports this stage to upload source maps to Sentry.
FROM scratch AS frontend-dist
COPY --from=frontend /frontend/dist/frontend/browser /

FROM python:${PYTHON_VERSION}-slim AS app
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/ ./
COPY --from=frontend-dist / ./frontend_dist
RUN find frontend_dist -name '*.map' -delete \
 && DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput
RUN useradd --create-home app
USER app
ARG GIT_SHA
ENV GIT_SHA=${GIT_SHA}
EXPOSE 8000
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
