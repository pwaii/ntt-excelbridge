"""Day-6 AI: offline test for CachingBedrockClient. No real boto — a fake inner client
counts invocations to prove hit/miss behavior; cache dir is monkeypatched to tmp_path."""
import app.ai.cache as cache_mod
from app.ai.cache import CachingBedrockClient


class FakeInner:
    def __init__(self):
        self.calls = 0

    def converse_json(self, model_id, prompt, max_tokens, temperature=0.0):
        self.calls += 1
        return ({"ok": self.calls}, f"raw{self.calls}",
                {"inputTokens": 1, "outputTokens": 2}, 42)


def test_miss_then_hit(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_mod, "CACHE_DIR", tmp_path)
    inner = FakeInner()
    c = CachingBedrockClient(inner=inner)

    r1 = c.converse_json("m", "p", 8)
    assert inner.calls == 1                       # miss → inner called
    key = cache_mod.sha256_hex("m" + "\x00" + "p")
    assert (tmp_path / f"{key}.json").exists()    # stored

    r2 = c.converse_json("m", "p", 8)
    assert inner.calls == 1                        # hit → inner NOT called again
    assert r2 == r1                                # same tuple round-tripped


def test_different_prompt_is_a_miss(tmp_path, monkeypatch):
    monkeypatch.setattr(cache_mod, "CACHE_DIR", tmp_path)
    inner = FakeInner()
    c = CachingBedrockClient(inner=inner)
    c.converse_json("m", "p1", 8)
    c.converse_json("m", "p2", 8)
    assert inner.calls == 2
