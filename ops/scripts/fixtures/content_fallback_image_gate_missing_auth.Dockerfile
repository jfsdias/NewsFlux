ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER 0:0
RUN rm -rf /app/services/article_intel_auth
USER 10001:10001
