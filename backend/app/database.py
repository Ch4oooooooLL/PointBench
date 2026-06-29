import logging
import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


logger = logging.getLogger("app.database")

BASE_DIR = Path(__file__).resolve().parents[1]
STORAGE_DIR = BASE_DIR / "storage"

# 支持通过环境变量切换数据库（默认 SQLite）
#   SQLite:   不设置 或 DATABASE_URL=sqlite:///./test_point.db
#   PostgreSQL: DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/pointbench
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{BASE_DIR / 'test_point.db'}",
)

IS_SQLITE = DATABASE_URL.startswith("sqlite")


class Base(DeclarativeBase):
    pass


engine_kwargs: dict = {"future": True}
if IS_SQLITE:
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)
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
        alembic_cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
        command.upgrade(alembic_cfg, "head")
    except Exception:
        logger.exception("Alembic migration failed; falling back to SQLAlchemy create_all")
        Base.metadata.create_all(bind=engine)

    # 初始化默认管理员账号（如不存在）
    try:
        from app.utils.auth_utils import hash_password
        from sqlalchemy import select as sa_select

        db = SessionLocal()
        try:
            admin = db.scalar(sa_select(models.User).where(models.User.username == "admin"))
            if not admin:
                db.add(
                    models.User(
                        username="admin",
                        password_hash=hash_password("admin123"),
                        role="admin",
                        display_name="管理员",
                    )
                )
                db.commit()
        finally:
            db.close()
    except Exception:
        logger.exception("Default admin initialization failed")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
