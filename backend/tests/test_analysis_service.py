from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.database import Base
from app.services.analysis_service import is_manual_abnormal, refresh_point_abnormal_flags


@pytest.fixture
def db_session() -> Iterator[Session]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def add_measurement(db: Session, run: models.TestRun, point: models.TestPoint, amplitude: float) -> models.MeasurementRecord:
    record = models.MeasurementRecord(
        run=run,
        point=point,
        max_strain_ue=amplitude,
        min_strain_ue=-amplitude,
    )
    db.add(record)
    return record


def test_relative_decrease_over_threshold_marks_abnormal(db_session: Session) -> None:
    project = models.Project(
        project_id="ANALYSIS-001",
        project_name="Analysis Test",
        raw_manifest_json="{}",
    )
    point = models.TestPoint(
        project=project,
        point_id="P001",
        point_name="Point 001",
        point_type="strain",
        install_status="installed",
        raw_json="{}",
    )
    run_1 = models.TestRun(project=project, run_name="Run 1", cycle_count=1)
    run_2 = models.TestRun(project=project, run_name="Run 2", cycle_count=2)
    first = add_measurement(db_session, run_1, point, 100)
    second = add_measurement(db_session, run_2, point, 75)
    db_session.add(project)
    db_session.commit()

    refresh_point_abnormal_flags(db_session, point.id)

    assert first.is_abnormal is False
    assert second.is_abnormal is True
    assert second.abnormal_reason == "应变幅相对首次有效数据减小 25%，达到最低预警阈值 20%"


def test_relative_change_uses_first_valid_measurement_as_baseline(db_session: Session) -> None:
    project = models.Project(
        project_id="ANALYSIS-002",
        project_name="Analysis Test 2",
        raw_manifest_json="{}",
    )
    point = models.TestPoint(
        project=project,
        point_id="P002",
        point_name="Point 002",
        point_type="strain",
        install_status="installed",
        raw_json="{}",
    )
    run_1 = models.TestRun(project=project, run_name="Run 1", cycle_count=1)
    run_2 = models.TestRun(project=project, run_name="Run 2", cycle_count=2)
    run_3 = models.TestRun(project=project, run_name="Run 3", cycle_count=3)
    first = add_measurement(db_session, run_1, point, 100)
    second = add_measurement(db_session, run_2, point, 115)
    third = add_measurement(db_session, run_3, point, 121)
    db_session.add(project)
    db_session.commit()

    refresh_point_abnormal_flags(db_session, point.id)

    assert first.is_abnormal is False
    assert second.is_abnormal is False
    assert third.is_abnormal is True
    assert third.abnormal_reason == "应变幅相对首次有效数据增大 21%，达到最低预警阈值 20%"


def test_legacy_auto_growth_reason_is_not_manual() -> None:
    record = models.MeasurementRecord(
        is_abnormal=True,
        abnormal_reason="应变幅相对上一轮增长超过 20%",
    )

    assert is_manual_abnormal(record) is False
