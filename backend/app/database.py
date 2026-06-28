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
    # 尝试运行 Alembic migration；如果失败则回退到 create_all（兼容新建环境）
    try:
        from alembic.config import Config
        from alembic import command

        alembic_cfg = Config(BASE_DIR / "alembic.ini")
        # 将 sqlalchemy.url 指向实际数据库路径（覆盖 ini 中的相对路径）
        alembic_cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
        command.upgrade(alembic_cfg, "head")
    except Exception:
        Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
