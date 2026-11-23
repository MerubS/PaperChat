"""Request guards: optional access code, per-IP rate limits, input validation, PDF checks."""
import hmac
import re
import time
import uuid
from collections import defaultdict

from . import config


class HttpError(Exception):
    """An error whose message is safe to show the client."""

    def __init__(self, status: int, message: str, headers: dict | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.headers = headers or {}


# ---------- Access code ----------

def check_access_code(provided: str | None, expected: str | None) -> None:
    """If an access code is configured, require it (constant-time comparison)."""
    if not expected:
        return
    if not provided or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HttpError(401, "Access code required.")


# ---------- Rate limiting ----------

class RateLimiter:
    """Sliding-window limiter in memory. Per Lambda container: it slows down abuse from
    one client, and Lambda's reserved concurrency (set in the CDK stack) caps the rest."""

    def __init__(self, limit: int, window_s: float):
        self.limit, self.window = limit, window_s
        self.hits: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        recent = [t for t in self.hits[key] if now - t < self.window]
        if len(recent) >= self.limit:
            retry = int(recent[0] + self.window - now) + 1
            self.hits[key] = recent
            wait = f"{-(-retry // 60)} minutes" if retry >= 120 else f"{retry} seconds"
            raise HttpError(429, f"Too many requests. Try again in {wait}.", {"Retry-After": str(retry)})
        recent.append(now)
        self.hits[key] = recent
        if len(self.hits) > 10_000:
            for k in [k for k, ts in self.hits.items() if not any(now - t < self.window for t in ts)]:
                del self.hits[k]


upload_limiter = RateLimiter(config.UPLOADS_PER_HOUR, 3600)
question_limiter = RateLimiter(config.QUESTIONS_PER_10_MIN, 600)


def client_ip(headers) -> str:
    """CloudFront-Viewer-Address is set by CloudFront and can't be spoofed by the client
    (unlike the first X-Forwarded-For entry)."""
    viewer = headers.get("cloudfront-viewer-address")
    if viewer:
        return viewer.rsplit(":", 1)[0]
    xff = headers.get("x-forwarded-for")
    return xff.split(",")[-1].strip() if xff else "unknown"


# ---------- Document IDs ----------
# "u-<createdAtMs>-<uuid>": the timestamp lets the sweeper find abandoned papers, and the
# format keeps the API away from other namespaces (e.g. the eval data).
DOC_ID = re.compile(r"^u-(\d{13})-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def new_document_id(now_ms: int | None = None) -> str:
    return f"u-{now_ms or int(time.time() * 1000)}-{uuid.uuid4()}"


def is_user_document_id(value) -> bool:
    return isinstance(value, str) and bool(DOC_ID.match(value))


def require_document_id(value) -> str:
    if not is_user_document_id(value):
        raise HttpError(400, "Invalid document ID.")
    return value


def stale_namespaces(names, now_ms: int, ttl_hours: float = config.DOCUMENT_TTL_HOURS) -> list[str]:
    """Upload-created namespaces older than the TTL. Never selects anything else."""
    out = []
    for ns in names:
        m = DOC_ID.match(ns or "")
        if m and now_ms - int(m.group(1)) > ttl_hours * 3600 * 1000:
            out.append(ns)
    return out


# ---------- Inputs ----------

def require_question(value) -> str:
    if not isinstance(value, str) or not value.strip():
        raise HttpError(400, "Missing question.")
    q = value.strip()
    if len(q) > config.MAX_QUESTION_CHARS:
        raise HttpError(400, f"Questions are limited to {config.MAX_QUESTION_CHARS} characters.")
    return q


def max_upload_bytes() -> int:
    return int(config.MAX_UPLOAD_MB * 1024 * 1024)


def check_declared_size(size) -> int:
    if not isinstance(size, int) or size <= 0:
        raise HttpError(400, "Missing file size.")
    if size > max_upload_bytes():
        raise HttpError(413, f"PDFs must be {config.MAX_UPLOAD_MB:g} MB or smaller.")
    return size


def validate_pdf_bytes(data: bytes) -> None:
    """Checks the real bytes (the %PDF- header within the first 1 KB), not the name or MIME type."""
    if not data:
        raise HttpError(400, "The file is empty.")
    if len(data) > max_upload_bytes():
        raise HttpError(413, f"PDFs must be {config.MAX_UPLOAD_MB:g} MB or smaller.")
    if b"%PDF-" not in data[:1024]:
        raise HttpError(415, "Only PDF files are supported.")


def check_page_count(pages: int) -> None:
    if pages > config.MAX_PDF_PAGES:
        raise HttpError(413, f"PDFs are limited to {config.MAX_PDF_PAGES} pages (this one has {pages}).")
    if pages == 0:
        raise HttpError(422, "Could not read any text from this PDF.")
