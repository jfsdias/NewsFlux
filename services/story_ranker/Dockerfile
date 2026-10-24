FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=0 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    VECLIB_MAXIMUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    TOKENIZERS_PARALLELISM=false \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    STORY_RANKER_OFFLINE=1 \
    STORY_RANKER_DEVICE=cpu \
    HF_HOME=/opt/newsflux/hf-cache

WORKDIR /app

COPY services/story_ranker/requirements.txt /tmp/story-ranker-requirements.txt
RUN pip install --no-cache-dir -r /tmp/story-ranker-requirements.txt

COPY services /app/services

# Freeze and verify the exact R3C reranker snapshot in the image; runtime stays offline.
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 python - <<'PY'
from pathlib import Path
from huggingface_hub import snapshot_download
from services.story_ranker.adapters import (
    QWEN_RERANKER_MODEL,
    QWEN_RERANKER_REVISION,
    verify_offline_reranker_snapshot,
    write_reranker_snapshot_manifest,
)

snapshot_path = Path(
    snapshot_download(
        repo_id=QWEN_RERANKER_MODEL,
        revision=QWEN_RERANKER_REVISION,
    )
)
write_reranker_snapshot_manifest(snapshot_path, revision=QWEN_RERANKER_REVISION)
verify_offline_reranker_snapshot(expected_revision=QWEN_RERANKER_REVISION)
PY

EXPOSE 8787

CMD ["python", "-m", "services.story_ranker.server"]
