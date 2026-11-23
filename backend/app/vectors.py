"""Bedrock Titan embeddings + Pinecone storage, one namespace per uploaded paper."""
import json
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
from botocore.config import Config

from . import config
from .citations import Passage
from .metrics import log_metrics
from .security import stale_namespaces

_bedrock = None
_index = None


def bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client(
            "bedrock-runtime", region_name=config.AWS_REGION,
            config=Config(max_pool_connections=16, retries={"max_attempts": 6, "mode": "adaptive"}),
        )
    return _bedrock


def index():
    """Pinecone index, created on first use if it doesn't exist (serverless, cosine)."""
    global _index
    if _index is None:
        from pinecone import Pinecone, ServerlessSpec

        pc = Pinecone(api_key=config.get_secret(config.PINECONE_SECRET_NAME))
        if not pc.has_index(config.PINECONE_INDEX_NAME):
            # Waits until the index is ready
            pc.create_index(
                name=config.PINECONE_INDEX_NAME, dimension=config.EMBED_DIMENSIONS, metric="cosine",
                spec=ServerlessSpec(cloud=config.PINECONE_CLOUD, region=config.PINECONE_REGION),
            )
        _index = pc.Index(config.PINECONE_INDEX_NAME)
    return _index


def embed(text: str) -> list[float]:
    body = json.dumps({"inputText": text, "dimensions": config.EMBED_DIMENSIONS, "normalize": True})
    res = bedrock().invoke_model(modelId=config.EMBED_MODEL_ID, body=body, contentType="application/json")
    return json.loads(res["body"].read())["embedding"]


def embed_many(texts: list[str], workers: int = 8) -> list[list[float]]:
    """Titan embeds one text per call, so run calls in parallel."""
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(embed, texts))


def store(namespace: str, chunks: list[Passage]) -> None:
    vectors = embed_many([c.text for c in chunks])
    records = [
        {"id": f"{namespace}#{i}", "values": v, "metadata": {"text": c.text, "pageNumber": c.page}}
        for i, (c, v) in enumerate(zip(chunks, vectors))
    ]
    for i in range(0, len(records), 100):
        index().upsert(vectors=records[i : i + 100], namespace=namespace)


def search(namespace: str, query: str, k: int = config.TOP_K) -> list[Passage]:
    """Embeds the query and returns the top-k passages. Logs RetrievalLatencyMs to CloudWatch."""
    start = time.perf_counter()
    res = index().query(vector=embed(query), top_k=k, namespace=namespace, include_metadata=True)
    log_metrics({"RetrievalLatencyMs": (time.perf_counter() - start) * 1000})
    return [
        Passage(text=m.metadata["text"], page=int(m.metadata.get("pageNumber", 1)), id=m.id)
        for m in res.matches
    ]


def namespace_size(namespace: str) -> int:
    stats = index().describe_index_stats()
    ns = (stats.namespaces or {}).get(namespace)
    return int(ns.vector_count) if ns else 0


def delete(namespace: str) -> None:
    try:
        index().delete(delete_all=True, namespace=namespace)
    except Exception as e:  # deleting a namespace that doesn't exist is fine
        if "not found" not in str(e).lower():
            raise


_last_sweep = 0.0


def sweep_stale(now: float | None = None) -> int:
    """Deletes abandoned uploads older than DOCUMENT_TTL_HOURS (at most every 10 min per container)."""
    global _last_sweep
    now = time.time() if now is None else now
    if now - _last_sweep < 600:
        return 0
    _last_sweep = now
    names = list((index().describe_index_stats().namespaces or {}).keys())
    stale = stale_namespaces(names, int(now * 1000))
    for ns in stale:
        delete(ns)
    return len(stale)
