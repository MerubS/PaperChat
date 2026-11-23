"""Test doubles for Bedrock (embeddings + Converse chat) and Pinecone; S3 is mocked with moto."""
import hashlib
import json
import math
import os
import re
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.update({
    "AWS_REGION": "us-east-1", "AWS_DEFAULT_REGION": "us-east-1",
    "AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test",
    "UPLOAD_BUCKET": "paperchat-test-uploads",
    "PAPERCHAT_PINECONE_API_KEY": "test",  # env override for the Secrets Manager secret
    "QUESTIONS_PER_10_MIN": "1000", "UPLOADS_PER_HOUR": "1000",
})
PAPERS = os.path.join(os.path.dirname(__file__), "..", "..", "evals", "papers")


def fake_embedding(text: str, dims: int = 256) -> list[float]:
    """Bag-of-words hashing: similar texts get similar vectors, so search results are meaningful."""
    v = [0.0] * dims
    for w in re.findall(r"[a-z]{3,}", text.lower()):
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % dims] += 1
    n = math.sqrt(sum(x * x for x in v)) or 1
    return [x / n for x in v]


class FakeBedrock:
    """bedrock-runtime: Titan embeddings (invoke_model) and a chat model (converse).
    The chat model asks for one extra search on its first turn, then answers citing [1], the
    last passage it saw, and an invalid [99]."""

    def __init__(self, search_query="participants interviews", reject_tools=False):
        self.calls = 0
        self.requests = []
        self.search_query = search_query
        self.reject_tools = reject_tools

    def invoke_model(self, modelId, body, contentType):
        self.calls += 1
        text = json.loads(body)["inputText"]
        return {"body": SimpleNamespace(read=lambda: json.dumps({"embedding": fake_embedding(text)}).encode())}

    def converse(self, **kw):
        self.requests.append(kw)
        if self.reject_tools and "toolConfig" in kw:
            from botocore.exceptions import ClientError
            raise ClientError({"Error": {"Code": "ValidationException", "Message": "This model doesn't support tool use."}}, "Converse")
        msgs = kw["messages"]
        if "toolConfig" in kw and len(msgs) == 1 and self.search_query:
            return {"stopReason": "tool_use", "output": {"message": {"role": "assistant", "content": [
                {"toolUse": {"toolUseId": "tu_1", "name": "search_paper", "input": {"query": self.search_query}}}]}}}
        last = msgs[-1]["content"][0]
        text = last["text"] if "text" in last else last["toolResult"]["content"][0]["text"]
        nums = re.findall(r"^\[(\d+)\] \(page", text, re.M) or ["1"]
        return {"stopReason": "end_turn", "output": {"message": {"role": "assistant", "content": [
            {"text": f"The study interviewed AAC users [1]. More detail is here [{nums[-1]}] [99]."}]}}}


class FakeIndex:
    def __init__(self):
        self.ns: dict[str, dict[str, dict]] = {}

    def upsert(self, vectors, namespace):
        self.ns.setdefault(namespace, {}).update({v["id"]: v for v in vectors})

    def query(self, vector, top_k, namespace, include_metadata):
        recs = self.ns.get(namespace, {}).values()
        scored = sorted(recs, key=lambda r: -sum(a * b for a, b in zip(vector, r["values"])))[:top_k]
        return SimpleNamespace(matches=[SimpleNamespace(id=r["id"], metadata=r["metadata"]) for r in scored])

    def describe_index_stats(self):
        return SimpleNamespace(namespaces={k: SimpleNamespace(vector_count=len(v)) for k, v in self.ns.items()})

    def delete(self, delete_all, namespace):
        self.ns.pop(namespace, None)


@pytest.fixture
def env(monkeypatch):
    import boto3
    from moto import mock_aws

    from app import agent, config, main, security, vectors

    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="paperchat-test-uploads")
        main._s3 = None
        fake_index, fake_bedrock = FakeIndex(), FakeBedrock()
        monkeypatch.setattr(vectors, "_index", fake_index)
        monkeypatch.setattr(vectors, "_bedrock", fake_bedrock)
        monkeypatch.setattr(agent, "_tools_supported", True)
        monkeypatch.setattr(vectors, "_last_sweep", 0.0)
        monkeypatch.setattr(config, "EMBED_DIMENSIONS", 256)
        config.get_secret.cache_clear()
        monkeypatch.delenv("PAPERCHAT_ACCESS_CODE", raising=False)
        # fresh rate limiters per test
        monkeypatch.setattr(security.upload_limiter, "hits", security.defaultdict(list))
        monkeypatch.setattr(security.question_limiter, "hits", security.defaultdict(list))
        from fastapi.testclient import TestClient

        yield SimpleNamespace(client=TestClient(main.app, raise_server_exceptions=False), index=fake_index, bedrock=fake_bedrock,
                              s3=boto3.client("s3", region_name="us-east-1"))
