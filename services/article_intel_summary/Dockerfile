FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY services/article_intel_summary/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt && \
    mkdir -p /data && chown 10001:10001 /data && chmod 700 /data
COPY services/__init__.py /app/services/__init__.py
COPY services/article_intel_auth /app/services/article_intel_auth
COPY services/content_fallback /app/services/content_fallback
COPY services/article_intel_summary /app/services/article_intel_summary
USER 10001:10001
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["python", "-c", "import json, urllib.request; r = urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=2); assert r.status == 200 and json.load(r).get('status') == 'ok'"]
CMD ["uvicorn", "services.article_intel_summary.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8788", "--no-access-log"]
