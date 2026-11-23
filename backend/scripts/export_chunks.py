"""Writes the chunks the backend creates for the eval papers to tests/fixtures/chunks.json,
so the frontend test can check the PDF viewer highlights exactly what the backend stored.
Run from the repo root:  python backend/scripts/export_chunks.py"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.pdf import chunk_pages, read_pages  # noqa: E402

out = {}
for paper in ["aac-paper.pdf", "proxemics-paper.pdf"]:
    with open(os.path.join("evals", "papers", paper), "rb") as f:
        out[paper] = [{"page": c.page, "text": c.text} for c in chunk_pages(read_pages(f.read()))]
with open(os.path.join("tests", "fixtures", "chunks.json"), "w") as f:
    json.dump(out, f)
print({k: len(v) for k, v in out.items()})
