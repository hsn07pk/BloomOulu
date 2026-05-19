"""
BloomOulu reranker — drop-in replacement for HuggingFace
text-embeddings-inference on hosts that don't have a TEI build (e.g.
Apple Silicon arm64).

The HTTP contract matches TEI exactly:
  POST /rerank   { "query": str, "texts": [str, ...], "truncate": bool }
                 -> [ { "index": int, "score": float }, ... ]  (sorted desc)
  GET  /health   -> { "status": "ok" }

Model: BAAI/bge-reranker-v2-m3 (multilingual cross-encoder, MIT license)
Loaded once at startup; weights cached under /data so subsequent boots
skip the ~600 MB download.
"""
from __future__ import annotations

import logging
import os
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder

MODEL_ID = os.environ.get("MODEL_ID", "BAAI/bge-reranker-v2-m3")
MAX_LEN = int(os.environ.get("MAX_LEN", "512"))
CACHE_DIR = os.environ.get("HF_HOME", "/data")

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("reranker")
log.info("loading %s (max_length=%d, cache=%s)", MODEL_ID, MAX_LEN, CACHE_DIR)
os.makedirs(CACHE_DIR, exist_ok=True)
model = CrossEncoder(MODEL_ID, max_length=MAX_LEN, cache_dir=CACHE_DIR)
log.info("model loaded")


class RerankReq(BaseModel):
    query: str
    texts: List[str]
    truncate: bool = Field(default=True)


class RerankResult(BaseModel):
    index: int
    score: float


app = FastAPI(title="bloomoulu-reranker", version="1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/rerank", response_model=List[RerankResult])
def rerank(req: RerankReq) -> List[RerankResult]:
    if not req.texts:
        return []
    pairs = [[req.query, t] for t in req.texts]
    scores = model.predict(pairs).tolist()
    ranked = sorted(
        ({"index": i, "score": float(s)} for i, s in enumerate(scores)),
        key=lambda r: -r["score"],
    )
    return [RerankResult(**r) for r in ranked]
