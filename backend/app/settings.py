"""Runtime configuration loaded from the repository .env or deployment env."""
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    aws_region: str = "us-east-1"
    aws_profile: str | None = None
    environment: str = "demo"

    bedrock_model_id: str = "amazon.nova-lite-v1:0"        # most tools
    bedrock_model_id_heavy: str = "amazon.nova-pro-v1:0"   # tools #3/#4 reasoning
    bedrock_max_tokens: int = 2048
    # Tool #5 emits one JSON match object per unresolved row; a large set needs a bigger
    # output budget and must be paged so the response never truncates mid-array (AI-004).
    bedrock_max_tokens_tool5: int = 8192
    max_tool5_rows: int = 25
    bedrock_temperature: float = 0.0

    app_data_bucket: str = ""
    s3_prefix: str = "jobs"
    dynamo_table: str = "xlsx-workflow"
    state_machine_arn: str = ""
    job_ttl_days: int = 14
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    cognito_user_pool_id: str = ""
    cognito_app_client_id: str = ""
    cognito_api_token_type: Literal["access", "id"] = "access"

    # Demo guardrails (§15)
    max_workbook_mb: int = 25
    max_data_rows: int = 50_000
    max_jobs_per_day: int = 50
    presigned_url_ttl_seconds: int = 300
    max_samples_per_column: int = 20    # §15 cap — placeholder, confirm with team
    max_candidate_matches: int = 5      # ADR D6: recall-biased Tool #5 candidate cap


settings = Settings()
