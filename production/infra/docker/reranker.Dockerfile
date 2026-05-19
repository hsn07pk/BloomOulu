# BloomOulu reranker — runs BAAI/bge-reranker-v2-m3 via sentence-transformers.
#
# Used on hosts where the upstream `ghcr.io/huggingface/text-embeddings-inference`
# image has no matching build (notably Apple Silicon arm64). The HTTP contract
# is identical, so the api treats this exactly like a TEI server.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/data \
    TRANSFORMERS_NO_ADVISORY_WARNINGS=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin versions for reproducible production builds. sentence-transformers
# pulls torch (CPU) and transformers as transitive deps; both have native
# arm64 wheels on PyPI for Python 3.11.
RUN pip install \
      "fastapi==0.115.0" \
      "uvicorn[standard]==0.30.6" \
      "pydantic==2.9.2" \
      "sentence-transformers==3.1.1" \
      "torch==2.4.1"

COPY infra/reranker/main.py /app/main.py

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=180s \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
