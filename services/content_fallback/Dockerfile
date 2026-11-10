FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CONTENT_FALLBACK_HOST=0.0.0.0 \
    CONTENT_FALLBACK_DB_PATH=/data/content-fallback.sqlite3

WORKDIR /app
COPY services/__init__.py /app/services/__init__.py
COPY services/article_intel_auth /app/services/article_intel_auth
COPY services/content_fallback /app/services/content_fallback

RUN mkdir -p /data && chown 10001:10001 /data && chmod 700 /data
VOLUME ["/data"]

USER 10001:10001
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["python", "-c", "import json, urllib.request; response = urllib.request.urlopen('http://127.0.0.1:8790/healthz', timeout=2); assert response.status == 200 and json.load(response).get('status') == 'ok'"]

CMD ["python", "-m", "services.content_fallback.server"]
