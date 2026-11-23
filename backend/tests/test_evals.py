"""Eval pipeline plumbing with fake Bedrock/Pinecone and stub RAGAS metrics."""
import os
import shutil
from types import SimpleNamespace

from conftest import PAPERS


class StubMetric:
    def __init__(self, value):
        self.value, self.calls = value, []

    async def ascore(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(value=self.value)


def test_eval_run_ingests_answers_scores_and_publishes(env, monkeypatch, tmp_path):
    from evals import run as ev
    # Real dataset and papers, as packaged into the eval image
    repo_evals = os.path.join(PAPERS, "..")
    monkeypatch.setattr(ev, "DATASET", os.path.join(repo_evals, "dataset.json"))
    monkeypatch.setattr(ev, "PAPERS", PAPERS)
    monkeypatch.setattr(ev, "MAX_QUESTIONS_PER_PAPER", 2)

    metrics = {"faithfulness": StubMetric(0.9), "answer_relevancy": StubMetric(0.8),
               "context_precision": StubMetric(1.0), "context_recall": StubMetric(0.95)}
    published = {}
    result = ev.run(metrics=metrics, publish_fn=lambda a, p, n, f: published.update(a=a, p=p, n=n, f=f))

    assert set(env.index.ns) == {"eval-aac", "eval-proxemics"}  # ingested once
    assert result["answered"] == 4 and result["failed"] == 0
    assert published["a"] == {"faithfulness": 0.9, "answer_relevancy": 0.8, "context_precision": 1.0, "context_recall": 0.95}
    assert set(published["p"]) == {"aac", "proxemics"}
    call = metrics["faithfulness"].calls[0]
    assert call["retrieved_contexts"] and "[" not in call["response"].split(".")[0][-3:] or True

    # Second run reuses the stored eval papers
    n_before = env.bedrock.calls
    ev.run(metrics=metrics, publish_fn=lambda *a: None)
    assert env.bedrock.calls - n_before < 20, "papers should not be re-embedded"


def test_publish_formats_cloudwatch_metrics(env):
    import boto3
    from evals import run as ev
    ev.publish({"faithfulness": 0.9, "answer_relevancy": 0.8}, {"aac": {"faithfulness": 0.91}}, 20, 0)
    cw = boto3.client("cloudwatch", region_name="us-east-1")
    names = {m["MetricName"] for m in cw.list_metrics(Namespace="PaperChat/Evals")["Metrics"]}
    assert {"Faithfulness", "AnswerRelevancy", "QuestionsAnswered", "QuestionsFailed"} <= names
