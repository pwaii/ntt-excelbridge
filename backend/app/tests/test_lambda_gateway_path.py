from app.main import _api_gateway_base_path


def test_named_stage_is_stripped_when_present_in_raw_path() -> None:
    event = {"rawPath": "/demo/health", "requestContext": {"stage": "demo"}}

    assert _api_gateway_base_path(event) == "/demo"


def test_named_stage_is_not_stripped_when_raw_path_has_no_stage() -> None:
    event = {"rawPath": "/health", "requestContext": {"stage": "demo"}}

    assert _api_gateway_base_path(event) == "/"


def test_default_stage_has_no_base_path() -> None:
    event = {"rawPath": "/health", "requestContext": {"stage": "$default"}}

    assert _api_gateway_base_path(event) == "/"
