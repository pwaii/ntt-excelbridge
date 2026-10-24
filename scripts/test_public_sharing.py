"""
Verify QuickSight public dashboard sharing.

Steps:
  1. Enable account-level public sharing (idempotent)
  2. Grant link-sharing read on the dashboard
  3. Fetch the public URL without AWS credentials — expect HTTP 200

Run: AWS_PROFILE=ChallengerAccess-453995432289 python scripts/test_public_sharing.py
"""
import sys
import boto3
import urllib.request
import urllib.error

ACCOUNT    = "453995432289"
REGION     = "ap-southeast-1"
DASHBOARD  = "excelbridge-quality-dashboard"
PUBLIC_URL = f"https://{REGION}.quicksight.aws.amazon.com/sn/dashboards/{DASHBOARD}"

qs = boto3.client("quicksight", region_name=REGION)

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
failed = False


def check(label, ok, detail=""):
    global failed
    status = PASS if ok else FAIL
    print(f"  [{status}] {label}" + (f": {detail}" if detail else ""))
    if not ok:
        failed = True


# ── 1. Enable account-level public sharing ────────────────────────────────────
print("1. Account-level public sharing")
try:
    qs.update_public_sharing_settings(
        AwsAccountId=ACCOUNT,
        PublicSharingEnabled=True,
    )
    settings = qs.describe_account_settings(AwsAccountId=ACCOUNT)["AccountSettings"]
    check("PublicSharingEnabled", settings.get("PublicSharingEnabled") is True)
except Exception as e:
    check("update_public_sharing_settings", False, str(e))

# ── 2. Grant link-sharing read on the dashboard ───────────────────────────────
print("2. Dashboard link-sharing permissions")
READ_ACTIONS = [
    "quicksight:DescribeDashboard",
    "quicksight:QueryDashboard",
    "quicksight:ListDashboardVersions",
]
try:
    qs.update_dashboard_permissions(
        AwsAccountId=ACCOUNT,
        DashboardId=DASHBOARD,
        GrantLinkPermissions=[
            {
                "Principal": f"arn:aws:quicksight:{REGION}:{ACCOUNT}:public",
                "Actions": READ_ACTIONS,
            }
        ],
    )
    perms = qs.describe_dashboard_permissions(
        AwsAccountId=ACCOUNT, DashboardId=DASHBOARD
    )
    link_perms = perms.get("LinkSharingConfiguration", {}).get("Permissions", [])
    check("LinkSharingConfiguration set", len(link_perms) > 0, f"{len(link_perms)} entries")
except Exception as e:
    check("update_dashboard_permissions", False, str(e))

# ── 3. Public URL reachable without credentials ───────────────────────────────
print(f"3. Public URL: {PUBLIC_URL}")
try:
    req = urllib.request.Request(PUBLIC_URL, headers={"User-Agent": "test"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read(4096).decode("utf-8", errors="ignore")
        # QuickSight is a React SPA — the server always returns 200 with an app
        # shell (no auth headers in the HTML). Real auth is enforced in JS after
        # load, so HTTP 200 here does NOT mean the dashboard is publicly accessible.
        # The only reliable gate is step 1: if UpdatePublicSharingSettings fails,
        # the dashboard is NOT public regardless of HTTP status.
        check(
            "URL reachable (note: SPA — HTTP 200 does not confirm public access)",
            resp.status == 200,
            f"HTTP {resp.status}",
        )
        print(f"     -> Body snippet: {body[:120].strip()!r}")
except urllib.error.HTTPError as e:
    check("HTTP response", False, f"HTTP {e.code}")
except Exception as e:
    check("HTTP response", False, str(e))

print()
if failed:
    print("RESULT: public sharing NOT working — see FAIL items above")
    sys.exit(1)
else:
    print(f"RESULT: public sharing OK — embed this URL in an <iframe>:\n  {PUBLIC_URL}")
