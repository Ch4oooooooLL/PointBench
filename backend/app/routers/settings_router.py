from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.services.analysis_service import compute_measurement_fields
from app.services.settings_service import get_stress_formula, save_stress_formula, safe_eval

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsOut(BaseModel):
    stress_formula: str


class SettingsUpdate(BaseModel):
    stress_formula: str = Field(..., max_length=255)


@router.get("", response_model=SettingsOut)
def get_settings() -> SettingsOut:
    return SettingsOut(stress_formula=get_stress_formula())


@router.put("", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)) -> SettingsOut:
    formula = payload.stress_formula.strip()

    # 1. 尝试使用虚拟数据进行公式验证
    try:
        # 用 max=100, min=50 测试公式是否能正常解析和计算
        test_val = safe_eval(formula, {"max": 100.0, "min": 50.0})
        # 还要考虑如果 max=min 的情况
        _ = safe_eval(formula, {"max": 50.0, "min": 50.0})
    except ZeroDivisionError:
        raise HTTPException(
            status_code=400,
            detail="公式非法：公式中包含除以零的潜在风险（比如当 max == min 时）"
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=f"公式校验失败：{str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"公式解析错误：不支持的公式格式 ({str(e)})"
        )

    # 2. 校验通过，写入配置
    save_stress_formula(formula)

    # 3. 重新计算数据库中所有的测量记录
    try:
        records = db.query(models.MeasurementRecord).all()
        for record in records:
            compute_measurement_fields(record)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"公式保存成功，但历史数据重新计算失败: {str(e)}"
        )

    return SettingsOut(stress_formula=formula)
