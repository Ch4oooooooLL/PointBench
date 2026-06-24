from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import models
from app.database import get_db
from app.schemas import PointOut, PointUpdate


router = APIRouter(prefix="/api/points", tags=["points"])


@router.get("/{point_id}", response_model=PointOut)
def get_point(point_id: int, db: Session = Depends(get_db)) -> PointOut:
    point = db.execute(
        select(models.TestPoint)
        .options(selectinload(models.TestPoint.channels), selectinload(models.TestPoint.media_files), selectinload(models.TestPoint.cae_mappings))
        .where(models.TestPoint.id == point_id)
    ).scalar_one_or_none()
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在")
    return PointOut.model_validate(point)


@router.put("/{point_id}", response_model=PointOut)
def update_point(point_id: int, payload: PointUpdate, db: Session = Depends(get_db)) -> PointOut:
    point = db.execute(
        select(models.TestPoint)
        .options(selectinload(models.TestPoint.channels), selectinload(models.TestPoint.media_files), selectinload(models.TestPoint.cae_mappings))
        .where(models.TestPoint.id == point_id)
    ).scalar_one_or_none()
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(point, field, value)
    db.commit()
    db.refresh(point)
    return PointOut.model_validate(point)
