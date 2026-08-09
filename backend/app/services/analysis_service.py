import json
import math
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models
from app.services.settings_service import get_stress_formula, safe_eval


DEFAULT_ELASTIC_MODULUS_MPA = 206000.0
AUTO_ABNORMAL_REASONS = (
    "应变幅相对首次有效数据",
    "应变幅相对上一轮变化超过",
    "应变幅相对上一轮增长超过 20%",
    "连续 3 次应变幅上升",
)

# 默认异常识别规则
DEFAULT_ANOMALY_RULES: dict[str, float | int] = {
    "strain_amplitude_warning": 300,      # με — 应变幅绝对值警告
    "strain_amplitude_danger": 500,       # με — 应变幅绝对值危险
    "relative_growth_warning": 0.2,       # 相对变化率警告阈值（沿用历史字段名）
    "continuous_growth_count": 3,         # 连续增长次数触发
    "minimum_effective_growth": 50,       # με — 最小有效增长量
}


def _get_anomaly_rules(project: models.Project | None) -> dict:
    """获取项目的异常识别规则配置。"""
    if project and project.anomaly_rules_json:
        try:
            custom = json.loads(project.anomaly_rules_json)
            if isinstance(custom, dict):
                merged = dict(DEFAULT_ANOMALY_RULES)
                merged.update({k: v for k, v in custom.items() if k in merged})
                return merged
        except (json.JSONDecodeError, TypeError):
            pass
    return dict(DEFAULT_ANOMALY_RULES)


def _resolve_elastic_modulus(record: models.MeasurementRecord, elastic_modulus_mpa: float | None) -> float:
    """解析本次计算使用的弹性模量（MPa）。

    优先级：显式传入的参数 > 记录关联项目配置 > 默认值。
    批量调用场景（如 XLSX confirm、Dewesoft 导入）应在调用处缓存并显式传入项目弹性模量，
    避免 N+1 查询；单条调用可依赖此处的懒加载回退。
    """
    if elastic_modulus_mpa is not None:
        return elastic_modulus_mpa
    try:
        run = getattr(record, "run", None)
        project = getattr(run, "project", None)
        if project is None:
            point = getattr(record, "point", None)
            project = getattr(point, "project", None)
        if project is not None and project.elastic_modulus_mpa is not None:
            return project.elastic_modulus_mpa
    except Exception:
        pass
    return DEFAULT_ELASTIC_MODULUS_MPA


def _get_stress_conversion(record: models.MeasurementRecord, elastic_modulus_mpa: float | None = None) -> float:
    """根据项目配置的弹性模量计算应变→应力换算系数（με → MPa）。"""
    return _resolve_elastic_modulus(record, elastic_modulus_mpa) * 1e-6


def _format_percent(value: float) -> str:
    if math.isinf(value):
        return "无限大"
    percent = value * 100
    return str(int(percent)) if percent.is_integer() else f"{percent:.1f}".rstrip("0").rstrip(".")


def _relative_change_threshold(rules: dict) -> float:
    try:
        threshold = float(rules["relative_growth_warning"])
    except (KeyError, TypeError, ValueError):
        threshold = float(DEFAULT_ANOMALY_RULES["relative_growth_warning"])
    if threshold > 1:
        threshold = threshold / 100
    return max(threshold, 0)


def _relative_change_ratio(current: float, initial: float) -> float:
    if initial == 0:
        if current == 0:
            return 0
        return math.inf if current > 0 else -math.inf
    return (current - initial) / abs(initial)


def _baseline_change_reason(change_ratio: float, threshold: float) -> str:
    direction = "增大" if change_ratio >= 0 else "减小"
    change_text = _format_percent(abs(change_ratio))
    if not math.isinf(change_ratio):
        change_text = f"{change_text}%"
    return (
        f"应变幅相对首次有效数据{direction} {change_text}，"
        f"达到最低预警阈值 {_format_percent(threshold)}%"
    )


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


def compute_measurement_fields(record: models.MeasurementRecord, elastic_modulus_mpa: float | None = None) -> None:
    """计算测量记录的派生字段（应变幅、应力等）。

    Args:
        record: 测量记录
        elastic_modulus_mpa: 弹性模量 (MPa)，默认 206000（普通钢材）
    """
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

    # 1. 基础应变字段计算
    record.mean_strain_ue = (record.max_strain_ue + record.min_strain_ue) / 2
    record.amplitude_strain_ue = (record.max_strain_ue - record.min_strain_ue) / 2
    record.range_strain_ue = record.max_strain_ue - record.min_strain_ue

    # 2. 尝试从全局设置获取公式计算应力幅值
    formula = get_stress_formula()
    variables = {
        "max": record.max_strain_ue,
        "min": record.min_strain_ue,
    }

    try:
        stress_amp = safe_eval(formula, variables)
    except Exception:
        # 如果解析失败，则回退到原本的弹性模量计算方法
        strain_to_stress = _get_stress_conversion(record, elastic_modulus_mpa)
        stress_amp = record.amplitude_strain_ue * strain_to_stress

    record.stress_amplitude_mpa = stress_amp
    record.stress_range_mpa = stress_amp * 2

    # 为了和其他应力字段保持等效换算关系，计算出等效 strain_to_stress
    # 当 amplitude_strain_ue != 0 时，等效 strain_to_stress = stress_amplitude_mpa / amplitude_strain_ue
    if record.amplitude_strain_ue and record.amplitude_strain_ue != 0:
        equiv_strain_to_stress = record.stress_amplitude_mpa / record.amplitude_strain_ue
    else:
        equiv_strain_to_stress = _get_stress_conversion(record, elastic_modulus_mpa)

    record.stress_max_mpa = record.max_strain_ue * equiv_strain_to_stress
    record.stress_min_mpa = record.min_strain_ue * equiv_strain_to_stress
    record.stress_mean_mpa = record.mean_strain_ue * equiv_strain_to_stress


def is_manual_abnormal(record: models.MeasurementRecord) -> bool:
    if not record.is_abnormal or not record.abnormal_reason:
        return False
    return not any(reason in record.abnormal_reason for reason in AUTO_ABNORMAL_REASONS)


def refresh_point_abnormal_flags(db: Session, point_db_id: int) -> None:
    point = db.get(models.TestPoint, point_db_id)
    project = db.get(models.Project, point.project_db_id) if point else None
    rules = _get_anomaly_rules(project)
    relative_change_threshold = _relative_change_threshold(rules)

    records = list(
        db.execute(
            select(models.MeasurementRecord)
            .join(models.TestRun)
            .where(models.MeasurementRecord.point_db_id == point_db_id)
            .order_by(models.TestRun.cycle_count, models.TestRun.id)
        ).scalars()
    )

    initial_amplitude: float | None = None
    for record in records:
        compute_measurement_fields(record)
        if record.max_strain_ue is None or record.min_strain_ue is None or record.amplitude_strain_ue is None:
            continue

        if initial_amplitude is None:
            initial_amplitude = record.amplitude_strain_ue
            if not is_manual_abnormal(record):
                record.is_abnormal = False
                record.abnormal_reason = None
            continue

        if is_manual_abnormal(record):
            continue

        reasons: list[str] = []
        change_ratio = _relative_change_ratio(record.amplitude_strain_ue, initial_amplitude)
        if abs(change_ratio) >= relative_change_threshold:
            reasons.append(_baseline_change_reason(change_ratio, relative_change_threshold))

        record.is_abnormal = bool(reasons)
        record.abnormal_reason = "；".join(reasons) if reasons else None


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
            select(func.count(func.distinct(models.MeasurementRecord.point_db_id)))
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
