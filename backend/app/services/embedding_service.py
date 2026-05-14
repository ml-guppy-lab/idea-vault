from sentence_transformers import SentenceTransformer
from functools import lru_cache


# all-MiniLM-L6-v2: ~90 MB, 384-dim vectors, 256-token limit (~1 300 chars /
# ~190 words). Chosen for fast cold-start on serverless hosting and high
# retrieval quality for short English text. The summary field is intentionally
# capped at 190 words so embeddings are always dense signal with no truncation.
_MODEL_NAME = "all-MiniLM-L6-v2"


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    """Load once, cache forever in the process. First call ~1 s; all subsequent calls instant."""
    return SentenceTransformer(_MODEL_NAME)


def generate_embedding(text: str) -> list[float]:
    """Encode a plain string -> 384-dim float vector."""
    model = get_embedding_model()
    return model.encode(text).tolist()


def generate_idea_embedding(title: str, summary: str) -> list[float]:
    # Title anchors the topic; summary provides semantic depth.
    # Tags are used as $vectorSearch pre-filters, not embedded.
    """
    Embed an idea's title and summary fields.

    The summary is the single source of truth for vector search:
    - User is constrained to ≤190 words on the frontend
    - Backend schema enforces max_length=1300 chars as a safety net
    - Description (unlimited length) is stored for display but never embedded
    This design avoids chunking complexity and produces high-quality, dense vectors.
    """
    # Strip to be safe; the frontend already enforces the word limit
    combined = f"{title}. {summary}"
    return generate_embedding(combined.strip())
