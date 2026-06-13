"""
Embedding service — abstraction layer for text-to-vector conversion.

Uses Hugging Face Inference Providers via the official `huggingface_hub`
client so the backend does not load any local embedding model into memory.

The abstraction allows swapping providers in the future by:
  1. Adding a new provider to EmbeddingProvider enum
  2. Implementing generate_embedding() for that provider
  3. Changing EMBEDDING_PROVIDER in .env
"""

from functools import lru_cache

from huggingface_hub import InferenceClient

from app.core.config import settings


class EmbeddingProvider(str):
    """Supported embedding providers."""
    HUGGINGFACE = "huggingface"
    # COHERE = "cohere"  # ready for future use
    # OPENAI = "openai"  # ready for future use


_HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


@lru_cache(maxsize=1)
def get_huggingface_client() -> InferenceClient:
    """
    Create the Hugging Face client once and cache it.

    InferenceClient talks to the supported Hugging Face routed inference API,
    which avoids depending on the deprecated api-inference hostname directly.
    """
    if not settings.HUGGINGFACE_API_TOKEN:
        raise ValueError(
            "HUGGINGFACE_API_TOKEN is not set. "
            "Get a free token from https://huggingface.co/settings/tokens"
        )
    return InferenceClient(
        provider="hf-inference",
        api_key=settings.HUGGINGFACE_API_TOKEN,
        model=_HF_MODEL,
    )


def generate_embedding(text: str) -> list[float]:
    """
    Convert text into a vector embedding using Hugging Face Inference Providers.

    Returns a list of 384 floats representing the semantic meaning of the text.
    Uses the sentence-transformers all-MiniLM-L6-v2 model.
    """
    client = get_huggingface_client()
    embedding = client.feature_extraction(text, model=_HF_MODEL)
    return embedding.tolist() if hasattr(embedding, "tolist") else list(embedding)


def generate_query_embedding(text: str) -> list[float]:
    """
    Convert a search query into a vector embedding.

    Uses the same model as generate_embedding().
    """
    return generate_embedding(text)


def generate_idea_embedding(title: str, summary: str = "") -> list[float]:
    """
    Generate an embedding for a complete idea.

    Combines title and summary for richer semantic meaning. This is the embedding
    stored in MongoDB and later queried against during semantic search.
    """
    combined_text = f"{title}. {summary}".strip()
    return generate_embedding(combined_text)
