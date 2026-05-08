import json

from pydantic import field_validator
import json

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
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15        # short-lived JWT
    REFRESH_TOKEN_EXPIRE_DAYS: int = 180         # long-lived opaque token stored in DB

    # MongoDB
    MONGO_URI: str = "mongodb://idea_user:idea_pass@localhost:27017/idea_vault?authSource=admin"
    MONGO_DB_NAME: str = "idea_vault"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # Rate limiting (applied to /auth/login and /auth/register)
    RATE_LIMIT_MAX_ATTEMPTS: int = 5    # max requests allowed per window
    RATE_LIMIT_WINDOW_SECONDS: int = 900  # 15 minutes in 

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
        return vseconds

    # CORS
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
    # Must match exactly what is registered in Google Cloud Console
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"
    # Where the backend redirects the browser after OAuth succeeds
    FRONTEND_URL: str = "http://localhost:3000"


settings = Settings()
