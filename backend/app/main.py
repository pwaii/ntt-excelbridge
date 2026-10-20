"""FastAPI app + Mangum Lambda handler."""
import logging
from uuid import uuid4

from botocore.exceptions import (
    ClientError,
    CredentialRetrievalError,
    EndpointConnectionError,
    NoCredentialsError,
    PartialCredentialsError,
    ProfileNotFound,
    RefreshWithMFAUnsupportedError,
    TokenRetrievalError,
)
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.artifacts import router as artifacts_router
from app.api.jobs import router as jobs_router
from app.api.reviews import router as reviews_router
from app.api.uploads import router as uploads_router
from app.api.workbooks import router as workbooks_router
from app.settings import settings

app = FastAPI(title="XLSX Workflow API")
logger = logging.getLogger(__name__)

AWS_CREDENTIAL_ERRORS = (
    CredentialRetrievalError,
    NoCredentialsError,
    PartialCredentialsError,
    RefreshWithMFAUnsupportedError,
    TokenRetrievalError,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(EndpointConnectionError)
async def endpoint_connection_error(request: Request, error: EndpointConnectionError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logger.exception("AWS endpoint is unreachable", exc_info=error)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "AWS endpoint is unreachable; check AWS_REGION, SSO login, and network access",
            "request_id": request_id,
            "error_code": "AWS_ENDPOINT_UNREACHABLE",
        },
    )


async def aws_credentials_error(request: Request, error: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logger.exception("AWS credentials are unavailable", exc_info=error)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "AWS credentials are missing or expired; run aws sso login --profile finpilot and restart the backend",
            "request_id": request_id,
            "error_code": "AWS_CREDENTIALS_EXPIRED",
        },
    )


for _credential_error in AWS_CREDENTIAL_ERRORS:
    app.add_exception_handler(_credential_error, aws_credentials_error)


@app.exception_handler(ProfileNotFound)
async def missing_aws_profile(request: Request, error: ProfileNotFound) -> JSONResponse:
    return JSONResponse(status_code=503, content={
        "detail": "The configured AWS profile is unavailable in the backend environment",
        "request_id": getattr(request.state, "request_id", str(uuid4())),
        "error_code": "AWS_PROFILE_NOT_FOUND",
    })


@app.exception_handler(ClientError)
async def aws_client_error(request: Request, error: ClientError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    error_info = error.response.get("Error", {})
    code = str(error_info.get("Code", "AWS_CLIENT_ERROR"))
    message = str(error_info.get("Message", "AWS request failed"))
    logger.exception("AWS request failed: %s", code, exc_info=error)
    status_code = 403 if code in {"AccessDenied", "AccessDeniedException"} else 502
    return JSONResponse(
        status_code=status_code,
        content={"detail": message, "request_id": request_id, "error_code": code},
    )


@app.exception_handler(ValueError)
async def configuration_error(request: Request, error: ValueError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logger.exception("backend configuration error", exc_info=error)
    return JSONResponse(
        status_code=503,
        content={"detail": str(error), "request_id": request_id, "error_code": "CONFIGURATION_ERROR"},
    )

app.include_router(jobs_router)
app.include_router(workbooks_router)
app.include_router(uploads_router)
app.include_router(artifacts_router)
app.include_router(reviews_router)


@app.middleware("http")
async def request_id_middleware(request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


@app.get("/health")
def health(request: Request) -> dict:
    return {"status": "ok", "request_id": request.state.request_id}


def _api_gateway_base_path(event: dict) -> str:
    """Return the stage prefix when API Gateway included it in ``rawPath``.

    HTTP API payloads can expose a named stage as part of ``rawPath``.  FastAPI
    routes are intentionally stage-agnostic, so Mangum must remove that prefix
    before dispatching the request.  Local ASGI requests and ``$default``
    stages have no prefix to remove.
    """

    request_context = event.get("requestContext") or {}
    stage = str(request_context.get("stage") or "").strip("/")
    raw_path = str(event.get("rawPath") or "")
    if not stage or stage == "$default":
        return "/"

    stage_path = f"/{stage}"
    if raw_path == stage_path or raw_path.startswith(f"{stage_path}/"):
        return stage_path
    return "/"


_lambda_handler = None


def handler(event, context):
    """Lazy Mangum adapter for AWS Lambda.

    Lazy construction keeps local FastAPI imports and tests independent of the
    Windows event-loop policy. Lambda still reuses the adapter across warm calls.
    """

    global _lambda_handler
    if _lambda_handler is None:
        from mangum import Mangum

        _lambda_handler = Mangum(app, api_gateway_base_path=_api_gateway_base_path(event))
    return _lambda_handler(event, context)
