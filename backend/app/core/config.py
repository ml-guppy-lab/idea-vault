import json

import cloudinary
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    APP_NAME: str = "Idea Vault"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # Observability — Sentry error tracking. Fully inert when SENTRY_DSN is empty,
    # so local dev and tests are unaffected until a DSN is provided (e.g. on Render).
    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "development"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1
    SENTRY_RELEASE: str = ""

    # Langfuse — LLM observability (traces + user feedback). Inert unless BOTH
    # keys are set. Both live server-side; nothing Langfuse-related is exposed to
    # the browser (feedback scores are written from the backend).
    LANGFUSE_PUBLIC_KEY: str = ""
    LANGFUSE_SECRET_KEY: str = ""
    LANGFUSE_HOST: str = "https://cloud.langfuse.com"

    # Database (PostgreSQL)
    DATABASE_URL: str = "postgresql+asyncpg://idea_user:idea_pass@localhost:5432/idea_vault_auth"

    # Security
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 180

    # MongoDB
    MONGO_URI: str = "mongodb://idea_user:idea_pass@localhost:27017/idea_vault?authSource=admin"
    MONGO_DB_NAME: str = "idea_vault"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Rate limiting
    RATE_LIMIT_MAX_ATTEMPTS: int = 5
    RATE_LIMIT_WINDOW_SECONDS: int = 900

    # CORS — accepts JSON array OR plain comma-separated string from env
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: object) -> list[str]:
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                return json.loads(v)
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"
    FRONTEND_URL: str = "http://localhost:3000"

    # Resend — transactional email
    RESEND_API_KEY: str = ""
    # Use a verified sender domain in production, e.g. "Idea Vault <noreply@yourdomain.com>"
    EMAIL_FROM: str = "Idea Vault <onboarding@resend.dev>"
    # Dev-only override: when set, ALL outgoing emails are delivered to this
    # address instead of the real recipient. Remove in production.
    EMAIL_OVERRIDE_TO: str = ""

    # LLM — switch providers by changing LLM_PROVIDER in .env
    # Supported: "ollama" (local) | "openrouter" (deployed) | "openai" | "anthropic"
    LLM_PROVIDER: str = "ollama"
    # Ollama base URL — override in docker-compose to reach the Mac host.
    # Local (outside Docker): http://localhost:11434/v1
    # Inside Docker:          http://host.docker.internal:11434/v1
    LLM_OLLAMA_BASE_URL: str = "http://localhost:11434/v1"
    LLM_OLLAMA_MODEL: str = "qwen3:14b"
    LLM_OPENROUTER_MODEL: str = "google/gemma-4-31b-it:free"
    # Fallback used automatically when the primary model is rate-limited (429).
    # gpt-oss-120b is a 117B MoE model — low latency (5.1B active params) + native CoT.
    LLM_OPENROUTER_FALLBACK_MODEL: str = "openai/gpt-oss-120b:free"

    # Embeddings — HuggingFace Inference API (zero memory footprint on server)
    EMBEDDING_PROVIDER: str = "huggingface"
    HUGGINGFACE_API_TOKEN: str = ""
    # Fast/small models used exclusively for intent classification (cheap, low-latency).
    LLM_CLASSIFIER_MODEL_OLLAMA: str = "qwen3:4b"
    LLM_CLASSIFIER_MODEL_OPENROUTER: str = "openai/gpt-oss-20b:free"
    LLM_OPENAI_MODEL: str = "gpt-4o-mini"
    LLM_ANTHROPIC_MODEL: str = "claude-3-5-haiku-20241022"
    OPENROUTER_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    # Cross-provider LLM failover (all free tiers, all OpenAI-compatible).
    # When LLM_PROVIDER=openrouter, generation/classifier calls try
    # Cerebras → Groq → OpenRouter in order, spilling over on rate-limit/5xx.
    # Each provider is a separate account = a separate rate-limit bucket, so
    # capacity stacks. Only providers whose API key is set are included, so this
    # is safe to enable incrementally (set one key, or all three).
    GROQ_API_KEY: str = ""
    CEREBRAS_API_KEY: str = ""
    LLM_GROQ_MODEL_STANDARD: str = "llama-3.3-70b-versatile"
    LLM_GROQ_MODEL_FAST: str = "llama-3.1-8b-instant"
    LLM_CEREBRAS_MODEL_STANDARD: str = "llama-3.3-70b"
    LLM_CEREBRAS_MODEL_FAST: str = "llama3.1-8b"

    # Cloudinary — image storage
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    def configure_cloudinary(self) -> None:
        """Configure the Cloudinary SDK with credentials from settings.

        Called once at app startup (lifespan). All subsequent calls to
        cloudinary.uploader.upload / destroy will use these credentials.
        """
        cloudinary.config(
            cloud_name=self.CLOUDINARY_CLOUD_NAME,
            api_key=self.CLOUDINARY_API_KEY,
            api_secret=self.CLOUDINARY_API_SECRET,
            secure=True,  # Always use HTTPS URLs
        )


settings = Settings()
