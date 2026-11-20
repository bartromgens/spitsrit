# Spitsrit

A trip planner for daily commuters on the Dutch railways, built on the NS API. Save your commutes (say Utrecht Centraal to Amsterdam Centraal) and see the next trains at a glance: platform, delays, cancellations, and whether to leave now or wait for a faster train.

Built with [gantry](https://github.com/bartromgens/gantry): Django + DRF backend, Angular Material frontend, one container image.

## NS API key

Train data comes from the [NS API portal](https://apiportal.ns.nl). Subscribe to the Reisinformatie API and set the key as `NS_API_KEY` (for local development in `backend/config/settings_local.py`, as `NS_API_KEY = "..."`). Without a key the commute pages work but show "Train times are unavailable".

The request and response formats in `backend/api/ns.py` have not yet been checked against a live response. Do that first, with a real key.

## Local development

Requires uv, Node (version in `frontend/.nvmrc`) and Docker.

```bash
make install
docker compose up -d db
cp backend/config/settings_local.py.example backend/config/settings_local.py
uv --directory backend run python manage.py migrate
uv --directory backend run python manage.py createsuperuser
uv --directory backend run python manage.py runserver
npm --prefix frontend start        # http://localhost:4200, proxies /api to Django
```

After changing the API, regenerate the typed client with `npm --prefix frontend run api`.

## Checks

```bash
make fix     # format and autofix
make check   # lint and types
make test    # unit and integration tests, diff coverage
make e2e     # Playwright against the full Compose stack
```
