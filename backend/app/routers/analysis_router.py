from fastapi import APIRouter, Depends, HTTPException
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
