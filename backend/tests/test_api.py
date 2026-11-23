import io
import os

import pytest
from pypdf import PdfWriter

from conftest import PAPERS, FakeBedrock
from app import agent, config, security, vectors

AAC = os.path.join(PAPERS, "aac-paper.pdf")


def upload(env, data: bytes, headers=None):
    """Runs the real flow: get a presigned POST, put the object in (moto) S3, then ingest."""
    r = env.client.post("/api/upload-url", json={"size": len(data)}, headers=headers or {})
    assert r.status_code == 200, r.text
    body = r.json()
    env.s3.put_object(Bucket="paperchat-test-uploads", Key=body["upload"]["fields"]["key"], Body=data)
    return body["documentId"], env.client.post("/api/ingest", json={"documentId": body["documentId"]}, headers=headers or {})


def objects(env):
    return env.s3.list_objects_v2(Bucket="paperchat-test-uploads").get("KeyCount", 0)


def test_presigned_post_enforces_size_and_type(env):
    r = env.client.post("/api/upload-url", json={"size": 1234})
    post = r.json()["upload"]
    assert post["url"].startswith("https://paperchat-test-uploads.s3")
    assert post["fields"]["key"].startswith("uploads/u-") and post["fields"]["Content-Type"] == "application/pdf"
    assert "policy" in post["fields"]  # signed conditions: content-length-range + Content-Type


def test_ingest_and_agentic_query_with_citations(env):
    doc_id, r = upload(env, open(AAC, "rb").read())
    assert r.status_code == 200, r.text
    assert r.json()["pages"] == 15 and r.json()["chunks"] > 100
    assert objects(env) == 0, "uploaded PDF must be deleted after ingest"
    assert len(env.index.ns[doc_id]) == r.json()["chunks"]

    q = env.client.post("/api/query", json={"question": "How was the study conducted?", "documentId": doc_id})
    assert q.status_code == 200, q.text
    out = q.json()
    # Agent searched twice: the question, then its own follow-up query
    assert out["searches"] == ["How was the study conducted?", "participants interviews"]
    # [99] dropped; markers renumbered in order; every citation has a page and quote
    assert out["response"].startswith("The study interviewed AAC users [1].")
    assert "[99]" not in out["response"]
    assert [c["id"] for c in out["citations"]] == [1, 2]
    assert all(c["page"] >= 1 and c["quote"] for c in out["citations"])
    assert "contexts" not in out
    # Newer models reject sampling params: none are sent; the model comes from config
    for req in env.bedrock.requests:
        assert req["modelId"] == config.CHAT_MODEL_ID and set(req["inferenceConfig"]) == {"maxTokens"}


def test_agent_stops_searching_at_the_limit(env, monkeypatch):
    class AlwaysSearch(FakeBedrock):
        def converse(self, **kw):
            self.requests.append(kw)
            return {"stopReason": "tool_use", "output": {"message": {"role": "assistant", "content": [
                {"toolUse": {"toolUseId": f"t{len(self.requests)}", "name": "search_paper", "input": {"query": "more"}}}]}}}
    doc_id, _ = upload(env, open(AAC, "rb").read())
    monkeypatch.setattr(vectors, "_bedrock", AlwaysSearch())
    out = env.client.post("/api/query", json={"question": "What?", "documentId": doc_id}).json()
    assert len(out["searches"]) == 1 + config.MAX_AGENT_SEARCHES
    assert out["response"].startswith("I could not find")  # never answered: safe fallback, no crash
    last = vectors._bedrock.requests[-1]["messages"][-1]["content"][0]["toolResult"]["content"][0]["text"]
    assert "Search limit reached" in last


def test_agent_falls_back_when_model_has_no_tool_use(env, monkeypatch):
    doc_id, _ = upload(env, open(AAC, "rb").read())
    fake = FakeBedrock(reject_tools=True)
    monkeypatch.setattr(vectors, "_bedrock", fake)
    out = env.client.post("/api/query", json={"question": "What method?", "documentId": doc_id}).json()
    assert out["success"] and out["searches"] == ["What method?"] and out["citations"]
    assert "toolConfig" not in fake.requests[-1]


def test_non_pdf_rejected_and_deleted(env):
    _, r = upload(env, b"<html>not a pdf</html>")
    assert r.status_code == 415
    assert objects(env) == 0


def test_size_and_page_limits(env):
    r = env.client.post("/api/upload-url", json={"size": 11 * 1024 * 1024})
    assert r.status_code == 413
    assert env.client.post("/api/upload-url", json={}).status_code == 400

    w = PdfWriter()
    for _ in range(config.MAX_PDF_PAGES + 1):
        w.add_blank_page(width=612, height=792)
    buf = io.BytesIO(); w.write(buf)
    _, r = upload(env, buf.getvalue())
    assert r.status_code == 413 and "pages" in r.json()["error"]
    assert env.bedrock.calls == 0, "no embeddings paid for a rejected PDF"


def test_ids_and_inputs_validated(env):
    for bad in ["aac", "eval-aac", "../x", 5, None]:
        assert env.client.post("/api/query", json={"question": "hi", "documentId": bad}).status_code == 400
        assert env.client.post("/api/document", json={"documentId": bad}).status_code == 400
        assert env.client.post("/api/ingest", json={"documentId": bad}).status_code == 400
    good = security.new_document_id()
    assert env.client.post("/api/query", json={"question": "x" * 1001, "documentId": good}).status_code == 400
    assert env.client.post("/api/query", content=b"{oops", headers={"content-type": "application/json"}).status_code == 400
    assert env.client.post("/api/ingest", json={"documentId": good}).status_code == 404


def test_access_code(env, monkeypatch):
    monkeypatch.setenv("PAPERCHAT_ACCESS_CODE", "demo123")
    config.get_secret.cache_clear()
    assert env.client.post("/api/upload-url", json={"size": 10}).status_code == 401
    assert env.client.post("/api/upload-url", json={"size": 10}, headers={"x-access-code": "nope"}).status_code == 401
    assert env.client.post("/api/upload-url", json={"size": 10}, headers={"x-access-code": "demo123"}).status_code == 200
    # tab-close delete sends the code in the body
    assert env.client.post("/api/document", json={"documentId": security.new_document_id(), "accessCode": "demo123"}).status_code == 200


def test_rate_limit(env, monkeypatch):
    monkeypatch.setattr(security, "question_limiter", security.RateLimiter(2, 600))
    import app.main as main
    monkeypatch.setattr(main, "question_limiter", security.question_limiter)
    doc = security.new_document_id()
    h = {"cloudfront-viewer-address": "203.0.113.9:443"}
    codes = [env.client.post("/api/query", json={"question": "q", "documentId": doc}, headers=h).status_code for _ in range(3)]
    assert codes[2] == 429
    # a spoofed X-Forwarded-For doesn't get around it
    r = env.client.post("/api/query", json={"question": "q", "documentId": doc}, headers={**h, "x-forwarded-for": "1.2.3.4"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_delete_and_sweep(env):
    doc_id, _ = upload(env, open(AAC, "rb").read())
    assert env.client.post("/api/document", json={"documentId": doc_id}).json() == {"success": True}
    assert doc_id not in env.index.ns

    import time
    old = security.new_document_id(int((time.time() - 25 * 3600) * 1000))
    env.index.ns.update({old: {"a": {}}, "eval-aac": {"a": {}}})
    vectors._last_sweep = 0  # the ingest above already ran a sweep
    assert vectors.sweep_stale() == 1
    assert old not in env.index.ns and "eval-aac" in env.index.ns


def test_internal_errors_are_generic(env, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("pinecone: secret details")
    monkeypatch.setattr(vectors, "store", boom)
    _, r = upload(env, open(AAC, "rb").read())
    assert r.status_code == 500 and "secret" not in r.text
    assert objects(env) == 0


def test_lambda_handler_through_mangum(env):
    """The same app, invoked the way a Lambda Function URL invokes it."""
    import json
    from app.main import handler
    event = {
        "version": "2.0", "routeKey": "$default", "rawPath": "/api/upload-url", "rawQueryString": "",
        "headers": {"content-type": "application/json", "cloudfront-viewer-address": "198.51.100.1:1234"},
        "requestContext": {"http": {"method": "POST", "path": "/api/upload-url", "sourceIp": "1.1.1.1", "protocol": "HTTP/1.1", "userAgent": "t"},
                           "accountId": "1", "apiId": "x", "domainName": "x.lambda-url.us-east-1.on.aws", "domainPrefix": "x",
                           "requestId": "r", "stage": "$default", "time": "now", "timeEpoch": 0},
        "body": json.dumps({"size": 100}), "isBase64Encoded": False,
    }
    res = handler(event, type("Ctx", (), {"aws_request_id": "r"})())
    assert res["statusCode"] == 200 and json.loads(res["body"])["documentId"].startswith("u-")
