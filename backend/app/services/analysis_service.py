import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models


ELASTIC_MODULUS_MPA = 206000
STRAIN_TO_STRESS = ELASTIC_MODULUS_MPA * 1e-6


def _format_custom_fields(value: Any) -> str | None:
    if not isinstance(value, dict) or not value:
        return None
    pairs = [f"{key}: {item}" for key, item in value.items() if item not in (None, "")]
    return "；".join(pairs) if pairs else None


def _point_metadata(point: models.TestPoint) -> dict[str, Any]:
    raw: dict[str, Any] = {}
    try:
        raw = json.loads(point.raw_json) if point.raw_json else {}
    except json.JSONDecodeError:
        raw = {}

    channel = point.channels[0] if point.channels else None
    cae = point.cae_mappings[0] if point.cae_mappings else None
    tags = raw.get("tags")
    if not isinstance(tags, list):
        tags = []

    return {
        "point_db_id": point.id,
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
        "channel_name": channel.channel_name if channel else None,
        "channel_device": channel.device if channel else None,
        "channel_unit": channel.unit if channel else None,
        "sample_rate_hz": channel.sample_rate_hz if channel else None,
        "cae_point_id": cae.cae_point_id if cae else None,
        "cae_component": cae.cae_component if cae else None,
        "cae_result_type": cae.cae_result_type if cae else None,
        "danger_level": cae.danger_level if cae else None,
        "photo_count": len(point.media_files),
        "tags": "、".join(str(tag) for tag in tags if tag),
        "custom_fields": _format_custom_fields(raw.get("custom_fields")),
        "metadata_created_time": raw.get("created_time"),
        "metadata_updated_time": raw.get("updated_time"),
    }


def compute_measurement_fields(record: models.MeasurementRecord) -> None:
    if record.max_strain_ue is None or record.min_strain_ue is None:
        record.mean_strain_ue = None
        record.amplitude_strain_ue = None
        record.range_strain_ue = None
        record.stress_max_mpa = None
        record.stress_min_mpa = None
        record.stress_mean_mpa = None
        record.stress_amplitude_mpa = None
        record.stress_range_mpa = None
        return

    record.mean_strain_ue = (record.max_strain_ue + record.min_strain_ue) / 2
    record.amplitude_strain_ue = (record.max_strain_ue - record.min_strain_ue) / 2
    record.range_strain_ue = record.max_strain_ue - record.min_strain_ue
    record.stress_max_mpa = record.max_strain_ue * STRAIN_TO_STRESS
    record.stress_min_mpa = record.min_strain_ue * STRAIN_TO_STRESS
    record.stress_mean_mpa = record.mean_strain_ue * STRAIN_TO_STRESS
    record.stress_amplitude_mpa = record.amplitude_strain_ue * STRAIN_TO_STRESS
    record.stress_range_mpa = record.range_strain_ue * STRAIN_TO_STRESS


def is_manual_abnormal(record: models.MeasurementRecord) -> bool:
    return bool(record.is_abnormal and record.abnormal_reason and "人工标记异常" in record.abnormal_reason)


def refresh_point_abnormal_flags(db: Session, point_db_id: int) -> None:
    records = list(
        db.execute(
            select(models.MeasurementRecord)
            .join(models.TestRun)
            .where(models.MeasurementRecord.point_db_id == point_db_id)
            .order_by(models.TestRun.cycle_count, models.TestRun.id)
        ).scalars()
    )

    increasing_streak = 1
    previous_amplitude: float | None = None
    for record in records:
        compute_measurement_fields(record)
        if record.max_strain_ue is None or record.min_strain_ue is None or record.amplitude_strain_ue is None:
            previous_amplitude = record.amplitude_strain_ue
            increasing_streak = 1
            continue
        if is_manual_abnormal(record):
            previous_amplitude = record.amplitude_strain_ue
            continue

        reasons: list[str] = []
        if previous_amplitude is not None:
            if previous_amplitude != 0 and record.amplitude_strain_ue > previous_amplitude * 1.2:
                reasons.append("应变幅相对上一轮增长超过 20%")
            if record.amplitude_strain_ue > previous_amplitude:
                increasing_streak += 1
            else:
                increasing_streak = 1
        else:
            increasing_streak = 1

        if increasing_streak >= 3:
            reasons.append("连续 3 次应变幅上升")

        record.is_abnormal = bool(reasons)
        record.abnormal_reason = "；".join(reasons) if reasons else None
        previous_amplitude = record.amplitude_strain_ue


def trend_for_point(db: Session, point_db_id: int) -> list[dict]:
    records = db.execute(
        select(models.MeasurementRecord, models.TestRun)
        .join(models.TestRun, models.MeasurementRecord.run_id == models.TestRun.id)
        .where(models.MeasurementRecord.point_db_id == point_db_id)
        .order_by(models.TestRun.cycle_count, models.TestRun.id)
    ).all()
    return [
        {
            "run_id": run.id,
            "run_name": run.run_name,
            "cycle_count": run.cycle_count,
            "max_strain_ue": record.max_strain_ue,
            "min_strain_ue": record.min_strain_ue,
            "amplitude_strain_ue": record.amplitude_strain_ue,
            "stress_amplitude_mpa": record.stress_amplitude_mpa,
            "is_abnormal": record.is_abnormal,
            "abnormal_reason": record.abnormal_reason,
        }
        for record, run in records
    ]


def abnormal_points(db: Session, project_db_id: int) -> list[dict]:
    rows = db.execute(
        select(models.TestPoint, models.MeasurementRecord, models.TestRun)
        .join(models.MeasurementRecord, models.MeasurementRecord.point_db_id == models.TestPoint.id)
        .join(models.TestRun, models.TestRun.id == models.MeasurementRecord.run_id)
        .where(models.TestPoint.project_db_id == project_db_id, models.MeasurementRecord.is_abnormal.is_(True))
        .order_by(models.TestRun.cycle_count.desc(), models.TestPoint.point_id)
    ).all()
    return [
        {
            "point_db_id": point.id,
            "point_id": point.point_id,
            "point_name": point.point_name,
            "component": point.component,
            "run_id": run.id,
            "run_name": run.run_name,
            "cycle_count": run.cycle_count,
            "amplitude_strain_ue": record.amplitude_strain_ue,
            "stress_amplitude_mpa": record.stress_amplitude_mpa,
            "abnormal_reason": record.abnormal_reason,
        }
        for point, record, run in rows
    ]


def summary_for_project(db: Session, project_db_id: int) -> dict:
    point_count = db.scalar(select(func.count()).select_from(models.TestPoint).where(models.TestPoint.project_db_id == project_db_id)) or 0
    run_count = db.scalar(select(func.count()).select_from(models.TestRun).where(models.TestRun.project_db_id == project_db_id)) or 0
    measurement_count = (
        db.scalar(
            select(func.count())
            .select_from(models.MeasurementRecord)
            .join(models.TestPoint)
            .where(models.TestPoint.project_db_id == project_db_id)
        )
        or 0
    )
    abnormal_count = (
        db.scalar(
            select(func.count())
            .select_from(models.MeasurementRecord)
            .join(models.TestPoint)
            .where(models.TestPoint.project_db_id == project_db_id, models.MeasurementRecord.is_abnormal.is_(True))
        )
        or 0
    )

    latest_rows = db.execute(
        select(models.TestPoint, models.MeasurementRecord, models.TestRun)
        .join(models.MeasurementRecord, models.MeasurementRecord.point_db_id == models.TestPoint.id)
        .join(models.TestRun, models.TestRun.id == models.MeasurementRecord.run_id)
        .where(models.TestPoint.project_db_id == project_db_id)
        .order_by(models.MeasurementRecord.stress_amplitude_mpa.desc().nullslast())
        .limit(10)
    ).all()
    max_amplitude_points = [
        {
            **_point_metadata(point),
            "run_id": run.id,
            "run_name": run.run_name,
            "cycle_count": run.cycle_count,
            "amplitude_strain_ue": record.amplitude_strain_ue,
            "stress_amplitude_mpa": record.stress_amplitude_mpa,
        }
        for point, record, run in latest_rows
    ]

    growth_points: list[dict] = []
    for point in db.execute(select(models.TestPoint).where(models.TestPoint.project_db_id == project_db_id)).scalars():
        trend = trend_for_point(db, point.id)
        if len(trend) >= 2:
            previous = trend[-2]
            latest = trend[-1]
            prev = previous["amplitude_strain_ue"]
            current = latest["amplitude_strain_ue"]
            if prev is not None and current is not None:
                growth_points.append(
                    {
                        **_point_metadata(point),
                        "previous_run_name": previous["run_name"],
                        "latest_run_name": latest["run_name"],
                        "previous_cycle_count": previous["cycle_count"],
                        "latest_cycle_count": latest["cycle_count"],
                        "previous_amplitude_strain_ue": prev,
                        "latest_amplitude_strain_ue": current,
                        "previous_stress_amplitude_mpa": previous["stress_amplitude_mpa"],
                        "latest_stress_amplitude_mpa": latest["stress_amplitude_mpa"],
                        "growth_ratio": None if prev == 0 else (current - prev) / abs(prev),
                    }
                )
    growth_points.sort(key=lambda item: item["growth_ratio"] if item["growth_ratio"] is not None else -999, reverse=True)

    return {
        "project_db_id": project_db_id,
        "point_count": point_count,
        "run_count": run_count,
        "measurement_count": measurement_count,
        "abnormal_count": abnormal_count,
        "max_amplitude_points": max_amplitude_points,
        "fastest_growth_points": growth_points[:10],
    }
