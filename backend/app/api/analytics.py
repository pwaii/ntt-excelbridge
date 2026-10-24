"""Authenticated Quick dashboard embedding routes for registered Readers."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from botocore.exceptions import ClientError

from app.auth import current_user_id
from app.services.quicksight_identity import (
    reader_email,
    reader_quicksight_username,
    reader_user_arn,
    reader_username,
)
from app.settings import settings
from app.storage.aws_session import (
    get_assumed_reader_quicksight_client,
    get_session,
    get_client_config,
)

router = APIRouter(prefix="/v1/analytics/quick", tags=["analytics"])


def _user_rls_is_enabled(dataset: dict, permissions_dataset_arn: str) -> bool:
    rls = dataset.get("RowLevelPermissionDataSet") or {}
    has_owner_column = any(
        column.get("Name") == "owner_id" for column in dataset.get("OutputColumns", [])
    )
    return (
        has_owner_column
        and rls.get("Arn") == permissions_dataset_arn
        and rls.get("PermissionPolicy") == "GRANT_ACCESS"
        and rls.get("FormatVersion") == "VERSION_2"
        and rls.get("Status") == "ENABLED"
    )


def _ensure_reader(quicksight, account_id: str, owner_id: str) -> str:
    """Register the same app customer as one IAM-federated Quick Reader every time."""
    role_arn = settings.quicksight_embedding_role_arn
    username = reader_username(owner_id)
    expected_arn = reader_user_arn(role_arn, settings.quicksight_region, owner_id)
    try:
        user = quicksight.describe_user(
            AwsAccountId=account_id,
            Namespace="default",
            UserName=reader_quicksight_username(role_arn, owner_id),
        ).get("User", {})
    except quicksight.exceptions.ResourceNotFoundException:
        try:
            user = quicksight.register_user(
                AwsAccountId=account_id,
                Namespace="default",
                IdentityType="IAM",
                IamArn=role_arn,
                SessionName=username,
                UserRole="READER",
                Email=reader_email(owner_id),
            ).get("User", {})
        except quicksight.exceptions.ResourceExistsException:
            # Concurrent first visits can both observe a missing user. The
            # deterministic identity makes the loser an idempotent success.
            user = quicksight.describe_user(
                AwsAccountId=account_id,
                Namespace="default",
                UserName=reader_quicksight_username(role_arn, owner_id),
            ).get("User", {})

    actual_arn = user.get("Arn")
    if actual_arn and actual_arn != expected_arn:
        raise HTTPException(
            503,
            "The registered Quick Reader identity does not match the configured RLS principal.",
            headers={"X-Error-Code": "QUICKSIGHT_READER_IDENTITY_MISMATCH"},
        )
    return actual_arn or expected_arn


def _ensure_dashboard_group_membership(quicksight, account_id: str, owner_id: str) -> None:
    """Ensure the Reader can open the dashboard shared with the app's Reader group."""
    try:
        quicksight.create_group_membership(
            AwsAccountId=account_id,
            Namespace="default",
            GroupName=settings.quicksight_reader_group_name,
            MemberName=reader_quicksight_username(settings.quicksight_embedding_role_arn, owner_id),
        )
    except quicksight.exceptions.ResourceExistsException:
        pass


@router.get("/embed-url")
def quick_dashboard_embed_url(
    request: Request,
    response: Response,
    owner_id: str = Depends(current_user_id),
) -> dict[str, str | int]:
    """Provision/reuse the app user's Reader and mint a registered-user URL."""
    account_id = settings.quicksight_account_id
    dashboard_id = settings.quicksight_dashboard_id
    dataset_ids = (settings.quicksight_quality_dataset_id, settings.quicksight_inspection_dataset_id)
    role_arn = settings.quicksight_embedding_role_arn
    permissions_arn = settings.quicksight_rls_permissions_dataset_arn
    if (
        not account_id
        or not dashboard_id
        or any(not value for value in dataset_ids)
        or not role_arn
        or not permissions_arn
    ):
        raise HTTPException(
            503,
            "Registered Quick dashboard access is not configured yet.",
            headers={"X-Error-Code": "QUICKSIGHT_NOT_CONFIGURED"},
        )
    if role_arn.split(":")[4] != account_id:
        raise HTTPException(
            503,
            "The QuickSight Reader role must belong to the configured QuickSight account.",
            headers={"X-Error-Code": "QUICKSIGHT_ROLE_ACCOUNT_MISMATCH"},
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

    try:
        # The Lambda's execution role is intentionally separate from the IAM
        # role registered as each QuickSight Reader. Assume the configured
        # Reader role before making any QuickSight API calls so all of those
        # calls use the permissions granted to the Reader integration role.
        assumed = get_session().client("sts", config=get_client_config()).assume_role(
            RoleArn=role_arn,
            RoleSessionName=reader_username(owner_id),
            DurationSeconds=900,
        )["Credentials"]
        reader_quicksight = get_assumed_reader_quicksight_client(assumed)

        for dataset_id in dataset_ids:
            dataset = reader_quicksight.describe_data_set(
                AwsAccountId=account_id,
                DataSetId=dataset_id,
            ).get("DataSet", {})
            if not _user_rls_is_enabled(dataset, permissions_arn):
                raise HTTPException(
                    503,
                    "Quick dashboard access is paused until user-based owner security is enabled on every dashboard dataset.",
                    headers={"X-Error-Code": "QUICKSIGHT_RLS_NOT_READY"},
                )

        user_arn = _ensure_reader(reader_quicksight, account_id, owner_id)
        _ensure_dashboard_group_membership(reader_quicksight, account_id, owner_id)
        result = reader_quicksight.generate_embed_url_for_registered_user(
            AwsAccountId=account_id,
            UserArn=user_arn,
            ExperienceConfiguration={"Dashboard": {"InitialDashboardId": dashboard_id}},
            SessionLifetimeInMinutes=60,
            AllowedDomains=[origin],
        )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        if code == "UnsupportedPricingPlanException":
            raise HTTPException(
                503,
                "QuickSight rejected registered-user embedding for this account's current pricing plan. Check that the Reader subscription is active.",
                headers={"X-Error-Code": "QUICKSIGHT_READER_PLAN_REQUIRED"},
            ) from error
        if code == "UnsupportedUserEditionException":
            raise HTTPException(
                503,
                "Registered Quick dashboard embedding requires an eligible QuickSight Enterprise subscription.",
                headers={"X-Error-Code": "QUICKSIGHT_ENTERPRISE_REQUIRED"},
            ) from error
        raise
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return {
        "embed_url": result["EmbedUrl"],
        "embed_url_valid_for_seconds": 300,
        "session_lifetime_minutes": 60,
        "access_model": "registered_reader",
    }
