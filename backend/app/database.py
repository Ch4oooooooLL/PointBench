from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


BASE_DIR = Path(__file__).resolve().parents[1]
STORAGE_DIR = BASE_DIR / "storage"
DATABASE_URL = f"sqlite:///{BASE_DIR / 'test_point.db'}"


class Base(DeclarativeBase):
    pass


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_storage() -> None:
    for path in [
        STORAGE_DIR / "imports",
        STORAGE_DIR / "projects",
        STORAGE_DIR / "dewesoft",
        STORAGE_DIR / "temp",
    ]:
        path.mkdir(parents=True, exist_ok=True)


def init_db() -> None:
    from app import models  # noqa: F401

    init_storage()
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
