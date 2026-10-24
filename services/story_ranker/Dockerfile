FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    STORY_RANKER_OFFLINE=1 \
    HF_HOME=/opt/newsflux/hf-cache

WORKDIR /app

COPY services/story_ranker/requirements.txt /tmp/story-ranker-requirements.txt
RUN pip install --no-cache-dir -r /tmp/story-ranker-requirements.txt

ARG QWEN_RERANKER_REVISION=e61197ed45024b0ed8a2d74b80b4d909f1255473
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="Qwen/Qwen3-Reranker-0.6B",
    revision="e61197ed45024b0ed8a2d74b80b4d909f1255473",
)
PY

COPY services /app/services

EXPOSE 8787

CMD ["python", "-m", "services.story_ranker.server"]
