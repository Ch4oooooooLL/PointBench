"""认证路由 —— 登录、注册、用户管理。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import AUTH_ENABLED, get_db
from app.utils.auth_utils import (
    anonymous_admin_user,
    create_access_token,
    hash_password,
    require_role,
    require_user,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = None


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    display_name: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """用户登录，返回 JWT Token。"""
    if not AUTH_ENABLED:
        user = anonymous_admin_user()
        access_token = create_access_token(data={"sub": user.id, "role": user.role})
        return TokenResponse(
            access_token=access_token,
            user=UserOut.model_validate(user),
        )

    user = db.scalar(select(models.User).where(models.User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已被禁用")

    access_token = create_access_token(data={"sub": user.id, "role": user.role})
    return TokenResponse(
        access_token=access_token,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: models.User = Depends(require_user)) -> UserOut:
    """获取当前登录用户信息。"""
    return UserOut.model_validate(current_user)


@router.post("/register", response_model=UserOut)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_role("admin")),
) -> UserOut:
    """管理员创建新用户。"""
    existing = db.scalar(select(models.User).where(models.User.username == payload.username))
    if existing:
        raise HTTPException(status_code=409, detail="用户名已存在")
    user = models.User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role="editor",
        display_name=payload.display_name or payload.username,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_role("admin")),
) -> list[UserOut]:
    """管理员查看所有用户。"""
    users = db.execute(select(models.User).order_by(models.User.id)).scalars().all()
    return [UserOut.model_validate(user) for user in users]


@router.put("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    role: str = "editor",
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_role("admin")),
) -> dict:
    """管理员修改用户角色。"""
    if role not in ("viewer", "editor", "admin"):
        raise HTTPException(status_code=400, detail="无效角色，可选: viewer, editor, admin")
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.role = role
    db.commit()
    return {"ok": True}
