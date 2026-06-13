## Idea Vault — Version 4 Implementation Notes

---

## Embeddings: Local Model -> API

### Why
The old embedding setup loaded `sentence-transformers/all-MiniLM-L6-v2` inside the backend process. That was fine locally, but it pushed the server too close to Render's memory limit and caused OOM crashes.

### What we tried first
We tried Cohere and then Hugging Face raw API calls. Both worked in theory, but the network path was not reliable in this environment, so the backfill could not complete consistently.

### Final approach
We kept the embedding idea but moved the actual generation to Hugging Face Inference Providers through the official `huggingface_hub` client. That keeps the backend lightweight and avoids loading any local embedding model into memory.

### How it works now
- `generate_embedding()` creates a 384-dim embedding for idea text.
- `generate_query_embedding()` uses the same model for search queries.
- `generate_idea_embedding(title, summary)` combines the title and summary before embedding.
- The MongoDB Atlas vector index was rebuilt for `384` dimensions, with `userId` as the filter field.
- Existing ideas were reprocessed with `backend/scripts/backfill_embeddings.py` so all old MiniLM vectors were replaced.

### Files changed
- `backend/app/services/embedding_service.py` — switched to Hugging Face hosted embeddings
- `backend/app/core/config.py` — added `EMBEDDING_PROVIDER` and `HUGGINGFACE_API_TOKEN`
- `backend/requirements.txt` — added `huggingface_hub`
- `backend/scripts/backfill_embeddings.py` — re-embedded all existing ideas
- `backend/.env` — added Hugging Face token and embedding provider setting

### Result
The backend no longer loads a local embedding model, memory use is lower, and the idea search flow still works with the same semantic search pipeline.

---
