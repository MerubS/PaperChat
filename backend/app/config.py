"""Settings from environment variables, plus secrets loaded once per Lambda cold start."""
import functools
import os

import boto3


def _num(name: str, default: float) -> float:
    try:
        return float(os.environ[name])
    except (KeyError, ValueError):
        return default


AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Bedrock models (override in the CDK stack or env)
# Answer model, called through the Bedrock Converse API: any Converse model with tool use works,
# e.g. us.openai.gpt-5.6-terra (cheaper/faster) or us.anthropic.claude-sonnet-5.
CHAT_MODEL_ID = os.environ.get("CHAT_MODEL_ID", "us.openai.gpt-5.6-sol")
# RAGAS judge: a different model family than the answer model, so answers aren't graded by their own model
EVAL_JUDGE_MODEL_ID = os.environ.get("EVAL_JUDGE_MODEL_ID", "us.anthropic.claude-sonnet-5")
EMBED_MODEL_ID = os.environ.get("EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
EMBED_DIMENSIONS = int(_num("EMBED_DIMENSIONS", 1024))

# Pinecone
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX_NAME", "paperchat-bedrock")
PINECONE_CLOUD = os.environ.get("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.environ.get("PINECONE_REGION", "us-east-1")

# Uploads: browser -> S3 (presigned POST) -> ingest Lambda reads and then deletes the object
UPLOAD_BUCKET = os.environ.get("UPLOAD_BUCKET", "")

# Secrets Manager names. The Pinecone key is required; the access code is optional.
PINECONE_SECRET_NAME = os.environ.get("PINECONE_SECRET_NAME", "paperchat/pinecone-api-key")
ACCESS_CODE_SECRET_NAME = os.environ.get("ACCESS_CODE_SECRET_NAME", "paperchat/access-code")

# RAG settings (from the RAGAS tuning: chunkSize 500, k 6)
CHUNK_SIZE = int(_num("CHUNK_SIZE", 500))
CHUNK_OVERLAP = int(_num("CHUNK_OVERLAP", 150))
TOP_K = int(_num("TOP_K", 6))
MAX_AGENT_SEARCHES = int(_num("MAX_AGENT_SEARCHES", 2))

# Limits
MAX_UPLOAD_MB = _num("MAX_UPLOAD_MB", 10)
MAX_PDF_PAGES = int(_num("MAX_PDF_PAGES", 60))
MAX_QUESTION_CHARS = int(_num("MAX_QUESTION_CHARS", 1000))
UPLOADS_PER_HOUR = int(_num("UPLOADS_PER_HOUR", 5))
QUESTIONS_PER_10_MIN = int(_num("QUESTIONS_PER_10_MIN", 30))
DOCUMENT_TTL_HOURS = _num("DOCUMENT_TTL_HOURS", 24)


@functools.lru_cache(maxsize=None)
def get_secret(name: str, required: bool = True) -> str | None:
    """Reads a Secrets Manager secret once per container. Env var override for local dev:
    the secret name upper-cased with non-alphanumerics as underscores (PAPERCHAT_PINECONE_API_KEY)."""
    env_name = "".join(c if c.isalnum() else "_" for c in name).upper()
    if os.environ.get(env_name):
        return os.environ[env_name]
    client = boto3.client("secretsmanager", region_name=AWS_REGION)
    try:
        return client.get_secret_value(SecretId=name)["SecretString"].strip()
    except client.exceptions.ResourceNotFoundException:
        if required:
            raise RuntimeError(f"Secret {name} not found. Create it with: aws secretsmanager create-secret --name {name} --secret-string ...")
        return None
