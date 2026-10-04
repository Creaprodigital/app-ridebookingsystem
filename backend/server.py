"""
Backend entry point.

In this deployment, the mobile client consumes an EXTERNAL SaaS API at
``shared-ride-pool.emergent.host`` (configured via the UPSTREAM_API_BASE env
var below). The locally deployed FastAPI service acts as a **transparent
proxy**: it forwards every ``/api/*`` request to the upstream SaaS and
returns the response as-is.

Why a proxy and not calling the SaaS directly from the client?
  • The Emergent publish pipeline rewrites EXPO_PUBLIC_BACKEND_URL to the
    URL where this backend is deployed. If the client ignored this and
    called the SaaS directly, deploy-time URL rewrites could not steer
    traffic (e.g. for staging/prod split).
  • Centralising requests through this backend lets us later add auth
    hardening, request logging or caching without touching the client.

The stock Mongo wiring is kept so the Emergent deploy health check still
sees a valid MongoDB connection, even though no local collection is used
yet.
"""

from fastapi import FastAPI, APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection (kept for health-check compatibility)
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Upstream SaaS backend. Required — comes exclusively from env config so
# deployments can steer traffic (dev vs prod, feature flags, …) without a
# code change. Missing it must surface loudly at startup, never silently.
UPSTREAM_API_BASE = os.environ.get('UPSTREAM_API_BASE', '').rstrip('/')
if not UPSTREAM_API_BASE:
    raise RuntimeError(
        'UPSTREAM_API_BASE env var is required — set it in backend/.env '
        '(e.g. UPSTREAM_API_BASE="https://your-saas-host").'
    )

# Hop-by-hop headers that must never be forwarded (per RFC 7230 §6.1).
_HOP_BY_HOP = {
    'connection', 'keep-alive', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailers',
    'transfer-encoding', 'upgrade', 'content-encoding',
    'content-length', 'host',
}

app = FastAPI(title="Ridebookingsystem backend proxy")

# One shared async HTTP client — reuses TCP connections and HTTP/2.
_httpx_client: httpx.AsyncClient | None = None


@app.on_event("startup")
async def _startup() -> None:
    global _httpx_client
    _httpx_client = httpx.AsyncClient(
        base_url=UPSTREAM_API_BASE,
        timeout=httpx.Timeout(60.0, connect=10.0),
        follow_redirects=False,
        http2=False,
    )


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _httpx_client
    if _httpx_client is not None:
        await _httpx_client.aclose()
        _httpx_client = None
    client.close()


# Health check (used by deployment platform liveness probes).
# Served under both /health and /healthz so platforms using either
# convention work out of the box.
@app.get("/health")
@app.get("/healthz")
async def healthz() -> dict:
    try:
        # 1-second mongo ping — fast and side-effect free.
        await db.command({"ping": 1})
        mongo_ok = True
    except Exception:
        mongo_ok = False
    return {"ok": True, "mongo": mongo_ok, "upstream": UPSTREAM_API_BASE}


@app.get("/api/status")
async def _local_status_short_circuit() -> dict:
    """Deployment smoke-test endpoint. Always available locally."""
    return {"ok": True, "service": "ridebookingsystem", "proxy_target": UPSTREAM_API_BASE}


# Catch-all proxy — every /api/* request is forwarded upstream.
@app.api_route(
    "/api/{full_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_api(full_path: str, request: Request) -> Response:
    assert _httpx_client is not None, "httpx client not initialised"

    # Rebuild the upstream URL including the query string.
    url = f"/api/{full_path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    # Forward headers (minus hop-by-hop ones). Keep Authorization so the
    # mobile client's JWT reaches the SaaS unchanged.
    forwarded_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in _HOP_BY_HOP
    }
    # Make upstream think the request originates from the client's host.
    forwarded_headers.setdefault("x-forwarded-host", request.url.hostname or "")

    body = await request.body()

    try:
        upstream_resp = await _httpx_client.request(
            request.method,
            url,
            headers=forwarded_headers,
            content=body,
        )
    except httpx.HTTPError as exc:
        logger.warning("Upstream request failed: %s %s -> %s", request.method, url, exc)
        return Response(
            status_code=502,
            content=f'{{"detail":"upstream unreachable: {exc.__class__.__name__}"}}',
            media_type="application/json",
        )

    # Strip hop-by-hop headers from the upstream response before returning.
    response_headers = {
        k: v for k, v in upstream_resp.headers.items()
        if k.lower() not in _HOP_BY_HOP
    }
    return Response(
        content=upstream_resp.content,
        status_code=upstream_resp.status_code,
        headers=response_headers,
        media_type=upstream_resp.headers.get("content-type"),
    )


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)
