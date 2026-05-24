"""
test_model_tiering.py — verify model selection per intent at runtime.

Run from backend/:
    python testFiles/test_model_tiering.py
    python testFiles/test_model_tiering.py --provider openrouter
"""

import os, sys, argparse

sys.path.insert(0, ".")

parser = argparse.ArgumentParser()
parser.add_argument("--provider", default=None, help="ollama | openrouter (overrides .env)")
args = parser.parse_args()

if args.provider:
    os.environ["LLM_PROVIDER"] = args.provider

from app.core.llm_config import llm_config, ModelTier, select_tier_for_intent

INTENTS = ["CONVERSATIONAL", "LISTING", "COUNT", "SEMANTIC_SEARCH"]

print(f"\nProvider  : {llm_config.provider.value}")
print(f"Primary   : {llm_config.model}")
print(f"Classifier: {llm_config.classifier_model}")
print(f"Fallback  : {llm_config.fallback_model or '—'}")
print()
print(f"{'Intent':<20} {'Tier':<10} {'Model'}")
print("-" * 65)
for intent in INTENTS:
    tier = select_tier_for_intent(intent)
    model = llm_config.model_for_tier(tier)
    print(f"{intent:<20} {tier.value:<10} {model}")

print()
# Sanity checks
assert llm_config.model_for_tier(ModelTier.FAST) != llm_config.model_for_tier(ModelTier.STANDARD), \
    "FAIL: FAST and STANDARD resolve to the same model — check _MODEL_TIER_MAP"

for fast_intent in ("CONVERSATIONAL", "LISTING", "COUNT"):
    assert select_tier_for_intent(fast_intent) == ModelTier.FAST, f"FAIL: {fast_intent} not FAST"
assert select_tier_for_intent("SEMANTIC_SEARCH") == ModelTier.STANDARD, "FAIL: SEMANTIC_SEARCH not STANDARD"

print("All assertions passed.")
