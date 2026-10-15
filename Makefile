# Common tasks. See docs/ for per-role detail.
.PHONY: install install-backend install-frontend dev-backend dev-frontend test test-backend test-frontend lint preflight deploy destroy

install: install-backend install-frontend

install-backend:
	cd backend && pip install -e ".[dev]"

install-frontend:
	cd frontend && npm install

dev-backend:
	cd backend && uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

test: test-backend test-frontend

test-backend:
	cd backend && pytest

# Run a single backend test: make test-one T=app/tests/test_quality_rules.py::test_duplicate_rows
test-one:
	cd backend && pytest $(T) -q

test-frontend:
	cd frontend && npm test

lint:
	cd backend && ruff check app

# region/model availability check before deploy (§7.1). PowerShell per infra/scripts.
preflight:
	pwsh infra/scripts/preflight.ps1

deploy:
	pwsh infra/scripts/deploy.ps1

destroy:
	pwsh infra/scripts/destroy-demo.ps1
