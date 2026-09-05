import csv
import hashlib
import io
import json
import logging
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import models
from app.database import STORAGE_DIR, get_db
from app.schemas import PointCreate, PointOut, ProjectCacheVersionOut, ProjectCreate, ProjectOut, ProjectUpdate, TestRunCreate, TestRunOut
from app.services.dewesoft_service import delete_dewesoft_project_files
from app.services.project_export_service import build_project_export_zip
from app.utils.audit_utils import log_action
from app.utils.auth_utils import require_role
from app.utils.path_utils import safe_project_dir


router = APIRouter(prefix="/api/projects", tags=["projects"])
logger = logging.getLogger("app.project_router")
DELETE_EXPORT_DIR = STORAGE_DIR / "delete_exports"


def _request_client_info(request: Request) -> dict:
    """提取客户端 IP 与 User-Agent，用于审计日志。"""
    client = request.client
    client_ip = client.host if client else None
    if client_ip and request.headers.get("x-forwarded-for"):
        client_ip = request.headers.get("x-forwarded-for").split(",")[0].strip()
    return {
        "client_ip": client_ip,
        "user_agent": (request.headers.get("user-agent") or None),
    }


def project_out(db: Session, project: models.Project) -> ProjectOut:
    count = db.scalar(select(func.count()).select_from(models.TestPoint).where(models.TestPoint.project_db_id == project.id)) or 0
    data = ProjectOut.model_validate(project)
    data.point_count = count
    return data


def _normalize_version_value(value: object) -> str | int | None:
    if isinstance(value, datetime):
        return value.isoformat(timespec="microseconds")
    return value  # type: ignore[return-value]


def _cache_stat_values(db: Session, statement) -> list[str | int | None]:
    row = db.execute(statement).one()
    return [_normalize_version_value(value) for value in row]


def project_cache_version(db: Session, project_id: int, scope: str) -> str:
    project = db.get(models.Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")

    scoped_stats: list[tuple[str, list[str | int | None]]] = [
        (
            "project",
            [
                project.id,
                project.project_id,
                _normalize_version_value(project.updated_at),
                _normalize_version_value(project.deleted_at),
            ],
        ),
        (
            "points",
            _cache_stat_values(
                db,
                select(
                    func.count(models.TestPoint.id),
                    func.max(models.TestPoint.id),
                    func.max(models.TestPoint.updated_at),
                    func.max(models.TestPoint.deleted_at),
                ).where(models.TestPoint.project_db_id == project_id),
            ),
        ),
        (
            "test_runs",
            _cache_stat_values(
                db,
                select(
                    func.count(models.TestRun.id),
                    func.max(models.TestRun.id),
                    func.max(models.TestRun.created_at),
                    func.max(models.TestRun.deleted_at),
                ).where(models.TestRun.project_db_id == project_id),
            ),
        ),
        (
            "measurements",
            _cache_stat_values(
                db,
                select(
                    func.count(models.MeasurementRecord.id),
                    func.max(models.MeasurementRecord.id),
                    func.max(models.MeasurementRecord.updated_at),
                    func.max(models.MeasurementRecord.deleted_at),
                )
                .join(models.TestPoint, models.MeasurementRecord.point_db_id == models.TestPoint.id)
                .where(models.TestPoint.project_db_id == project_id),
            ),
        ),
        (
            "sensor_channels",
            _cache_stat_values(
                db,
                select(func.count(models.SensorChannel.id), func.max(models.SensorChannel.id))
                .join(models.TestPoint, models.SensorChannel.point_db_id == models.TestPoint.id)
                .where(models.TestPoint.project_db_id == project_id),
            ),
        ),
        (
            "media_files",
            _cache_stat_values(
                db,
                select(
                    func.count(models.MediaFile.id),
                    func.max(models.MediaFile.id),
                    func.max(models.MediaFile.deleted_at),
                ).where(models.MediaFile.project_db_id == project_id),
            ),
        ),
        (
            "cae_mappings",
            _cache_stat_values(
                db,
                select(func.count(models.CaeMapping.id), func.max(models.CaeMapping.id))
                .join(models.TestPoint, models.CaeMapping.point_db_id == models.TestPoint.id)
                .where(models.TestPoint.project_db_id == project_id),
            ),
        ),
    ]

    if scope == "overview":
        scoped_stats.append(
            (
                "crack_records",
                _cache_stat_values(
                    db,
                    select(
                        func.count(models.CrackRecord.id),
                        func.max(models.CrackRecord.id),
                        func.max(models.CrackRecord.updated_at),
                        func.max(models.CrackRecord.deleted_at),
                    ).where(models.CrackRecord.project_db_id == project_id),
                ),
            )
        )

    payload = json.dumps(scoped_stats, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
    projects = db.execute(
        select(models.Project)
        .where(models.Project.deleted_at.is_(None))
        .order_by(models.Project.updated_at.desc())
    ).scalars().all()
    return [project_out(db, project) for project in projects]


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectCreate,
    request: Request,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_role("admin")),
) -> ProjectOut:
    project_id = payload.project_id.strip()
    project_name = payload.project_name.strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="项目 ID 不能为空")
    if not project_name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    exists = db.scalar(select(models.Project).where(models.Project.project_id == project_id))
    if exists:
        raise HTTPException(status_code=400, detail="项目 ID 已存在")
    project = models.Project(
        project_id=project_id,
        project_name=project_name,
        test_object=payload.test_object,
        test_type=payload.test_type,
        department=payload.department,
        vehicle_or_product=payload.vehicle_or_product,
        test_stage=payload.test_stage,
        description=payload.description,
        raw_manifest_json=json.dumps({"source": "manual"}, ensure_ascii=False),
    )
    db.add(project)
    # 审计日志必须在 commit 之前加入 session，否则 session 关闭时审计记录会被回滚丢弃
    client_info = _request_client_info(request)
    log_action(
        db,
        "create",
        "project",
        project.project_id,
        project.project_id,
        f"创建项目 {project.project_name}",
        user_id=_admin.username,
        client_ip=client_info["client_ip"],
        user_agent=client_info["user_agent"],
    )
    db.commit()
    db.refresh(project)
    safe_project_dir(project.project_id).mkdir(parents=True, exist_ok=True)
    return project_out(db, project)


def build_delete_export(db: Session, project_id: int) -> dict:
    try:
        zip_path, _zip_name = build_project_export_zip(db, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="项目不存在") from exc

    DELETE_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y%m%d%H%M%S")
    filename = f"deleted_project_{project_id}_{timestamp}_{uuid.uuid4().hex[:8]}.zip"
    target = DELETE_EXPORT_DIR / filename
    shutil.move(str(zip_path), target)
    shutil.rmtree(zip_path.parent, ignore_errors=True)
    return {
        "export_filename": filename,
        "export_download_url": f"/api/projects/delete-exports/{filename}",
    }


@router.get("/delete-exports/{filename}")
def download_delete_export(filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename or not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="无效导出文件名")
    path = DELETE_EXPORT_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="导出文件不存在")
    return FileResponse(path, filename=filename, media_type="application/zip")


@router.get("/{project_id}/cache-version", response_model=ProjectCacheVersionOut)
def get_project_cache_version(
    project_id: int,
    scope: str = Query(default="detail", pattern="^(detail|overview)$"),
    db: Session = Depends(get_db),
) -> ProjectCacheVersionOut:
    return ProjectCacheVersionOut(project_db_id=project_id, scope=scope, version=project_cache_version(db, project_id, scope))


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)) -> ProjectOut:
    project = db.get(models.Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project_out(db, project)


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, payload: ProjectUpdate, request: Request, db: Session = Depends(get_db)) -> ProjectOut:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    data = payload.model_dump(exclude_unset=True)
    if "project_name" in data and not data["project_name"]:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    before = project_out(db, project).model_dump()
    for field, value in data.items():
        setattr(project, field, value)
    client_info = _request_client_info(request)
    log_action(
        db,
        "update",
        "project",
        project.project_id,
        project.project_id,
        f"更新项目 {project.project_name}",
        before=before,
        after=project_out(db, project).model_dump(),
        client_ip=client_info["client_ip"],
        user_agent=client_info["user_agent"],
    )
    db.commit()
    db.refresh(project)
    return project_out(db, project)


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    request: Request,
    permanent: bool = True,
    db: Session = Depends(get_db),
) -> dict:
    """删除项目。默认彻底删除；permanent=false 时保留软删除分支。"""
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    delete_export = build_delete_export(db, project_id)
    client_info = _request_client_info(request)

    if permanent:
        # 先执行 DB 删除并 commit，成功后再删除物理文件；DB 失败则保留文件
        project_id_value = project.project_id
        project_name_value = project.project_name
        db.delete(project)
        log_action(
            db,
            "delete_permanent",
            "project",
            project_id_value,
            project_id_value,
            f"永久删除项目 {project_name_value}",
            user_id=None,
            client_ip=client_info["client_ip"],
            user_agent=client_info["user_agent"],
        )
        db.commit()
        # 物理文件清理：数据库删除已成功，清理尽力而为。Windows 下文件可能
        # 被外部程序短暂占用（例如用户正打开导出的记录、Dewesoft 运行库延迟
        # 释放句柄），此时不应让删除接口报错——残留文件仅占空间，不产生脏数据。
        try:
            project_storage = safe_project_dir(project_id_value)
            if project_storage.exists():
                shutil.rmtree(project_storage)
            delete_dewesoft_project_files(project_id_value)
        except Exception:
            logger.exception("Project deleted from DB but physical file cleanup failed: %s", project_id_value)
        return {"ok": True, "action": "permanently_deleted", **delete_export}

    # 软删除：标记项目及其关联数据
    now_value = datetime.now(timezone.utc).replace(tzinfo=None)
    project.deleted_at = now_value
    for point in project.points:
        point.deleted_at = now_value
        for media in point.media_files:
            media.deleted_at = now_value
        for crack in point.crack_records:
            crack.deleted_at = now_value
    for run in project.test_runs:
        run.deleted_at = now_value
        for measurement in run.measurements:
            measurement.deleted_at = now_value
    for media in project.media_files:
        media.deleted_at = now_value
    for crack in project.crack_records:
        crack.deleted_at = now_value
    # 注：DewesoftImport 模型未定义 deleted_at 字段（非软删除 Mixin），
    # 软删除时无法标记，后续恢复/查询时需按项目维度过滤（本次范围外）。
    log_action(
        db,
        "delete_soft",
        "project",
        project.project_id,
        project.project_id,
        f"软删除项目 {project.project_name}",
        user_id=None,
        client_ip=client_info["client_ip"],
        user_agent=client_info["user_agent"],
    )
    db.commit()
    return {"ok": True, "action": "soft_deleted", "message": "项目已移至回收站，可联系管理员恢复", **delete_export}


@router.get("/{project_id}/points")
def list_project_points(project_id: int, db: Session = Depends(get_db)) -> list[dict]:
    project = db.get(models.Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")
    points = db.execute(
        select(models.TestPoint)
        .options(selectinload(models.TestPoint.channels), selectinload(models.TestPoint.media_files), selectinload(models.TestPoint.measurements))
        .where(models.TestPoint.project_db_id == project_id)
        .order_by(models.TestPoint.point_id)
    ).scalars()
    result = []
    for point in points:
        latest = sorted(point.measurements, key=lambda item: item.updated_at, reverse=True)[:1]
        result.append(
            {
                "id": point.id,
                "project_db_id": point.project_db_id,
                "point_id": point.point_id,
                "point_name": point.point_name,
                "point_type": point.point_type,
                "component": point.component,
                "side": point.side,
                "position_description": point.position_description,
                "direction": point.direction,
                "bridge_type": point.bridge_type,
                "resistance_ohm": point.resistance_ohm,
                "install_status": point.install_status,
                "check_status": point.check_status,
                "remark": point.remark,
                "channels": [
                    {
                        "id": channel.id,
                        "device": channel.device,
                        "channel_name": channel.channel_name,
                        "unit": channel.unit,
                        "sample_rate_hz": channel.sample_rate_hz,
                        "remark": channel.remark,
                    }
                    for channel in point.channels
                ],
                "media_files": [
                    {
                        "id": media.id,
                        "photo_id": media.photo_id,
                        "type": media.type,
                        "path": media.path,
                        "filename": media.filename,
                        "taken_time": media.taken_time,
                        "sha256": media.sha256,
                        "remark": media.remark,
                    }
                    for media in point.media_files
                ],
                "latest_measurement": {
                    "amplitude_strain_ue": latest[0].amplitude_strain_ue,
                    "stress_amplitude_mpa": latest[0].stress_amplitude_mpa,
                    "is_abnormal": latest[0].is_abnormal,
                }
                if latest
                else None,
            }
        )
    return result


def _next_point_id(db: Session, project_id: int) -> str:
    used = set(
        db.execute(select(models.TestPoint.point_id).where(models.TestPoint.project_db_id == project_id)).scalars().all()
    )
    index = 1
    while True:
        candidate = f"{index:02d}"
        if candidate not in used:
            return candidate
        index += 1


@router.post("/{project_id}/points", response_model=PointOut)
def create_project_point(project_id: int, payload: PointCreate | None = None, db: Session = Depends(get_db)) -> PointOut:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    data = payload.model_dump(exclude_unset=True) if payload else {}
    requested_point_id = (data.get("point_id") or "").strip()
    if data.get("point_id") is not None and not requested_point_id:
        raise HTTPException(status_code=400, detail="点位编号不能为空")

    for _ in range(3):
        point_id = requested_point_id or _next_point_id(db, project_id)
        exists = db.scalar(
            select(models.TestPoint).where(models.TestPoint.project_db_id == project_id, models.TestPoint.point_id == point_id)
        )
        if exists:
            if requested_point_id:
                raise HTTPException(status_code=400, detail="点位编号已存在")
            continue
        point = models.TestPoint(
            project_db_id=project_id,
            point_id=point_id,
            point_name=(data.get("point_name") or "未命名点位").strip() or "未命名点位",
            point_type=(data.get("point_type") or "strain").strip() or "strain",
            component=data.get("component"),
            side=data.get("side"),
            position_description=data.get("position_description"),
            direction=data.get("direction"),
            bridge_type=data.get("bridge_type"),
            resistance_ohm=data.get("resistance_ohm"),
            install_status=(data.get("install_status") or "planned").strip() or "planned",
            check_status=data.get("check_status"),
            remark=data.get("remark"),
            raw_json=json.dumps({"source": "manual"}, ensure_ascii=False),
        )
        db.add(point)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            if requested_point_id:
                raise HTTPException(status_code=400, detail="点位编号已存在") from exc
            continue
        db.refresh(point)
        return PointOut.model_validate(point)

    raise HTTPException(status_code=409, detail="点位编号生成冲突，请重试")


@router.post("/{project_id}/test-runs", response_model=TestRunOut)
def create_test_run(project_id: int, payload: TestRunCreate, db: Session = Depends(get_db)) -> TestRunOut:
    if not db.get(models.Project, project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    existing = db.scalar(
        select(models.TestRun).where(
            models.TestRun.project_db_id == project_id,
            models.TestRun.cycle_count == payload.cycle_count,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"循环次数 {payload.cycle_count} 的测试轮次已存在，请使用不同的循环次数")
    run = models.TestRun(project_db_id=project_id, **payload.model_dump())
    db.add(run)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"循环次数 {payload.cycle_count} 的测试轮次已存在")
    db.refresh(run)
    return TestRunOut.model_validate(run)


@router.get("/{project_id}/test-runs", response_model=list[TestRunOut])
def list_test_runs(project_id: int, db: Session = Depends(get_db)) -> list[TestRunOut]:
    project = db.get(models.Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")
    runs = db.execute(
        select(models.TestRun).where(models.TestRun.project_db_id == project_id).order_by(models.TestRun.cycle_count, models.TestRun.id)
    ).scalars()
    return [TestRunOut.model_validate(run) for run in runs]


@router.get("/{project_id}/export.json")
def export_project_json(project_id: int, db: Session = Depends(get_db)) -> Response:
    project = db.get(models.Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")
    data = {
        "project": project_out(db, project).model_dump(mode="json"),
        "points": list_project_points(project_id, db),
        "test_runs": [TestRunOut.model_validate(run).model_dump(mode="json") for run in project.test_runs],
    }
    return Response(
        json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{project.project_id}.json"'},
    )


@router.get("/{project_id}/export.csv")
def export_project_csv(project_id: int, db: Session = Depends(get_db)) -> Response:
    project = db.get(models.Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "point_id",
            "point_name",
            "component",
            "run_name",
            "cycle_count",
            "max_strain_ue",
            "min_strain_ue",
            "amplitude_strain_ue",
            "stress_amplitude_mpa",
            "is_abnormal",
            "abnormal_reason",
        ]
    )
    rows = db.execute(
        select(models.TestPoint, models.TestRun, models.MeasurementRecord)
        .join(models.MeasurementRecord, models.MeasurementRecord.point_db_id == models.TestPoint.id, isouter=True)
        .join(models.TestRun, models.TestRun.id == models.MeasurementRecord.run_id, isouter=True)
        .where(models.TestPoint.project_db_id == project_id)
        .order_by(models.TestPoint.point_id, models.TestRun.cycle_count)
    ).all()
    for point, run, record in rows:
        writer.writerow(
            [
                point.point_id,
                point.point_name,
                point.component,
                run.run_name if run else "",
                run.cycle_count if run else "",
                record.max_strain_ue if record else "",
                record.min_strain_ue if record else "",
                record.amplitude_strain_ue if record else "",
                record.stress_amplitude_mpa if record else "",
                record.is_abnormal if record else "",
                record.abnormal_reason if record else "",
            ]
        )
    return Response(
        output.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{project.project_id}.csv"'},
    )


@router.post("/{project_id}/export")
async def export_project_zip(
    project_id: int,
    payload: dict | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """按勾选项打包导出项目 zip。

    前端先调用本接口启动后台打包任务并轮询进度；任务完成后通过
    ``GET /api/tasks/{task_id}`` 拿到 result.download_url 下载 zip。
    """
    project = db.get(models.Project, project_id)
    if not project or project.deleted_at is not None:
        raise HTTPException(status_code=404, detail="项目不存在")
    data = payload or {}
    include_dewesoft = bool(data.get("include_dewesoft", True))
    include_fem = bool(data.get("include_fem", True))

    from app.services import task_progress

    task_id = task_progress.start_task("项目导出")
    task_progress.report_task_progress(task_id, progress=0, message="正在准备导出…")

    def run_export() -> None:
        from app.database import SessionLocal

        worker_db = SessionLocal()
        try:
            zip_path, zip_name = build_project_export_zip(
                worker_db,
                project_id,
                include_dewesoft=include_dewesoft,
                include_fem=include_fem,
                on_progress=lambda percent, message: task_progress.report_task_progress(
                    task_id, progress=percent, message=message
                ),
            )
            # 移动到可下载位置（delete_exports 目录同款机制）。
            target_dir = DELETE_EXPORT_DIR
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / zip_name
            shutil.move(str(zip_path), target)
            shutil.rmtree(zip_path.parent, ignore_errors=True)
            task_progress.succeed_task(
                task_id,
                result={"download_url": f"/api/projects/exports/{zip_name}", "filename": zip_name},
                message="导出完成",
            )
        except Exception:
            logger.exception("project export failed project_id=%s", project_id)
            task_progress.fail_task(task_id, error="导出失败，请查看后端日志")
        finally:
            worker_db.close()

    import asyncio

    asyncio.create_task(asyncio.to_thread(run_export))
    return {"task_id": task_id, "status": "running", "poll_url": f"/api/tasks/{task_id}"}


@router.get("/exports/{filename}")
def download_project_export(filename: str) -> FileResponse:
    """下载已生成的导出 zip（导出任务完成后的 download_url）。"""
    if "/" in filename or "\\" in filename or not filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="无效导出文件名")
    path = DELETE_EXPORT_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="导出文件不存在或已过期")
    return FileResponse(path, filename=filename, media_type="application/zip")
