import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import ARRAY, Boolean, Date, DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.postgres import Base


class AuthProvider(str, enum.Enum):
    local = "local"
    google = "google"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    hashed_password: Mapped[str | None] = mapped_column(
        String, nullable=True  # nullable for OAuth users who have no password
    )
    auth_provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider, name="auth_provider_enum"),
        nullable=False,
        default=AuthProvider.local,
    )
    google_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    auth_providers: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Profile fields (optional — filled in by user on profile page)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bio: Mapped[str | None] = mapped_column(String(500), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(30), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Email verification — set to True when the user clicks the link in their inbox.
    # Google OAuth users are pre-verified (Google already verified their email).
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # SHA-256 hash of the one-time email verification token (raw token sent in link).
    # Storing the hash (not plaintext) means a DB dump cannot be used to verify emails.
    verification_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_token_expires: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # SHA-256 hash of the one-time password-reset token. Same rationale as above.
    reset_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reset_token_expires: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
