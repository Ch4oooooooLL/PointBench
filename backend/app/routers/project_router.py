import csv
import hashlib
import io
import json
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from datetime import datetime

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
DELETE_EXPORT_DIR = STORAGE_DIR / "delete_exports"


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
    db.commit()
    db.refresh(project)
    safe_project_dir(project.project_id).mkdir(parents=True, exist_ok=True)
    log_action(db, "create", "project", project.project_id, project.project_id, f"创建项目 {project.project_name}", user_id=_admin.username)
    return project_out(db, project)


def build_delete_export(db: Session, project_id: int) -> dict:
    try:
        zip_path, _zip_name = build_project_export_zip(db, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="项目不存在") from exc

    DELETE_EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
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
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)) -> ProjectOut:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    data = payload.model_dump(exclude_unset=True)
    if "project_name" in data and not data["project_name"]:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    for field, value in data.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project_out(db, project)


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    permanent: bool = True,
    db: Session = Depends(get_db),
) -> dict:
    """删除项目。默认彻底删除；permanent=false 时保留软删除分支。"""
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    delete_export = build_delete_export(db, project_id)

    if permanent:
        project_storage = safe_project_dir(project.project_id)
        if project_storage.exists():
            shutil.rmtree(project_storage)
        delete_dewesoft_project_files(project.project_id)
        db.delete(project)
        log_action(db, "delete_permanent", "project", project.project_id, project.project_id, f"永久删除项目 {project.project_name}")
        db.commit()
        return {"ok": True, "action": "permanently_deleted", **delete_export}

    # 软删除：标记项目及其关联数据
    project.deleted_at = datetime.utcnow()
    for point in project.points:
        point.deleted_at = datetime.utcnow()
        for media in point.media_files:
            media.deleted_at = datetime.utcnow()
        for crack in point.crack_records:
            crack.deleted_at = datetime.utcnow()
    for run in project.test_runs:
        run.deleted_at = datetime.utcnow()
        for measurement in run.measurements:
            measurement.deleted_at = datetime.utcnow()
    for media in project.media_files:
        media.deleted_at = datetime.utcnow()
    for crack in project.crack_records:
        crack.deleted_at = datetime.utcnow()
    log_action(db, "delete_soft", "project", project.project_id, project.project_id, f"软删除项目 {project.project_name}")
    db.commit()
    return {"ok": True, "action": "soft_deleted", "message": "项目已移至回收站，可联系管理员恢复", **delete_export}


@router.get("/{project_id}/points")
def list_project_points(project_id: int, db: Session = Depends(get_db)) -> list[dict]:
    project = db.get(models.Project, project_id)
    if not project:
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
    runs = db.execute(
        select(models.TestRun).where(models.TestRun.project_db_id == project_id).order_by(models.TestRun.cycle_count, models.TestRun.id)
    ).scalars()
    return [TestRunOut.model_validate(run) for run in runs]


@router.get("/{project_id}/export.json")
def export_project_json(project_id: int, db: Session = Depends(get_db)) -> Response:
    project = db.get(models.Project, project_id)
    if not project:
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
    if not project:
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


@router.get("/{project_id}/export.zip")
def export_project_zip(project_id: int, db: Session = Depends(get_db)) -> FileResponse:
    try:
        zip_path, zip_name = build_project_export_zip(db, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="项目不存在") from exc
    return FileResponse(zip_path, filename=zip_name, media_type="application/zip")
