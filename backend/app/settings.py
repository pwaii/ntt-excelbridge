"""Runtime configuration loaded from env. See .env.example and docs/backend-plan.md (§7)."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    aws_region: str = "us-east-1"
    environment: str = "demo"

    bedrock_model_id: str = ""
    bedrock_max_tokens: int = 2048
    bedrock_temperature: float = 0.0

    app_data_bucket: str = ""
    dynamo_table: str = "xlsx-workflow"
    state_machine_arn: str = ""

    cognito_user_pool_id: str = ""
    cognito_app_client_id: str = ""

    # Demo guardrails (§15)
    max_workbook_mb: int = 25
    max_data_rows: int = 50_000
    max_jobs_per_day: int = 50
    presigned_url_ttl_seconds: int = 300


settings = Settings()
