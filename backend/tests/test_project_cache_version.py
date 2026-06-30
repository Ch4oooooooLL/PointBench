from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.database import Base
from app.routers.project_router import project_cache_version


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


def test_project_cache_version_changes_when_measurements_change(db_session: Session) -> None:
    project = models.Project(project_id="CACHE-001", project_name="Cache Test", raw_manifest_json="{}")
    point = models.TestPoint(
        project=project,
        point_id="P001",
        point_name="Point 001",
        point_type="strain",
        install_status="installed",
        raw_json="{}",
    )
    run = models.TestRun(project=project, run_name="Run 1", cycle_count=1)
    db_session.add(project)
    db_session.commit()

    before = project_cache_version(db_session, project.id, "detail")

    db_session.add(
        models.MeasurementRecord(
            run=run,
            point=point,
            max_strain_ue=120,
            min_strain_ue=-80,
        )
    )
    db_session.commit()

    assert project_cache_version(db_session, project.id, "detail") != before


def test_overview_cache_version_includes_crack_records(db_session: Session) -> None:
    project = models.Project(project_id="CACHE-002", project_name="Cache Test", raw_manifest_json="{}")
    point = models.TestPoint(
        project=project,
        point_id="P001",
        point_name="Point 001",
        point_type="strain",
        install_status="installed",
        raw_json="{}",
    )
    db_session.add(project)
    db_session.commit()

    detail_before = project_cache_version(db_session, project.id, "detail")
    overview_before = project_cache_version(db_session, project.id, "overview")

    db_session.add(
        models.CrackRecord(
            project=project,
            point=point,
            cycle_count=100,
            stored_path="storage/projects/CACHE-002/cracks/demo.jpg",
            filename="demo.jpg",
        )
    )
    db_session.commit()

    assert project_cache_version(db_session, project.id, "detail") == detail_before
    assert project_cache_version(db_session, project.id, "overview") != overview_before
