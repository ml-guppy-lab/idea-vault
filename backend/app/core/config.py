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

    # CORS
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]


settings = Settings()
