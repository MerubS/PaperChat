"""PaperChat API (FastAPI), served by AWS Lambda through Mangum.

Routes (all POST, JSON; behind CloudFront at /api/*):
  /api/upload-url  -> presigned S3 POST for the browser to upload the PDF directly
  /api/ingest      -> reads the PDF from S3, validates, chunks, embeds, stores; deletes the S3 object
  /api/query       -> agentic RAG answer with citations
  /api/document    -> deletes a paper's vectors (New Chat / tab close)
"""
import logging
import time

import boto3
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from mangum import Mangum

from . import agent, config, pdf, vectors
from .metrics import log_metrics
from .security import (
    HttpError, check_access_code, check_declared_size, check_page_count, client_ip, max_upload_bytes,
    new_document_id, question_limiter, require_document_id, require_question, upload_limiter,
    validate_pdf_bytes,
)

log = logging.getLogger("paperchat")
log.setLevel(logging.INFO)
app = FastAPI(title="PaperChat API", docs_url=None, redoc_url=None, openapi_url=None)
_s3 = None


def s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", region_name=config.AWS_REGION)
    return _s3


def upload_key(document_id: str) -> str:
    return f"uploads/{document_id}.pdf"


@app.exception_handler(HttpError)
async def http_error(_req: Request, e: HttpError):
    return JSONResponse({"success": False, "error": e.message}, status_code=e.status, headers=e.headers)


@app.exception_handler(Exception)
async def unexpected(req: Request, e: Exception):
    # Details go to CloudWatch Logs, never to the browser
    log.exception("Unhandled error on %s", req.url.path)
    return JSONResponse({"success": False, "error": "Something went wrong. Please try again."}, status_code=500)


async def guarded_json(req: Request) -> dict:
    try:
        body = await req.json()
    except Exception:
        raise HttpError(400, "Invalid JSON body.")
    if not isinstance(body, dict):
        raise HttpError(400, "Invalid JSON body.")
    code = config.get_secret(config.ACCESS_CODE_SECRET_NAME, required=False)
    check_access_code(req.headers.get("x-access-code") or body.get("accessCode"), code)
    return body


@app.post("/api/upload-url")
async def upload_url(req: Request):
    body = await guarded_json(req)
    upload_limiter.check(client_ip(req.headers))
    check_declared_size(body.get("size"))

    document_id = new_document_id()
    # S3 enforces the size limit and content type itself; the URL expires in 5 minutes.
    post = s3().generate_presigned_post(
        Bucket=config.UPLOAD_BUCKET,
        Key=upload_key(document_id),
        Fields={"Content-Type": "application/pdf"},
        Conditions=[["content-length-range", 1, max_upload_bytes()], {"Content-Type": "application/pdf"}],
        ExpiresIn=300,
    )
    return {"success": True, "documentId": document_id, "upload": post}


@app.post("/api/ingest")
async def ingest(req: Request):
    body = await guarded_json(req)
    document_id = require_document_id(body.get("documentId"))
    key = upload_key(document_id)  # derived from the ID, so callers can't read other objects
    started = time.perf_counter()
    try:
        try:
            obj = s3().get_object(Bucket=config.UPLOAD_BUCKET, Key=key)
        except s3().exceptions.NoSuchKey:
            raise HttpError(404, "Upload not found. Please upload the file again.")
        if obj["ContentLength"] > max_upload_bytes():
            raise HttpError(413, f"PDFs must be {config.MAX_UPLOAD_MB:g} MB or smaller.")
        data = obj["Body"].read()
        validate_pdf_bytes(data)
        try:
            pages = pdf.read_pages(data)
        except Exception:
            raise HttpError(422, "Could not read this PDF.")
        check_page_count(len(pages))  # before paying for embeddings
        chunks = pdf.chunk_pages(pages)
        if not chunks:
            raise HttpError(422, "Could not read any text from this PDF.")
        vectors.store(document_id, chunks)
    finally:
        # The PDF is never kept: delete it whether ingest worked or not (a 1-day lifecycle rule backs this up)
        s3().delete_object(Bucket=config.UPLOAD_BUCKET, Key=key)

    log_metrics({"IngestLatencyMs": (time.perf_counter() - started) * 1000})
    try:
        vectors.sweep_stale()
    except Exception:
        log.exception("Sweep failed")
    return {"success": True, "documentId": document_id, "pages": len(pages), "chunks": len(chunks)}


@app.post("/api/query")
async def query(req: Request):
    body = await guarded_json(req)
    question_limiter.check(client_ip(req.headers))
    question = require_question(body.get("question"))
    document_id = require_document_id(body.get("documentId"))
    result = agent.answer(question, document_id)
    result.pop("contexts", None)
    return result


@app.post("/api/document")
async def delete_document(req: Request):
    body = await guarded_json(req)
    vectors.delete(require_document_id(body.get("documentId")))
    return {"success": True}


handler = Mangum(app, lifespan="off")
