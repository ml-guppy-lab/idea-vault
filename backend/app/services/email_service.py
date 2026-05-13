"""Transactional email via Resend.

All functions are async — they use resend's native async client (send_async)
which is backed by httpx, so they never block the FastAPI event loop.

The API key is read once at import time from settings. Resend is idempotent-
safe: if the same email is sent twice the user just gets two emails, which is
acceptable for this use case.

COMMON DELIVERY ISSUE:
  Resend silently rejects sends from unverified sender domains.
  In development use EMAIL_FROM=onboarding@resend.dev (Resend's shared test
  sender, no domain setup needed). In production verify your domain at
  https://resend.com/domains then set EMAIL_FROM to your verified address.
"""

import logging
import resend

from app.core.config import settings

logger = logging.getLogger(__name__)

# Set the global API key. Resend reads this on every send() call.
resend.api_key = settings.RESEND_API_KEY


def _resolve_to(real_email: str) -> str:
    """Return the actual delivery address.

    In development, EMAIL_OVERRIDE_TO routes all emails to the Resend account
    owner's address (the only address Resend delivers to without a verified
    domain). In production this setting is empty and the real address is used.
    """
    override = settings.EMAIL_OVERRIDE_TO.strip()
    if override:
        logger.debug("Email override active: routing %s → %s", real_email, override)
        return override
    return real_email


async def send_verification_email(to_email: str, token: str) -> None:
    """Send an email-verification link to a newly registered user.

    The raw token (not the hash) is embedded in the link. It expires in 24 h.
    Errors are logged but NOT re-raised — registration must not fail because
    of an email-delivery issue. The user can request a resend from the login page.
    """
    logger.info("[email] send_verification_email triggered for %s", to_email)
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token}"

    delivery_to = _resolve_to(to_email)
    logger.info("[email] delivery address resolved to %s", delivery_to)
    logger.debug("[email] verify URL: %s", verify_url)
    try:
        await resend.Emails.send_async(
            {
                "from": settings.EMAIL_FROM,
                "to": [delivery_to],
                "subject": "Verify your Idea Vault account",
                "html": f"""
                    <p>Thanks for signing up for <strong>Idea Vault</strong>!</p>
                    <p>Click the button below to verify your email address.
                       The link expires in <strong>24 hours</strong>.</p>
                    <p>
                        <a href="{verify_url}"
                           style="display:inline-block;padding:12px 24px;
                                  background:#6366f1;color:#fff;border-radius:6px;
                                  text-decoration:none;font-weight:bold;">
                            Verify Email
                        </a>
                    </p>
                    <p>Or copy and paste this URL:<br>
                       <a href="{verify_url}">{verify_url}</a></p>
                    <p style="color:#888;font-size:12px;">
                        If you didn't create an account, you can safely ignore this email.
                    </p>
                """,
            }
        )
        logger.info("Verification email sent to %s (delivered to %s)", to_email, delivery_to)
    except Exception:
        # Log the full traceback so the error is visible in Docker logs
        # (docker compose logs backend). Never re-raise — email failure must
        # not roll back account creation.
        logger.exception(
            "Failed to send verification email to %s — "
            "check RESEND_API_KEY and that EMAIL_FROM domain is verified in Resend",
            to_email,
        )


async def send_password_reset_email(to_email: str, token: str) -> None:
    """Send a password-reset link to a user who requested it.

    The raw token is embedded in the link. It expires in 1 h.
    Errors are logged but NOT re-raised (forgot-password always returns 200).
    """
    logger.info("[email] send_password_reset_email triggered for %s", to_email)
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"

    delivery_to = _resolve_to(to_email)
    logger.info("[email] delivery address resolved to %s", delivery_to)
    try:
        await resend.Emails.send_async(
            {
                "from": settings.EMAIL_FROM,
                "to": [delivery_to],
                "subject": "Reset your Idea Vault password",
                "html": f"""
                    <p>You requested a password reset for your <strong>Idea Vault</strong> account.</p>
                    <p>Click the button below to set a new password.
                       The link expires in <strong>1 hour</strong>.</p>
                    <p>
                        <a href="{reset_url}"
                           style="display:inline-block;padding:12px 24px;
                                  background:#6366f1;color:#fff;border-radius:6px;
                                  text-decoration:none;font-weight:bold;">
                            Reset Password
                        </a>
                    </p>
                    <p>Or copy and paste this URL:<br>
                       <a href="{reset_url}">{reset_url}</a></p>
                    <p style="color:#888;font-size:12px;">
                        If you didn't request this, you can safely ignore this email.
                        Your password will not be changed.
                    </p>
                """,
            }
        )
        logger.info("Password reset email sent to %s (delivered to %s)", to_email, delivery_to)
    except Exception:
        logger.exception(
            "Failed to send password reset email to %s", to_email
        )
