"""Authenticated Quick dashboard embedding routes."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from botocore.exceptions import ClientError

from app.auth import current_user_id
from app.settings import settings
from app.storage.aws_session import get_quicksight_client

router = APIRouter(prefix="/v1/analytics/quick", tags=["analytics"])


def _tag_rule_is_enabled(dataset: dict, tag_key: str) -> bool:
    configuration = dataset.get("RowLevelPermissionTagConfiguration") or {}
    if configuration.get("Status") != "ENABLED":
        return False
    rules = configuration.get("TagRules") or []
    has_owner_column = any(
        column.get("Name") == "owner_id" for column in dataset.get("OutputColumns", [])
    )
    return has_owner_column and any(
        rule.get("TagKey") == tag_key
        and rule.get("ColumnName") == "owner_id"
        and not rule.get("MatchAllValue")
        for rule in rules
    )


@router.get("/embed-url")
def quick_dashboard_embed_url(
    request: Request,
    response: Response,
    owner_id: str = Depends(current_user_id),
) -> dict[str, str | int]:
    """Mint a short-lived URL with a backend-derived owner RLS session tag."""
    account_id = settings.quicksight_account_id
    dashboard_id = settings.quicksight_dashboard_id
    dataset_ids = (settings.quicksight_quality_dataset_id, settings.quicksight_inspection_dataset_id)
    tag_key = settings.quicksight_owner_tag_key
    if not account_id or not dashboard_id or any(not value for value in dataset_ids) or not tag_key:
        raise HTTPException(
            503,
            "The Quick dashboard is not configured yet.",
            headers={"X-Error-Code": "QUICKSIGHT_NOT_CONFIGURED"},
        )

    origin = request.headers.get("origin", "")
    allowed_origins = {
        value.strip().rstrip("/")
        for value in settings.cors_origins.split(",")
        if value.strip()
    }
    if not origin or origin.rstrip("/") not in allowed_origins:
        raise HTTPException(
            403,
            "This application origin is not allowed to embed Quick dashboards.",
            headers={"X-Error-Code": "QUICKSIGHT_ORIGIN_NOT_ALLOWED"},
        )

    quicksight = get_quicksight_client()
    for dataset_id in dataset_ids:
        dataset = quicksight.describe_data_set(
            AwsAccountId=account_id,
            DataSetId=dataset_id,
        ).get("DataSet", {})
        if not _tag_rule_is_enabled(dataset, tag_key):
            raise HTTPException(
                503,
                "Quick dashboard access is paused until owner-based row security is enabled on every dashboard dataset.",
                headers={"X-Error-Code": "QUICKSIGHT_RLS_NOT_READY"},
            )

    try:
        result = quicksight.generate_embed_url_for_anonymous_user(
            AwsAccountId=account_id,
            Namespace="default",
            AuthorizedResourceArns=[
                f"arn:aws:quicksight:{settings.quicksight_region}:{account_id}:dashboard/{dashboard_id}"
            ],
            ExperienceConfiguration={"Dashboard": {"InitialDashboardId": dashboard_id}},
            SessionTags=[{"Key": tag_key, "Value": owner_id}],
            SessionLifetimeInMinutes=60,
            AllowedDomains=[origin],
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "UnsupportedPricingPlanException":
            raise HTTPException(
                503,
                "Quick dashboard embedding requires an active QuickSight Capacity Pricing plan.",
                headers={"X-Error-Code": "QUICKSIGHT_CAPACITY_REQUIRED"},
            ) from error
        raise
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return {
        "embed_url": result["EmbedUrl"],
        "embed_url_valid_for_seconds": 300,
        "session_lifetime_minutes": 60,
    }
