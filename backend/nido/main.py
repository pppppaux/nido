from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import PlainTextResponse

from nido.db import close_pool, run_migrations, tx
from nido.routers import auth, house, items, money, pantry
from nido.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    yield
    close_pool()


# Sin /docs ni /openapi.json: la API solo la usa la propia web.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=86400,
)

for module in (auth, house, items, pantry, money):
    app.include_router(module.router)


@app.get("/healthz", response_class=PlainTextResponse)
def healthz():
    try:
        with tx() as cur:
            cur.execute("SELECT 1")
        return "ok"
    except Exception:
        return PlainTextResponse("error", status_code=503)
