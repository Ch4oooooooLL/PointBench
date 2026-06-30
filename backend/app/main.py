import logging
import time
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.database import AUTH_ENABLED, DATABASE_URL, STORAGE_DIR
from app.database import init_db
from app.logging_config import configure_logging
from app.routers import (
    analysis_router,
    crack_router,
    dewesoft_router,
    import_router,
    measurement_router,
    media_router,
    point_router,
    project_router,
    settings_router,
)


configure_logging()
logger = logging.getLogger("app.main")

app = FastAPI(title="实验点位数据管理与分析系统", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_request_id(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        return request_id
    request_id = request.headers.get("x-request-id") or uuid4().hex
    request.state.request_id = request_id
    return request_id


class ClientLogPayload(BaseModel):
    level: str = Field(default="error", max_length=20)
    message: str = Field(max_length=4000)
    stack: str | None = Field(default=None, max_length=12000)
    component_stack: str | None = Field(default=None, max_length=12000)
    source: str | None = Field(default=None, max_length=1024)
    lineno: int | None = None
    colno: int | None = None
    url: str | None = Field(default=None, max_length=2048)
    user_agent: str | None = Field(default=None, max_length=1024)
    details: dict[str, Any] | None = None


@app.middleware("http")
async def log_unhandled_exceptions(request: Request, call_next) -> Response:
    request_id = get_request_id(request)
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        logger.exception(
            "Unhandled request error request_id=%s method=%s path=%s query=%s client=%s elapsed_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            request.url.query,
            request.client.host if request.client else None,
            elapsed_ms,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "服务器内部错误，详细异常已写入后端日志", "request_id": request_id},
            headers={"X-Request-ID": request_id},
        )

    elapsed_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Request-ID"] = request_id
    if response.status_code >= 500:
        logger.error(
            "Server error response request_id=%s method=%s path=%s status=%s elapsed_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
    return response


@app.exception_handler(StarletteHTTPException)
async def log_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    request_id = get_request_id(request)
    if exc.status_code >= 500:
        logger.error(
            "HTTP exception request_id=%s method=%s path=%s status=%s detail=%r",
            request_id,
            request.method,
            request.url.path,
            exc.status_code,
            exc.detail,
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "request_id": request_id},
        headers={"X-Request-ID": request_id},
    )


@app.on_event("startup")
def startup() -> None:
    logger.info("Backend startup begin database_url=%s storage_dir=%s", DATABASE_URL, STORAGE_DIR)
    try:
        init_db()
    except Exception:
        logger.exception("Backend startup failed during database initialization")
        raise
    configure_logging()
    logger.info("Backend startup completed")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/client-logs", status_code=204)
async def collect_client_log(payload: ClientLogPayload, request: Request) -> Response:
    level_map = {
        "debug": logging.DEBUG,
        "info": logging.INFO,
        "warning": logging.WARNING,
        "warn": logging.WARNING,
        "error": logging.ERROR,
        "critical": logging.CRITICAL,
    }
    level = level_map.get(payload.level.lower(), logging.ERROR)
    logger.log(
        level,
        "Client log level=%s message=%r url=%s source=%s line=%s col=%s client=%s user_agent=%s stack=%s component_stack=%s details=%s",
        payload.level,
        payload.message,
        payload.url,
        payload.source,
        payload.lineno,
        payload.colno,
        request.client.host if request.client else None,
        payload.user_agent,
        payload.stack,
        payload.component_stack,
        payload.details,
    )
    return Response(status_code=204)


if AUTH_ENABLED:
    from app.routers import auth_router

    app.include_router(auth_router.router)
app.include_router(import_router.router)
app.include_router(project_router.router)
app.include_router(point_router.router)
app.include_router(media_router.router)
app.include_router(measurement_router.router)
app.include_router(analysis_router.router)
app.include_router(dewesoft_router.router)
app.include_router(crack_router.router)
app.include_router(settings_router.router)
