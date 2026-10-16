"""Model preflight (§7.1/§19): prove every allowlisted model is actually invocable in this
region — entitled, non-Marketplace, and SCP-clear. list-foundation-models is NOT
authoritative in this account (it lists models an org SCP then blocks on invoke), so we do
a minimal real converse per model instead.

Run:
    AWS_PROFILE=ChallengerAccess-453995432289 AWS_REGION=us-east-1 python -m scripts.preflight

Use BARE model ids in us-east-1. Inference-profile ids (us./apac.) fan out to an
SCP-denied region and fail — see memory/bedrock-access-us-east-1-bare-ids.md.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # make `app` importable

from botocore.exceptions import BotoCoreError, ClientError

from app.ai.bedrock_client import MODEL_ALLOWLIST, BedrockClient
from app.settings import settings


def check(model_id: str) -> bool:
    """True if the model answered at all (entitled + non-Marketplace + SCP-clear). A
    ValueError from JSON extraction still counts — the model responded; we only care that
    the invoke itself was permitted."""
    try:
        BedrockClient().converse_json(model_id, "ping", max_tokens=8)
    except ValueError:
        return True  # model returned text (maybe non-JSON) → invoke was allowed
    except ClientError as e:
        msg = e.response["Error"]["Message"]
        print(f"  FAIL {model_id}: {e.response['Error']['Code']}: {msg}")
        if "marketplace" in msg.lower():
            print("  hint: Marketplace-gated — forbidden by the no-Marketplace budget rule.")
        else:
            print("  hint: not entitled / SCP deny. Use a BARE id in us-east-1 (not us./apac.).")
        return False
    except BotoCoreError as e:
        print(f"  FAIL {model_id}: AWS client error (likely no/expired creds): {e}")
        print("  hint: aws sso login --profile ChallengerAccess-453995432289")
        return False
    return True


def main() -> int:
    print(f"preflight region={settings.aws_region} models={sorted(MODEL_ALLOWLIST)}")
    results = [check(m) for m in sorted(MODEL_ALLOWLIST)]  # list, not all() — run every model
    ok = all(results)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
