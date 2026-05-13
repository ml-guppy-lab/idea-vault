import asyncio

import cloudinary.uploader
import magic
from fastapi import HTTPException, UploadFile

# Allowlist of MIME types accepted for upload.
# Validated against magic bytes — NOT the file extension.
_ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

# 5 MB hard limit — enforced before upload to Cloudinary.
_MAX_FILE_SIZE = 5 * 1024 * 1024


async def validate_and_upload_image(
    file: UploadFile,
    user_id: str,
    folder: str = "idea-vault",
) -> str:
    """Validate an uploaded image and store it in Cloudinary.

    Security checks (in order):
      1. Size limit — rejects before any MIME sniffing to fail fast.
      2. Magic-byte MIME validation — ignores the file extension entirely,
         which prevents attackers from renaming a .exe to .jpg.
      3. Cloudinary upload — runs in a thread pool so it never blocks the
         async event loop.

    Returns the Cloudinary secure_url (HTTPS).
    """
    # --- 1. Read the file once into memory ---
    contents = await file.read()

    # --- 2. Size check ---
    if len(contents) > _MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 5 MB.",
        )

    # --- 3. Magic-byte MIME validation ---
    # magic.from_buffer inspects the actual byte signature of the file,
    # not its extension, so disguised executables are caught here.
    mime_type = magic.from_buffer(contents, mime=True)
    if mime_type not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.",
        )

    # --- 4. Upload to Cloudinary (blocking call → thread pool) ---
    # cloudinary.uploader.upload is synchronous; running it via asyncio.to_thread
    # keeps the FastAPI event loop unblocked during network I/O.
    # folder="{folder}/{user_id}" organises uploads per user in the dashboard.
    # unique_filename=True ensures Cloudinary generates a unique public_id,
    # preventing filename-collision attacks. Original filename is never used.
    try:
        result = await asyncio.to_thread(
            cloudinary.uploader.upload,
            contents,
            folder=f"{folder}/{user_id}",
            resource_type="image",
            unique_filename=True,
            overwrite=False,
            transformation=[
                {"quality": "auto"},       # quality optimisation
                {"fetch_format": "auto"},  # serve WebP to modern browsers
            ],
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Image upload failed. Please try again.",
        ) from exc

    return result["secure_url"]


async def delete_image(public_id: str) -> None:
    """Delete an image from Cloudinary by its public_id.

    Runs in a thread pool — cloudinary.uploader.destroy is synchronous.
    Errors are silently swallowed so that a stale/missing image never
    blocks the caller's primary operation (e.g. deleting an idea).
    """
    try:
        await asyncio.to_thread(cloudinary.uploader.destroy, public_id)
    except Exception:
        pass  # best-effort; caller should not fail because of a CDN cleanup error
