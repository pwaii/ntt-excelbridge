"""Versioned prompt loader (§10.1, §14.3). Prompts live as prompts/<tool>.<version>.md.

Day 1: drafts only — these are reviewed as prose and pinned by version; they are
not wired to Bedrock until Day 2.
"""
from functools import lru_cache
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

TOOLS = (
    "tool1_semantics",
    "tool2_types",
    "tool3_formulas",
    "tool4_standardize",
    "tool5_update",
)


@lru_cache
def get_prompt(tool: str, version: str = "v1") -> str:
    return (PROMPTS_DIR / f"{tool}.{version}.md").read_text(encoding="utf-8")
