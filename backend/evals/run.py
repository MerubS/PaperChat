"""Scheduled RAGAS evaluation (its own Lambda, run daily by EventBridge).

1. Makes sure the two eval papers are in Pinecone (namespaces eval-aac / eval-proxemics,
   which the public API can't touch).
2. Answers every question in dataset.json with the same agent the app uses.
3. Scores answers with RAGAS (Faithfulness, AnswerRelevancy, ContextPrecision,
   ContextRecall), using Claude on Bedrock as the judge (a different model
   family than the answer model, to avoid self-grading) and Titan for embeddings.
4. Publishes the averages to CloudWatch (namespace PaperChat/Evals). The CDK stack
   alarms if any score drops below 0.85, or if the eval stops reporting.
"""
import asyncio
import json
import os
import statistics
import time

import boto3

from app import agent, config, pdf, vectors

HERE = os.path.dirname(__file__)
DATASET = os.path.join(HERE, "dataset.json")
PAPERS = os.path.join(HERE, "papers")
METRICS_NAMESPACE = "PaperChat/Evals"
METRIC_NAMES = {
    "faithfulness": "Faithfulness",
    "answer_relevancy": "AnswerRelevancy",
    "context_precision": "ContextPrecision",
    "context_recall": "ContextRecall",
}
JUDGE_MODEL_ID = config.EVAL_JUDGE_MODEL_ID
MAX_QUESTIONS_PER_PAPER = int(os.environ.get("MAX_QUESTIONS_PER_PAPER", "10"))
CONCURRENCY = int(os.environ.get("EVAL_CONCURRENCY", "4"))


def eval_namespace(paper: str) -> str:
    return f"eval-{paper}"


def ensure_paper(paper: str) -> None:
    ns = eval_namespace(paper)
    if vectors.namespace_size(ns) > 0:
        return
    with open(os.path.join(PAPERS, f"{paper}-paper.pdf"), "rb") as f:
        chunks = pdf.chunk_pages(pdf.read_pages(f.read()))
    vectors.store(ns, chunks)
    print(f"Ingested {paper}: {len(chunks)} chunks")


class TitanEmbeddings:
    """RAGAS embedding interface backed by Bedrock Titan (same model as the app)."""

    def embed_text(self, text: str, **_):
        return vectors.embed(text)

    async def aembed_text(self, text: str, **_):
        return await asyncio.to_thread(vectors.embed, text)

    def embed_texts(self, texts, **_):
        return vectors.embed_many(list(texts))

    async def aembed_texts(self, texts, **_):
        return await asyncio.to_thread(vectors.embed_many, list(texts))


def build_metrics():
    import instructor
    from anthropic import AnthropicBedrock
    from ragas.embeddings.base import BaseRagasEmbedding
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerRelevancy, ContextPrecision, ContextRecall, Faithfulness

    llm = llm_factory(
        JUDGE_MODEL_ID, provider="anthropic", client=AnthropicBedrock(aws_region=config.AWS_REGION),
        max_tokens=4096, mode=instructor.Mode.ANTHROPIC_TOOLS,
    )
    BaseRagasEmbedding.register(TitanEmbeddings)
    return {
        "faithfulness": Faithfulness(llm=llm),
        "answer_relevancy": AnswerRelevancy(llm=llm, embeddings=TitanEmbeddings()),
        "context_precision": ContextPrecision(llm=llm),
        "context_recall": ContextRecall(llm=llm),
    }


async def score_sample(metrics, sample, sem) -> dict:
    async with sem:
        q, a, ctx, ref = sample["question"], sample["answer"], sample["contexts"], sample["ground_truth"]
        calls = {
            "faithfulness": metrics["faithfulness"].ascore(user_input=q, response=a, retrieved_contexts=ctx),
            "answer_relevancy": metrics["answer_relevancy"].ascore(user_input=q, response=a),
            "context_precision": metrics["context_precision"].ascore(user_input=q, reference=ref, retrieved_contexts=ctx),
            "context_recall": metrics["context_recall"].ascore(user_input=q, retrieved_contexts=ctx, reference=ref),
        }
        results = await asyncio.gather(*calls.values(), return_exceptions=True)
        out = {}
        for name, r in zip(calls, results):
            if isinstance(r, Exception):
                print(f"  {name} failed for {q[:50]!r}: {r}")
            else:
                out[name] = float(r.value)
        return out


def publish(averages: dict, per_paper: dict, answered: int, failed: int) -> None:
    data = [{"MetricName": METRIC_NAMES[k], "Value": v, "Unit": "None"} for k, v in averages.items()]
    for paper, scores in per_paper.items():
        data += [{"MetricName": METRIC_NAMES[k], "Value": v, "Unit": "None",
                  "Dimensions": [{"Name": "Paper", "Value": paper}]} for k, v in scores.items()]
    data += [{"MetricName": "QuestionsAnswered", "Value": answered, "Unit": "Count"},
             {"MetricName": "QuestionsFailed", "Value": failed, "Unit": "Count"}]
    cw = boto3.client("cloudwatch", region_name=config.AWS_REGION)
    for i in range(0, len(data), 20):
        cw.put_metric_data(Namespace=METRICS_NAMESPACE, MetricData=data[i : i + 20])


def run(metrics=None, publish_fn=publish) -> dict:
    started = time.time()
    with open(DATASET) as f:
        dataset = json.load(f)

    by_paper: dict[str, list] = {}
    for item in dataset:
        by_paper.setdefault(item["paper"], []).append(item)

    samples, failed = [], 0
    for paper, items in by_paper.items():
        ensure_paper(paper)
        for item in items[:MAX_QUESTIONS_PER_PAPER]:
            try:
                res = agent.answer(item["question"], eval_namespace(paper))
                samples.append({"paper": paper, "question": item["question"], "answer": res["response"],
                                "contexts": res["contexts"], "ground_truth": item["ground_truth"]})
            except Exception as e:
                failed += 1
                print(f"Answer failed for {item['question'][:50]!r}: {e}")

    metrics = metrics or build_metrics()

    async def score_all():
        sem = asyncio.Semaphore(CONCURRENCY)
        return await asyncio.gather(*(score_sample(metrics, s, sem) for s in samples))

    scores = asyncio.run(score_all())

    def avg(rows):
        return {k: round(statistics.mean(r[k] for r in rows if k in r), 4)
                for k in METRIC_NAMES if any(k in r for r in rows)}

    averages = avg(scores)
    per_paper = {p: avg([s for s, smp in zip(scores, samples) if smp["paper"] == p]) for p in by_paper}
    publish_fn(averages, per_paper, len(samples), failed)

    result = {"averages": averages, "per_paper": per_paper, "answered": len(samples), "failed": failed,
              "seconds": round(time.time() - started, 1)}
    print(json.dumps(result))
    return result


def handler(event, context):
    return run()
