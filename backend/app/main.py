"""FastAPI app + Mangum Lambda handler. Mounts api/* routers. See docs/backend-plan.md (§13.1)."""
from fastapi import FastAPI

app = FastAPI(title="XLSX Workflow API")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}

# TODO(BE Day 1): include app.api routers, Cognito auth dep, Mangum handler:
# from mangum import Mangum
# handler = Mangum(app)
