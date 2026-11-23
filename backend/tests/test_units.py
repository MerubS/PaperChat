import pytest

from app.citations import Passage, extract_citations, format_passages
from app.security import HttpError, RateLimiter, check_access_code, client_ip, stale_namespaces, new_document_id


def test_citations_renumber_and_drop_invalid():
    ps = [Passage("a", 1), Passage("b", 2), Passage("c", 3), Passage("d", 7)]
    text, cites = extract_citations("Twelve took part [4]. They used AAC [2, 4] [9].", ps)
    assert text == "Twelve took part [1]. They used AAC [2][1]."
    assert [(c["id"], c["page"], c["quote"]) for c in cites] == [(1, 7, "d"), (2, 2, "b")]
    assert format_passages(ps[:2], start=3) == "[3] (page 1)\na\n\n---\n\n[4] (page 2)\nb"


def test_access_code_constant_time_and_optional():
    check_access_code(None, None)
    with pytest.raises(HttpError):
        check_access_code("x", "secret")
    check_access_code("secret", "secret")


def test_rate_limiter_window():
    rl = RateLimiter(2, 10)
    rl.check("a", 0); rl.check("a", 1)
    with pytest.raises(HttpError) as e:
        rl.check("a", 2)
    assert e.value.status == 429 and e.value.headers["Retry-After"] == "9"
    rl.check("a", 11)


def test_client_ip_prefers_cloudfront_header():
    assert client_ip({"cloudfront-viewer-address": "203.0.113.9:443", "x-forwarded-for": "6.6.6.6"}) == "203.0.113.9"
    assert client_ip({"cloudfront-viewer-address": "[2001:db8::1]:443"}) == "[2001:db8::1]"


def test_stale_namespaces_only_old_uploads():
    now = 1_800_000_000_000
    old, fresh = new_document_id(now - 25 * 3600_000), new_document_id(now - 3600_000)
    assert stale_namespaces(["aac", "eval-aac", old, fresh, ""], now, 24) == [old]
