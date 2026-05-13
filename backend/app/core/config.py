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
