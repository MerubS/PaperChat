"""CloudWatch metrics via Embedded Metric Format: a structured log line that CloudWatch
turns into metrics, with no extra API calls or latency."""
import json
import os
import time

NAMESPACE = os.environ.get("METRICS_NAMESPACE", "PaperChat")


def log_metrics(values: dict[str, float], unit: str = "Milliseconds") -> None:
    print(json.dumps({
        "_aws": {
            "Timestamp": int(time.time() * 1000),
            "CloudWatchMetrics": [{
                "Namespace": NAMESPACE,
                "Dimensions": [["Service"]],
                "Metrics": [{"Name": k, "Unit": unit} for k in values],
            }],
        },
        "Service": "api",
        **{k: round(v, 2) for k, v in values.items()},
    }))
