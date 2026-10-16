"""Throwaway smoke test: does real Nova Converse return JSON that parses into Tool1Output?

Not a pytest — it hits real Bedrock (costs money, needs creds). Run manually:

    cd backend
    python -m scripts.smoke_tool1                 # uses settings.bedrock_model_id
    BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0 python -m scripts.smoke_tool1

If you get "on-demand throughput isn't supported" or ResourceNotFound, retry with the
cross-region inference-profile id (us. prefix), e.g. us.amazon.nova-lite-v1:0.

Purpose: de-risk the one open question before building the Day-2 client — whether the
pinned Nova model actually emits parseable JSON for the Tool #1 draft prompt.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # make `app` importable

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import ValidationError

from app.ai.prompts import get_prompt
from app.domain.schemas import Tool1Output
from app.settings import settings

# Tiny fixture — the minimum evidence a real inspection manifest would supply (§14.3).
FIXTURE = {
    "comment_name": "customer loyalty tier",
    "output_header": "Tier",
    "current_headers": '["CustomerID", "LoyaltyLevel", "SpendYTD"]',
    "normalized_headers": '["customer_id", "loyalty_level", "spend_ytd"]',
    "main_headers": "[]",
    "type_summaries": '{"loyalty_level": "string (Gold/Silver/Bronze)", "spend_ytd": "number"}',
    "samples": '[{"cell": "B2", "value": "Gold"}, {"cell": "B3", "value": "Silver"}]',
}


def build_prompt() -> str:
    text = get_prompt("tool1_semantics")
    for key, value in FIXTURE.items():
        text = text.replace("{" + key + "}", value)  # targeted — keep JSON braces intact
    return text


def extract_json(text: str) -> dict:
    """Nova may wrap JSON in prose or ```json fences; take the outermost object."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in model output:\n{text}")
    return json.loads(text[start : end + 1])


def main() -> int:
    model_id = os.environ.get("BEDROCK_MODEL_ID", settings.bedrock_model_id)
    client = boto3.client(
        "bedrock-runtime",
        region_name=settings.aws_region,
        config=Config(retries={"max_attempts": 5, "mode": "adaptive"}),
    )
    prompt = build_prompt()
    print(f"model={model_id} region={settings.aws_region}")

    try:
        resp = client.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 512, "temperature": 0.0},
        )
    except ClientError as e:
        code = e.response["Error"]["Code"]
        print(f"FAIL: Bedrock call errored ({code}): {e.response['Error']['Message']}")
        if code in ("ValidationException", "ResourceNotFoundException", "AccessDeniedException"):
            print("hint: enable Nova model access in this region, or retry with "
                  "BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0 (inference profile).")
        return 1
    except BotoCoreError as e:
        print(f"FAIL: AWS client error (likely no/expired credentials): {e}")
        print("hint: run `aws login` or set AWS creds, then retry.")
        return 1

    text = resp["output"]["message"]["content"][0]["text"]
    usage = resp["usage"]
    print(f"tokens: {usage['inputTokens']} in / {usage['outputTokens']} out")

    try:
        parsed = Tool1Output(**extract_json(text))
    except (ValueError, ValidationError) as e:
        print(f"FAIL: model output did not parse into Tool1Output:\n{e}\n---\n{text}")
        return 1

    print(f"PASS: status={parsed.status} confidence={parsed.confidence} "
          f"matches={[m.column_id for m in parsed.existing_column_matches]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
