import asyncio
import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.models import Project
from app.schemas import PointBindingUpsert
from app.services import task_progress
from app.services.fem_model_service import (
    FemModelError,
    create_or_replace_fem_model,
    delete_fem_model,
    load_fem_model_payload,
    resolve_fem_artifact_dir,
)
from app.services.task_progress import fail_task, report_task_progress, start_task, succeed_task
from app.utils.path_utils import safe_fem_dir

logger = logging.getLogger("app.fem_router")

router = APIRouter(prefix="/api/projects", tags=["fem-model"])


def _get_project(project_id: int, db: Session) -> Project:
    project = db.get(Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


def _read_uploads(files: list[UploadFile] | None) -> list[tuple[str, bytes]]:
    uploads: list[tuple[str, bytes]] = []
    for upload in files or []:
        content = upload.file.read() if hasattr(upload, "file") else b""
        uploads.append((upload.filename or "", content))
    return uploads


@router.get("/{project_id}/fem")
def get_project_fem_model(project_id: int, db: Session = Depends(get_db)) -> dict:
    """读取项目 FEM 模型状态与产物（冷启动/再打开时直接返回已渲染产物）。"""
    project = _get_project(project_id, db)
    return load_fem_model_payload(project)


@router.post("/{project_id}/fem")
async def upload_project_fem_model(
    project_id: int,
    files: Annotated[list[UploadFile], File(description="FEM 模型文件，文件名可携带相对路径")],
    db: Session = Depends(get_db),
) -> dict:
    """为项目导入 FEM 模型文件（可连同 INCLUDE 配套文件）。

    文件写入后立即启动解析 + 渲染任务：返回 ``task_id``，前端轮询
    ``GET /api/tasks/{task_id}`` 展示进度，任务完成后再调用
    ``GET /api/projects/{id}/fem`` 获取渲染产物。
    """
    project = _get_project(project_id, db)
    uploads = _read_uploads(files)
    if not uploads:
        raise HTTPException(status_code=400, detail="没有收到任何上传文件")

    task_id = start_task("FEM 模型解析")
    payload = {"task_id": task_id, "status": "running", "poll_url": f"/api/tasks/{task_id}"}

    async def worker() -> None:
        def report(percent: float, message: str) -> None:
            report_task_progress(task_id, progress=round(percent), message=message)

        try:
            await asyncio.to_thread(
                create_or_replace_fem_model,
                project,
                uploads,
                on_progress=report,
            )
            succeed_task(task_id, message="FEM 模型解析完成")
        except FemModelError as exc:
            fail_task(task_id, error=str(exc))
        except Exception:
            logger.exception("FEM model import failed project_id=%s", project_id)
            fail_task(task_id, error="服务器内部错误，请查看后端日志")

    asyncio.create_task(worker())
    return payload


@router.delete("/{project_id}/fem")
def remove_project_fem_model(project_id: int, db: Session = Depends(get_db)) -> dict:
    """删除项目 FEM 模型（记录 + 产物目录）。"""
    project = _get_project(project_id, db)
    delete_fem_model(project)
    return {"ok": True}


def _fem_dir_or_404(project: Project) -> Path:
    fem_dir = resolve_fem_artifact_dir(project)
    if fem_dir is None:
        raise HTTPException(status_code=404, detail="该项目的 FEM 模型尚未生成或已删除")
    return fem_dir


@router.get("/{project_id}/fem/model.glb")
def get_project_fem_glb(project_id: int, db: Session = Depends(get_db)) -> FileResponse:
    project = _get_project(project_id, db)
    fem_dir = _fem_dir_or_404(project)
    return FileResponse(fem_dir / "model.glb", media_type="model/gltf-binary")


@router.get("/{project_id}/fem/mapping.json")
def get_project_fem_mapping(project_id: int, db: Session = Depends(get_db)) -> FileResponse:
    project = _get_project(project_id, db)
    fem_dir = _fem_dir_or_404(project)
    return FileResponse(fem_dir / "mapping.json", media_type="application/json")


@router.get("/{project_id}/fem/preview.json")
def get_project_fem_preview_json(project_id: int, db: Session = Depends(get_db)) -> FileResponse:
    project = _get_project(project_id, db)
    preview_path = safe_fem_dir(project.project_id) / "preview.json"
    if not preview_path.is_file():
        raise HTTPException(status_code=404, detail="该项目的 FEM 预览信息不存在")
    return FileResponse(preview_path, media_type="application/json")


# ── 点位 ↔ FEM 单元绑定（模型预览页气泡展示依据） ──────────────────────────


def _binding_payload(binding: models.PointElementBinding, point: models.TestPoint) -> dict:
    return {
        "point_db_id": binding.point_db_id,
        "point_id": point.point_id,
        "point_name": point.point_name,
        "element_id": binding.element_id,
    }


@router.get("/{project_id}/point-bindings")
def list_point_bindings(project_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """列出项目内全部点位-单元绑定（附点位编号/名称，供前端气泡展示）。"""
    project = _get_project(project_id, db)
    rows = db.execute(
        select(models.PointElementBinding, models.TestPoint)
        .join(models.TestPoint, models.PointElementBinding.point_db_id == models.TestPoint.id)
        .where(models.PointElementBinding.project_db_id == project.id)
        .where(models.TestPoint.deleted_at.is_(None))
        .order_by(models.TestPoint.point_id)
    ).all()
    return [_binding_payload(binding, point) for binding, point in rows]


@router.put("/{project_id}/point-bindings")
def upsert_point_binding(project_id: int, payload: PointBindingUpsert, db: Session = Depends(get_db)) -> dict:
    """绑定/更新一个点到单元的绑定（一个点位只保留一条绑定记录）。"""
    project = _get_project(project_id, db)
    point = db.execute(
        select(models.TestPoint).where(
            models.TestPoint.id == payload.point_db_id,
            models.TestPoint.project_db_id == project.id,
            models.TestPoint.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在或不属于当前项目")

    binding = db.scalar(
        select(models.PointElementBinding).where(
            models.PointElementBinding.project_db_id == project.id,
            models.PointElementBinding.point_db_id == point.id,
        )
    )
    if binding:
        binding.element_id = payload.element_id
    else:
        binding = models.PointElementBinding(
            project_db_id=project.id,
            point_db_id=point.id,
            element_id=payload.element_id,
        )
        db.add(binding)
    db.commit()
    db.refresh(binding)
    return _binding_payload(binding, point)


@router.delete("/{project_id}/point-bindings/{point_db_id}")
def delete_point_binding(project_id: int, point_db_id: int, db: Session = Depends(get_db)) -> dict:
    """解除一个点位的单元绑定。"""
    project = _get_project(project_id, db)
    binding = db.scalar(
        select(models.PointElementBinding).where(
            models.PointElementBinding.project_db_id == project.id,
            models.PointElementBinding.point_db_id == point_db_id,
        )
    )
    if not binding:
        raise HTTPException(status_code=404, detail="该点位尚未绑定单元")
    db.delete(binding)
    db.commit()
    return {"ok": True}
