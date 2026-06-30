"""认证工具 —— JWT 签发/验证、密码哈希、权限依赖注入。"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app import models
from app.database import AUTH_ENABLED, get_db

# ── 配置 ────────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "pointbench-dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8  # 8 小时

security = HTTPBearer(auto_error=False)


def anonymous_admin_user() -> models.User:
    """认证关闭时使用的匿名管理员上下文。"""
    return models.User(
        id=0,
        username="anonymous",
        password_hash="",
        role="admin",
        display_name="免登录用户",
        is_active=True,
    )


# ── 密码工具 ────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """使用 PBKDF2-SHA256 + 随机盐哈希密码。"""
    salt = secrets.token_hex(16)
    hash_bytes = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return f"pbkdf2:sha256:100000${salt}${hash_bytes.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码。格式: pbkdf2:sha256:iterations$salt$hash_hex"""
    try:
        prefix, salt, stored_hash = hashed_password.split("$", 2)
        alg_parts = prefix.split(":")
        if len(alg_parts) < 3:
            return False
        iterations_str = alg_parts[2]
        if not iterations_str.isdigit():
            return False
        iterations = int(iterations_str)
        hash_bytes = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt.encode("utf-8"), iterations)
        return secrets.compare_digest(hash_bytes.hex(), stored_hash)
    except (ValueError, AttributeError):
        return False


# ── JWT 工具 ────────────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


# ── 当前用户依赖 ────────────────────────────────────────────────────────────

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> models.User | None:
    """从 Bearer Token 解析当前用户。未登录返回 None。"""
    if not AUTH_ENABLED:
        return anonymous_admin_user()
    if credentials is None:
        return None
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        return None
    user_id_raw = payload.get("sub")
    if user_id_raw is None:
        return None
    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        return None
    user = db.get(models.User, user_id)
    if user is None or not user.is_active:
        return None
    return user


def require_user(current_user: models.User | None = Depends(get_current_user)) -> models.User:
    """要求已登录，否则返回 401。"""
    if not AUTH_ENABLED:
        return anonymous_admin_user()
    if current_user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    return current_user


def require_role(role: str):
    """返回一个依赖：要求当前用户具有指定角色。"""

    def dependency(current_user: models.User = Depends(require_user)) -> models.User:
        if not AUTH_ENABLED:
            return anonymous_admin_user()
        if current_user.role == "admin":
            return current_user
        if current_user.role == role:
            return current_user
        # editor 可以执行 viewer 权限的操作
        if role == "viewer" and current_user.role == "editor":
            return current_user
        raise HTTPException(status_code=403, detail="权限不足")
    return dependency
