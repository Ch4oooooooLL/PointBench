from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import AnalysisSummary, TrendItem
from app.services.analysis_service import abnormal_points, summary_for_project, trend_for_point


router = APIRouter(tags=["analysis"])


@router.get("/api/points/{point_id}/trend", response_model=list[TrendItem])
def point_trend(point_id: int, db: Session = Depends(get_db)) -> list[dict]:
    if not db.get(models.TestPoint, point_id):
        raise HTTPException(status_code=404, detail="点位不存在")
    return trend_for_point(db, point_id)


@router.get("/api/projects/{project_id}/trends")
def project_trends_summary(project_id: int, db: Session = Depends(get_db)) -> dict:
    """批量返回项目下所有点位的趋势摘要，避免 N+1 请求。

    每个点位返回最新轮次的应变/应力幅值和增长率。
    """
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    points = db.execute(
        select(models.TestPoint)
        .where(models.TestPoint.project_db_id == project_id)
        .order_by(models.TestPoint.point_id)
    ).scalars().all()

    point_summaries: list[dict] = []
    for point in points:
        trend = trend_for_point(db, point.id)
        latest = trend[-1] if trend else None
        growth_rate = None
        if len(trend) >= 2 and trend[-2].get("amplitude_strain_ue") is not None and latest.get("amplitude_strain_ue") is not None:
            prev_amp = trend[-2]["amplitude_strain_ue"]
            curr_amp = latest["amplitude_strain_ue"]
            if prev_amp and prev_amp != 0:
                growth_rate = round((curr_amp - prev_amp) / abs(prev_amp), 4)

        point_summaries.append({
            "point_id": point.point_id,
            "point_name": point.point_name,
            "point_type": point.point_type,
            "component": point.component,
            "install_status": point.install_status,
            "latest_cycle_count": latest["cycle_count"] if latest else None,
            "latest_amplitude_strain_ue": latest["amplitude_strain_ue"] if latest else None,
            "latest_stress_amplitude_mpa": latest["stress_amplitude_mpa"] if latest else None,
            "is_abnormal": latest["is_abnormal"] if latest else False,
            "growth_rate": growth_rate,
            "measurement_count": len(trend),
        })

    return {
        "project_id": project.project_id,
        "project_name": project.project_name,
        "point_count": len(points),
        "elastic_modulus_mpa": project.elastic_modulus_mpa,
        "points": point_summaries,
    }


@router.get("/api/projects/{project_id}/analysis/abnormal-points")
def project_abnormal_points(project_id: int, db: Session = Depends(get_db)) -> list[dict]:
    if not db.get(models.Project, project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    return abnormal_points(db, project_id)


@router.get("/api/projects/{project_id}/analysis/summary", response_model=AnalysisSummary)
def project_summary(project_id: int, db: Session = Depends(get_db)) -> dict:
    if not db.get(models.Project, project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    return summary_for_project(db, project_id)
