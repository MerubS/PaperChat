"""Agentic RAG: the model answers from retrieved passages and can call a search tool for more.

The first search runs before the model is called (most questions need nothing else, so this
saves a round trip). If the passages aren't enough, e.g. the question spans several sections,
the model calls `search_paper` with its own, more specific queries, up to MAX_AGENT_SEARCHES times.
All passages are numbered in one sequence, so the final [n] citations map back to pages.
"""
import time

from botocore.exceptions import ClientError

from . import config, vectors
from .citations import Passage, extract_citations, format_passages
from .metrics import log_metrics

SYSTEM_PROMPT = """You are a precise research paper assistant.

CRITICAL RULES - follow these exactly:
1. Answer the question DIRECTLY in your first sentence
2. ONLY use information explicitly stated in the passages
3. Do NOT add any information from outside the passages
4. Do NOT make assumptions or inferences
5. If the exact answer is not in the passages, say exactly: "I could not find that specific information in the provided context."
6. Keep answers concise and focused on what was asked
7. Do not provide background information unless specifically asked
8. Each passage is numbered like [1] (page 3). After every sentence that uses a passage, cite it, e.g. [1] or [2][4]. Only cite numbers you were given. Do not cite anything in the "could not find" reply.

ANSWER FORMAT RULES:
- "What X was used?" -> Begin: "The study used [X]..."
- "How many?" -> Begin with the number directly
- "What did X do?" -> Begin with the action directly
- "What were the findings?" -> Begin with the finding directly
- "How was X computed?" -> Begin: "X was computed by..."
- Never start with background context
- Never start with "The paper discusses..." or "This study..."

SEARCHING:
You are given passages retrieved for the question. If they don't contain what you need, or the
question needs several parts of the paper (e.g. method AND results), call search_paper with a
short, specific query for the missing part. Search at most {max_searches} times, then answer."""

SEARCH_TOOL = {
    "toolSpec": {
        "name": "search_paper",
        "description": "Semantic search over the uploaded paper. Returns new numbered passages with page numbers.",
        "inputSchema": {"json": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "What to look for, e.g. 'number of participants'"}},
            "required": ["query"],
        }},
    }
}

# Set to False if the configured model rejects tool use; the agent then answers from the first search.
_tools_supported = True


class _Passages:
    """All passages seen in this conversation, numbered once, de-duplicated by vector ID."""

    def __init__(self):
        self.items: list[Passage] = []
        self._seen: set[str] = set()

    def add(self, found: list[Passage]) -> str:
        new = [p for p in found if (p.id or p.text) not in self._seen]
        for p in new:
            self._seen.add(p.id or p.text)
        start = len(self.items) + 1
        self.items.extend(new)
        return format_passages(new, start) if new else "No new passages found for that query."


def _converse(system: str, messages: list, use_tools: bool) -> dict:
    """One Bedrock Converse call. Converse works the same for GPT-5.6, Claude and others, so the
    model is just CHAT_MODEL_ID. No temperature/top_p: newer models reject sampling params."""
    global _tools_supported
    kwargs = dict(modelId=config.CHAT_MODEL_ID, system=[{"text": system}], messages=messages,
                  inferenceConfig={"maxTokens": 1024})
    if use_tools and _tools_supported:
        kwargs["toolConfig"] = {"tools": [SEARCH_TOOL], "toolChoice": {"auto": {}}}
    try:
        return vectors.bedrock().converse(**kwargs)
    except ClientError as e:
        msg = str(e).lower()
        if "toolConfig" in kwargs and e.response["Error"]["Code"] == "ValidationException" and "tool" in msg:
            _tools_supported = False  # fall back to single-search RAG for this model
            raise _NoTools() from e
        raise


class _NoTools(Exception):
    pass


def answer(question: str, namespace: str) -> dict:
    started = time.perf_counter()
    passages = _Passages()
    searches = [question]
    first = passages.add(vectors.search(namespace, question))
    system = SYSTEM_PROMPT.format(max_searches=config.MAX_AGENT_SEARCHES)
    first_turn = [{"role": "user", "content": [{"text": f"Question: {question}\n\nPassages:\n{first}"}]}]
    messages = list(first_turn)
    text = ""

    # Up to MAX_AGENT_SEARCHES tool rounds, plus one turn to answer
    for _turn in range(config.MAX_AGENT_SEARCHES + 2):
        try:
            res = _converse(system, messages, use_tools=True)
        except _NoTools:
            messages, searches = list(first_turn), [question]
            res = _converse(system, messages, use_tools=False)

        content = res["output"]["message"]["content"]
        tool_uses = [b["toolUse"] for b in content if "toolUse" in b]
        if res.get("stopReason") != "tool_use" or not tool_uses:
            text = "".join(b.get("text", "") for b in content)
            break

        results = []
        for use in tool_uses:
            if len(searches) > config.MAX_AGENT_SEARCHES:
                result = "Search limit reached. Answer now using the passages you already have."
            else:
                query = str((use.get("input") or {}).get("query", "")).strip()[: config.MAX_QUESTION_CHARS] or question
                searches.append(query)
                result = passages.add(vectors.search(namespace, query))
            results.append({"toolResult": {"toolUseId": use["toolUseId"], "content": [{"text": result}]}})
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": results})

    response, citations = extract_citations(text, passages.items)
    log_metrics({"AnswerLatencyMs": (time.perf_counter() - started) * 1000})
    log_metrics({"AgentSearches": len(searches)}, unit="Count")
    return {
        "success": True,
        "response": response or "I could not find that specific information in the provided context.",
        "citations": citations,
        "searches": searches,
        "contexts": [p.text for p in passages.items],  # for evals; stripped by the API route
    }
