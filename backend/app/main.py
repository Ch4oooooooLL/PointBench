from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import analysis_router, dewesoft_router, import_router, measurement_router, media_router, point_router, project_router


app = FastAPI(title="实验点位数据管理与分析系统", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


app.include_router(import_router.router)
app.include_router(project_router.router)
app.include_router(point_router.router)
app.include_router(media_router.router)
app.include_router(measurement_router.router)
app.include_router(analysis_router.router)
app.include_router(dewesoft_router.router)
