# Build context: the repository root (so the eval image can include evals/papers).
#   docker build -f backend/Dockerfile --target api .
#   docker build -f backend/Dockerfile --target evals .
# The CDK stack builds both for linux/arm64 (Graviton Lambda).

FROM public.ecr.aws/lambda/python:3.12 AS api
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt --target "${LAMBDA_TASK_ROOT}"
COPY backend/app "${LAMBDA_TASK_ROOT}/app"
CMD ["app.main.handler"]

FROM api AS evals
COPY backend/requirements-evals.txt /tmp/requirements-evals.txt
RUN pip install --no-cache-dir -r /tmp/requirements-evals.txt --target "${LAMBDA_TASK_ROOT}"
COPY backend/evals "${LAMBDA_TASK_ROOT}/evals"
COPY evals/dataset.json "${LAMBDA_TASK_ROOT}/evals/dataset.json"
COPY evals/papers "${LAMBDA_TASK_ROOT}/evals/papers"
# Lambda only allows writes to /tmp; RAGAS and its libraries cache there
ENV HOME=/tmp RAGAS_DO_NOT_TRACK=true HF_HOME=/tmp/hf TIKTOKEN_CACHE_DIR=/tmp/tiktoken
CMD ["evals.run.handler"]
