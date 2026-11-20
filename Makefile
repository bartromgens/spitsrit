# Targets from gantry's contract (contract.md, item M1).

export PYTHON_VERSION := $(shell cat .python-version)
export NODE_VERSION := $(shell cat frontend/.nvmrc)
DIFF_COVERAGE := $(shell sed -n 's/^diff_coverage: *//p' .gantry.yml)
DIFF_BASE ?= origin/main

BACKEND := uv --directory backend run
E2E := npm --prefix e2e exec --

.PHONY: install fix check test e2e smoke

install:
	uv --directory backend sync --frozen
	npm --prefix frontend ci
	npm --prefix e2e ci
	$(E2E) playwright install chromium

fix:
	$(BACKEND) ruff check --fix .
	$(BACKEND) ruff format .
	cd frontend && npx prettier --write .
	cd frontend && npx ng lint --fix

check:
	$(BACKEND) ruff check .
	$(BACKEND) ruff format --check .
	$(BACKEND) mypy .
	$(BACKEND) python manage.py makemigrations --check --dry-run
	cd frontend && npx prettier --check .
	cd frontend && npx ng lint
	cd frontend && npx tsc --noEmit -p tsconfig.app.json
	cd frontend && npx tsc --noEmit -p tsconfig.spec.json
	cd e2e && npx tsc --noEmit -p .

test:
	$(BACKEND) pytest --cov --cov-report=xml
	cd frontend && npx ng test --watch=false --coverage --coverage-reporters=lcov
	@# diff-cover cannot mix report formats, and lcov paths are relative to frontend/.
	sed 's#^SF:#SF:frontend/#' frontend/coverage/frontend/lcov.info > frontend/coverage/lcov.info
	@if git rev-parse -q --verify $(DIFF_BASE) >/dev/null; then \
		uv run --project backend diff-cover backend/coverage.xml \
			--compare-branch=$(DIFF_BASE) --fail-under=$(DIFF_COVERAGE) && \
		uv run --project backend diff-cover frontend/coverage/lcov.info \
			--compare-branch=$(DIFF_BASE) --fail-under=$(DIFF_COVERAGE); \
	else \
		echo "No $(DIFF_BASE); skipping diff coverage."; \
	fi

e2e:
	docker compose up -d --build --wait
	cd e2e && npx playwright test; status=$$?; cd .. && docker compose down -v; exit $$status

smoke:
	cd e2e && BASE_URL=$(BASE_URL) npx playwright test --grep @smoke
