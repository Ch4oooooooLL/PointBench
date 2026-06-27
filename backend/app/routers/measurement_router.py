from collections import defaultdict
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl import load_workbook
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import (
    MeasurementBatchCreate,
    MeasurementCreate,
    MeasurementOut,
    MeasurementUpdate,
    PointMeasurementRowCreate,
    PointMeasurementRowOut,
    PointMeasurementRowUpdate,
    TestRunOut,
    TestRunUpdate,
)
from app.services.analysis_service import compute_measurement_fields, refresh_point_abnormal_flags


router = APIRouter(tags=["measurements"])

REQUIRED_XLSX_HEADERS = ["run_name", "cycle_count", "point_id", "max_strain_ue", "min_strain_ue"]


def apply_measurement_payload(record: models.MeasurementRecord, payload: MeasurementCreate | MeasurementUpdate) -> None:
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(record, field, value)
    compute_measurement_fields(record)
    if data.get("is_abnormal") is True:
        record.is_abnormal = True
        record.abnormal_reason = data.get("abnormal_reason") or "人工标记异常"


def _cell_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _cell_number(value: Any, row_number: int, field: str) -> float | None:
    text = _cell_text(value)
    if text == "":
        return None
    try:
        return float(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"第 {row_number} 行 {field} 不是数字: {text}") from exc


def _parse_xlsx_rows(file_bytes: bytes) -> list[dict[str, Any]]:
    try:
        workbook = load_workbook(BytesIO(file_bytes), data_only=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法读取 XLSX 文件: {exc}") from exc
    if not workbook.worksheets:
        raise HTTPException(status_code=400, detail="XLSX 文件中没有工作表")

    sheet = workbook["measurements"] if "measurements" in workbook.sheetnames else workbook.worksheets[0]
    headers = [_cell_text(cell.value) for cell in sheet[1]]
    header_index = {header: index for index, header in enumerate(headers) if header}
    missing = [header for header in REQUIRED_XLSX_HEADERS if header not in header_index]
    if missing:
        raise HTTPException(status_code=400, detail=f"模板缺少表头: {', '.join(missing)}")

    rows: list[dict[str, Any]] = []
    for row_number, cells in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        row = {header: cells[index] if index < len(cells) else None for header, index in header_index.items()}
        if not any(_cell_text(row.get(field)) for field in ["max_strain_ue", "min_strain_ue", "remark"]):
            continue
        run_name = _cell_text(row.get("run_name"))
        cycle_count_text = _cell_text(row.get("cycle_count"))
        point_id = _cell_text(row.get("point_id"))
        if not run_name:
            raise HTTPException(status_code=400, detail=f"第 {row_number} 行缺少 run_name")
        if not cycle_count_text:
            raise HTTPException(status_code=400, detail=f"第 {row_number} 行缺少 cycle_count")
        try:
            cycle_count = int(float(cycle_count_text))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"第 {row_number} 行 cycle_count 不是数字: {cycle_count_text}") from exc
        if not point_id:
            raise HTTPException(status_code=400, detail=f"第 {row_number} 行缺少 point_id")

        rows.append(
            {
                "row_number": row_number,
                "run_name": run_name,
                "cycle_count": cycle_count,
                "test_time": _cell_text(row.get("test_time")) or None,
                "point_id": point_id,
                "max_strain_ue": _cell_number(row.get("max_strain_ue"), row_number, "max_strain_ue"),
                "min_strain_ue": _cell_number(row.get("min_strain_ue"), row_number, "min_strain_ue"),
                "remark": _cell_text(row.get("remark")) or None,
            }
        )
    if not rows:
        raise HTTPException(status_code=400, detail="没有可导入的数据，请至少填写最大应变或最小应变")
    return rows


def _create_or_update_measurement(
    db: Session,
    run_id: int,
    point_db_id: int,
    max_strain_ue: float | None,
    min_strain_ue: float | None,
    remark: str | None,
) -> models.MeasurementRecord:
    record = db.scalar(
        select(models.MeasurementRecord).where(
            models.MeasurementRecord.run_id == run_id,
            models.MeasurementRecord.point_db_id == point_db_id,
        )
    )
    if not record:
        record = models.MeasurementRecord(run_id=run_id, point_db_id=point_db_id)
    record.max_strain_ue = max_strain_ue
    record.min_strain_ue = min_strain_ue
    record.remark = remark
    compute_measurement_fields(record)
    db.add(record)
    return record


def _measurement_row_out(record: models.MeasurementRecord) -> PointMeasurementRowOut:
    data = MeasurementOut.model_validate(record).model_dump()
    data["run_name"] = record.run.run_name
    data["cycle_count"] = record.run.cycle_count
    return PointMeasurementRowOut.model_validate(data)


def _measurement_payload_from_row(payload: PointMeasurementRowCreate | PointMeasurementRowUpdate) -> MeasurementUpdate:
    data = payload.model_dump(exclude_unset=True)
    return MeasurementUpdate(
        **{
            key: data[key]
            for key in ["max_strain_ue", "min_strain_ue", "is_abnormal", "abnormal_reason", "remark"]
            if key in data
        }
    )


def _run_measurement_count(db: Session, run_id: int, exclude_measurement_id: int | None = None) -> int:
    query = select(func.count()).select_from(models.MeasurementRecord).where(models.MeasurementRecord.run_id == run_id)
    if exclude_measurement_id is not None:
        query = query.where(models.MeasurementRecord.id != exclude_measurement_id)
    return db.scalar(query) or 0


def _find_named_run(db: Session, project_id: int, cycle_count: int, run_name: str) -> models.TestRun | None:
    return db.scalar(
        select(models.TestRun)
        .where(
            models.TestRun.project_db_id == project_id,
            models.TestRun.cycle_count == cycle_count,
            models.TestRun.run_name == run_name,
        )
        .order_by(models.TestRun.id)
    )


def _find_run_by_cycle(db: Session, project_id: int, cycle_count: int) -> models.TestRun | None:
    return db.scalar(
        select(models.TestRun)
        .where(models.TestRun.project_db_id == project_id, models.TestRun.cycle_count == cycle_count)
        .order_by(models.TestRun.id)
    )


@router.get("/api/test-runs/{run_id}", response_model=TestRunOut)
def get_test_run(run_id: int, db: Session = Depends(get_db)) -> TestRunOut:
    run = db.get(models.TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="测试轮次不存在")
    return TestRunOut.model_validate(run)


@router.put("/api/test-runs/{run_id}", response_model=TestRunOut)
def update_test_run(run_id: int, payload: TestRunUpdate, db: Session = Depends(get_db)) -> TestRunOut:
    run = db.get(models.TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="测试轮次不存在")
    data = payload.model_dump(exclude_unset=True)
    if "run_name" in data:
        run_name = (data["run_name"] or "").strip()
        if not run_name:
            raise HTTPException(status_code=400, detail="测试轮次名称不能为空")
        run.run_name = run_name
    if "cycle_count" in data and data["cycle_count"] is not None:
        run.cycle_count = data["cycle_count"]
    if "test_time" in data:
        run.test_time = data["test_time"]
    if "remark" in data:
        run.remark = data["remark"]
    db.commit()
    db.refresh(run)
    return TestRunOut.model_validate(run)


@router.delete("/api/test-runs/{run_id}")
def delete_test_run(run_id: int, db: Session = Depends(get_db)) -> dict:
    run = db.get(models.TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="测试轮次不存在")
    point_ids = [record.point_db_id for record in run.measurements]
    db.delete(run)
    db.flush()
    for point_id in set(point_ids):
        refresh_point_abnormal_flags(db, point_id)
    db.commit()
    return {"ok": True}


@router.post("/api/test-runs/{run_id}/measurements", response_model=list[MeasurementOut])
def create_measurements(run_id: int, payload: MeasurementBatchCreate, db: Session = Depends(get_db)) -> list[MeasurementOut]:
    run = db.get(models.TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="测试轮次不存在")
    created: list[models.MeasurementRecord] = []
    for item in payload.measurements:
        point = db.get(models.TestPoint, item.point_db_id)
        if not point or point.project_db_id != run.project_db_id:
            raise HTTPException(status_code=400, detail=f"点位不属于当前项目: {item.point_db_id}")
        existing = db.scalar(
            select(models.MeasurementRecord).where(
                models.MeasurementRecord.run_id == run_id,
                models.MeasurementRecord.point_db_id == item.point_db_id,
            )
        )
        record = existing or models.MeasurementRecord(run_id=run_id, point_db_id=item.point_db_id)
        apply_measurement_payload(record, item)
        db.add(record)
        created.append(record)
    db.flush()
    for point_id in {record.point_db_id for record in created}:
        refresh_point_abnormal_flags(db, point_id)
    db.commit()
    for record in created:
        db.refresh(record)
    return [MeasurementOut.model_validate(record) for record in created]


@router.post("/api/projects/{project_id}/measurements/import-xlsx")
async def import_project_measurements_xlsx(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="请上传 XLSX/XLSM 文件，旧版 .xls 格式暂不支持")

    rows = _parse_xlsx_rows(await file.read())
    points = db.execute(select(models.TestPoint).where(models.TestPoint.project_db_id == project_id)).scalars().all()
    point_by_id = {point.point_id: point for point in points}
    for row in rows:
        if row["point_id"] not in point_by_id:
            raise HTTPException(status_code=400, detail=f"第 {row['row_number']} 行点位编号不存在: {row['point_id']}")

    groups: dict[tuple[str, int, str | None], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[(row["run_name"], row["cycle_count"], row["test_time"])].append(row)

    created_runs = 0
    measurement_count = 0
    affected_point_ids: set[int] = set()
    for (run_name, cycle_count, test_time), group_rows in sorted(groups.items(), key=lambda item: item[0][1]):
        run = db.scalar(
            select(models.TestRun).where(
                models.TestRun.project_db_id == project_id,
                models.TestRun.run_name == run_name,
                models.TestRun.cycle_count == cycle_count,
            )
        )
        if not run:
            run = models.TestRun(
                project_db_id=project_id,
                run_name=run_name,
                cycle_count=cycle_count,
                test_time=test_time,
                remark=f"XLSX import: {file.filename}",
            )
            db.add(run)
            db.flush()
            created_runs += 1
        for row in group_rows:
            point = point_by_id[row["point_id"]]
            record = _create_or_update_measurement(
                db,
                run.id,
                point.id,
                row["max_strain_ue"],
                row["min_strain_ue"],
                row["remark"],
            )
            measurement_count += 1
            affected_point_ids.add(record.point_db_id)

    db.flush()
    for point_id in affected_point_ids:
        refresh_point_abnormal_flags(db, point_id)
    db.commit()
    return {
        "ok": True,
        "run_count": len(groups),
        "created_run_count": created_runs,
        "measurement_count": measurement_count,
    }


@router.get("/api/test-runs/{run_id}/measurements", response_model=list[MeasurementOut])
def list_run_measurements(run_id: int, db: Session = Depends(get_db)) -> list[MeasurementOut]:
    records = db.execute(
        select(models.MeasurementRecord).where(models.MeasurementRecord.run_id == run_id).order_by(models.MeasurementRecord.point_db_id)
    ).scalars()
    return [MeasurementOut.model_validate(record) for record in records]


@router.get("/api/points/{point_id}/measurements", response_model=list[MeasurementOut])
def list_point_measurements(point_id: int, db: Session = Depends(get_db)) -> list[MeasurementOut]:
    records = db.execute(
        select(models.MeasurementRecord)
        .join(models.TestRun)
        .where(models.MeasurementRecord.point_db_id == point_id)
        .order_by(models.TestRun.cycle_count, models.TestRun.id)
    ).scalars()
    return [MeasurementOut.model_validate(record) for record in records]


@router.get("/api/points/{point_id}/measurement-rows", response_model=list[PointMeasurementRowOut])
def list_point_measurement_rows(point_id: int, db: Session = Depends(get_db)) -> list[PointMeasurementRowOut]:
    records = db.execute(
        select(models.MeasurementRecord)
        .join(models.TestRun)
        .where(models.MeasurementRecord.point_db_id == point_id)
        .order_by(models.TestRun.cycle_count, models.TestRun.id)
    ).scalars()
    return [_measurement_row_out(record) for record in records]


@router.post("/api/points/{point_id}/measurement-rows", response_model=PointMeasurementRowOut)
def create_point_measurement_row(
    point_id: int,
    payload: PointMeasurementRowCreate,
    db: Session = Depends(get_db),
) -> PointMeasurementRowOut:
    point = db.get(models.TestPoint, point_id)
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在")
    run = db.scalar(
        select(models.TestRun).where(
            models.TestRun.project_db_id == point.project_db_id,
            models.TestRun.cycle_count == payload.cycle_count,
        )
    )
    if not run:
        run = models.TestRun(
            project_db_id=point.project_db_id,
            run_name=(payload.run_name or f"R{payload.cycle_count}").strip() or f"R{payload.cycle_count}",
            cycle_count=payload.cycle_count,
        )
        db.add(run)
        db.flush()
    elif payload.run_name and _run_measurement_count(db, run.id) == 0:
        run.run_name = payload.run_name.strip() or run.run_name
    record = db.scalar(
        select(models.MeasurementRecord).where(
            models.MeasurementRecord.run_id == run.id,
            models.MeasurementRecord.point_db_id == point.id,
        )
    )
    if not record:
        record = models.MeasurementRecord(run_id=run.id, point_db_id=point.id)
    apply_measurement_payload(record, _measurement_payload_from_row(payload))
    db.add(record)
    db.flush()
    refresh_point_abnormal_flags(db, point.id)
    db.commit()
    db.refresh(record)
    return _measurement_row_out(record)


@router.put("/api/points/{point_id}/measurement-rows/{measurement_id}", response_model=PointMeasurementRowOut)
def update_point_measurement_row(
    point_id: int,
    measurement_id: int,
    payload: PointMeasurementRowUpdate,
    db: Session = Depends(get_db),
) -> PointMeasurementRowOut:
    record = db.get(models.MeasurementRecord, measurement_id)
    if not record or record.point_db_id != point_id:
        raise HTTPException(status_code=404, detail="测量记录不存在")
    data = payload.model_dump(exclude_unset=True)
    next_cycle_count = data["cycle_count"] if data.get("cycle_count") is not None else record.run.cycle_count
    next_run_name = data["run_name"].strip() if data.get("run_name") is not None else record.run.run_name
    next_run_name = next_run_name or record.run.run_name or f"R{next_cycle_count}"
    run_changed = next_cycle_count != record.run.cycle_count or next_run_name != record.run.run_name

    if run_changed:
        if next_cycle_count == record.run.cycle_count and _run_measurement_count(db, record.run_id, measurement_id) == 0:
            record.run.run_name = next_run_name
        else:
            target_run = _find_named_run(db, record.point.project_db_id, next_cycle_count, next_run_name)
            if not target_run and "run_name" not in data:
                target_run = _find_run_by_cycle(db, record.point.project_db_id, next_cycle_count)
            if not target_run:
                target_run = models.TestRun(
                    project_db_id=record.point.project_db_id,
                    run_name=next_run_name,
                    cycle_count=next_cycle_count,
                )
                db.add(target_run)
                db.flush()

            existing = db.scalar(
                select(models.MeasurementRecord).where(
                    models.MeasurementRecord.run_id == target_run.id,
                    models.MeasurementRecord.point_db_id == record.point_db_id,
                    models.MeasurementRecord.id != record.id,
                )
            )
            if existing:
                raise HTTPException(status_code=400, detail="目标循环次数下已存在该点位的测量记录，请先编辑或删除已有记录")
            record.run = target_run
    apply_measurement_payload(record, _measurement_payload_from_row(payload))
    db.flush()
    refresh_point_abnormal_flags(db, record.point_db_id)
    db.commit()
    db.refresh(record)
    return _measurement_row_out(record)


@router.delete("/api/points/{point_id}/measurement-rows/{measurement_id}")
def delete_point_measurement_row(point_id: int, measurement_id: int, db: Session = Depends(get_db)) -> dict:
    record = db.get(models.MeasurementRecord, measurement_id)
    if not record or record.point_db_id != point_id:
        raise HTTPException(status_code=404, detail="测量记录不存在")
    db.delete(record)
    db.flush()
    refresh_point_abnormal_flags(db, point_id)
    db.commit()
    return {"ok": True}


@router.put("/api/measurements/{measurement_id}", response_model=MeasurementOut)
def update_measurement(measurement_id: int, payload: MeasurementUpdate, db: Session = Depends(get_db)) -> MeasurementOut:
    record = db.get(models.MeasurementRecord, measurement_id)
    if not record:
        raise HTTPException(status_code=404, detail="测量记录不存在")
    apply_measurement_payload(record, payload)
    db.flush()
    refresh_point_abnormal_flags(db, record.point_db_id)
    db.commit()
    db.refresh(record)
    return MeasurementOut.model_validate(record)


@router.delete("/api/measurements/{measurement_id}")
def delete_measurement(measurement_id: int, db: Session = Depends(get_db)) -> dict:
    record = db.get(models.MeasurementRecord, measurement_id)
    if not record:
        raise HTTPException(status_code=404, detail="测量记录不存在")
    point_id = record.point_db_id
    db.delete(record)
    db.flush()
    refresh_point_abnormal_flags(db, point_id)
    db.commit()
    return {"ok": True}
