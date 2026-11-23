"""Numbered context for the model and [n] citation parsing (mirrors src/lib/citations.ts)."""
import re
from dataclasses import dataclass


@dataclass
class Passage:
    text: str
    page: int
    id: str = ""  # vector ID, used to de-duplicate passages across agent searches


MARKER = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


def format_passages(passages: list[Passage], start: int = 1) -> str:
    """'[1] (page 3)\\n<text>' blocks, numbered from `start`."""
    return "\n\n---\n\n".join(f"[{start + i}] (page {p.page})\n{p.text}" for i, p in enumerate(passages))


def extract_citations(answer: str, passages: list[Passage]) -> tuple[str, list[dict]]:
    """Keeps [n] markers that point at real passages, renumbers them 1..k in order of first
    appearance, and returns the cited passages as {id, page, quote}."""
    remap: dict[int, int] = {}
    citations: list[dict] = []

    def repl(m: re.Match) -> str:
        out: list[str] = []
        for part in m.group(1).split(","):
            n = int(part.strip())
            if not 1 <= n <= len(passages):
                continue
            if n not in remap:
                remap[n] = len(remap) + 1
                p = passages[n - 1]
                citations.append({"id": remap[n], "page": p.page, "quote": p.text.strip()})
            marker = f"[{remap[n]}]"
            if marker not in out:
                out.append(marker)
        return "".join(out)

    text = MARKER.sub(repl, answer)
    text = re.sub(r" +([.,;:])", r"\1", text).strip()
    return text, citations
