import csv
import io
import json
import shutil

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app import models
from app.database import STORAGE_DIR, get_db
from app.schemas import PointCreate, PointOut, ProjectCreate, ProjectOut, ProjectUpdate, TestRunCreate, TestRunOut
from app.services.dewesoft_service import delete_dewesoft_project_files


router = APIRouter(prefix="/api/projects", tags=["projects"])


def project_out(db: Session, project: models.Project) -> ProjectOut:
    count = db.scalar(select(func.count()).select_from(models.TestPoint).where(models.TestPoint.project_db_id == project.id)) or 0
    data = ProjectOut.model_validate(project)
    data.point_count = count
    return data


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
    projects = db.execute(select(models.Project).order_by(models.Project.updated_at.desc())).scalars().all()
    return [project_out(db, project) for project in projects]


@router.post("", response_model=ProjectOut)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> ProjectOut:
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
    (STORAGE_DIR / "projects" / project.project_id).mkdir(parents=True, exist_ok=True)
    return project_out(db, project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)) -> ProjectOut:
    project = db.get(models.Project, project_id)
    if not project:
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
def delete_project(project_id: int, db: Session = Depends(get_db)) -> dict:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    project_storage = STORAGE_DIR / "projects" / project.project_id
    dewesoft_project_id = project.project_id
    if project_storage.exists():
        shutil.rmtree(project_storage)
    delete_dewesoft_project_files(dewesoft_project_id)
    db.delete(project)
    db.commit()
    return {"ok": True}


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
    point_id = (data.get("point_id") or _next_point_id(db, project_id)).strip()
    if not point_id:
        raise HTTPException(status_code=400, detail="点位编号不能为空")
    exists = db.scalar(
        select(models.TestPoint).where(models.TestPoint.project_db_id == project_id, models.TestPoint.point_id == point_id)
    )
    if exists:
        raise HTTPException(status_code=400, detail="点位编号已存在")
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
    db.commit()
    db.refresh(point)
    return PointOut.model_validate(point)


@router.post("/{project_id}/test-runs", response_model=TestRunOut)
def create_test_run(project_id: int, payload: TestRunCreate, db: Session = Depends(get_db)) -> TestRunOut:
    if not db.get(models.Project, project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    run = models.TestRun(project_db_id=project_id, **payload.model_dump())
    db.add(run)
    db.commit()
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
