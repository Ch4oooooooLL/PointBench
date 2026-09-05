"""项目级 FEM 模型：导入 .fem 文件、解析、生成渲染产物并持久化。

每个项目对应一个 FEM 模型（``fem_models`` 表 + ``storage/projects/<id>/fem/``
目录）。渲染产物（model.glb / mapping.json / preview.json）写入项目目录，
冷启动或再次打开「模型预览」页时直接读取产物展示，无需重新解析。

目录布局::

    storage/projects/<project_id>/fem/
        source/...      上传的 .fem/.dat/.inc 原始文件（保留相对路径）
        model.glb       三角化渲染产物（Y-up）
        mapping.json    三角形 -> Element ID 映射
        preview.json    stats + grouping 等预览元数据

进度上报（约 5 段）供全局右下角悬浮窗轮询：
    读文件(0-20%) -> 解析卡片(20-70%) -> 生成几何(70-90%) -> 写产物(90-100%)
"""

from __future__ import annotations

import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from app.database import SessionLocal
from app.models import FemModel
from app.services import task_progress
from app.services.fem.glb import MeshArtifact, write_glb
from app.services.fem.parser import FemModelProvider, ModelParseError, ModelProviderError
from app.services.fem.preview import _build_group_data, _pick_main_source
from app.utils.path_utils import safe_fem_dir


class FemModelError(ValueError):
    """用户可修正的 FEM 模型导入/解析失败（中文提示）。"""


@dataclass(frozen=True, slots=True)
class FemArtifactBundle:
    """持久化后可直接返回前端的模型产物信息。"""

    source_name: str
    node_count: int
    element_count: int
    triangle_count: int
    element_types: dict[str, int]
    ignored_cards: dict[str, int]
    included_files: list[str]
    grouping: dict[str, Any]
    glb_url: str
    mapping_url: str
    updated_at: str | None = None


class _PhaseProgress:
    """把多阶段 on_progress 事件换算为全局 0-100 进度。

    parser/glb 的回调签名是 ``on_progress(phase=..., done=..., total=..., message=...)``；
    按 phase 把 (done/total) 映射到对应进度区间（read 0-20、parse 20-70、
    mesh 70-90、write 90-100）。
    """

    _RANGES: dict[str, tuple[int, int]] = {
        "read": (0, 20),
        "parse": (20, 70),
        "mesh": (70, 90),
        "write": (90, 100),
    }

    def __init__(self, report: Callable[[float, str], None]) -> None:
        self._report = report
        self._last = -1

    def __call__(self, **kwargs: Any) -> None:
        phase = str(kwargs.get("phase") or "parse")
        done = kwargs.get("done")
        total = kwargs.get("total")
        message = str(kwargs.get("message") or "")
        low, high = self._RANGES.get(phase, (0, 100))
        fraction = 1.0
        if done is not None and total:
            fraction = min(max(done / total, 0.0), 1.0)
        elif done is not None and not total:
            fraction = min(max(done, 0.0), 1.0)
        progress = round(low + (high - low) * fraction)
        if progress != self._last or message:
            self._last = progress
            self._report(progress, message)

    def on_write(self, **kwargs: Any) -> None:
        """glb 写出回调包装：按事件语义归属 mesh(70-90) 或 write(90-100)。

        build_triangle_mesh 逐批上报 (done=扫描数, total=单元数)；write_glb 收尾
        时再发一个 (done=1, total=1) 事件表示开始写产物。
        """
        if kwargs.get("done") == 1 and kwargs.get("total") == 1:
            kwargs["phase"] = "write"
        else:
            kwargs["phase"] = "mesh"
        self(**kwargs)

    def finalize(self) -> None:
        self._report(100, "完成")


def _write_roundtrip_json(
    target: Path,
    stats: dict[str, Any],
    grouping: dict[str, Any],
    artifact_version: str,
) -> None:
    payload = {
        "schema_version": 2,
        "artifact_version": artifact_version,
        "stats": stats,
        "grouping": grouping,
    }
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _safe_relative_path(name: str) -> PurePosixPath:
    """Normalize an upload filename into a portable relative path (preview 同款)."""

    normalized = name.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part not in {"", ".", ".."}]
    if not parts:
        raise FemModelError("上传文件名无效")
    if ".." in normalized.split("/") or ":" in parts[0]:
        raise FemModelError(f"上传文件名包含非法路径：{name}")
    return PurePosixPath(*parts)


def build_fem_model_artifact(
    fem_dir: Path,
    uploads: list[tuple[str, bytes]],
    *,
    on_progress: Callable[[float, str], None] | None = None,
    artifact_version: str | None = None,
) -> FemArtifactBundle:
    """写入上传文件、解析并生成 GLB/mapping/preview 产物。

    返回持久化后的模型产物信息；发生任何错误时抛出 :class:`FemModelError`。
    注意：调用方负责失败时清理 fem_dir。
    artifact_version：产物版本号；不传时用当前秒级时间戳（preview 与
    preview.json 均一致）。替换式导入应传入单调递增版本，保证前端能识别
    模型已被替换而刷新视图。
    """

    if not uploads:
        raise FemModelError("没有收到任何上传文件")

    source_dir = fem_dir / "source"
    if source_dir.exists():
        shutil.rmtree(source_dir, ignore_errors=True)
    source_dir.mkdir(parents=True, exist_ok=True)

    files: list[tuple[PurePosixPath, Path]] = []
    seen: set[str] = set()
    for name, content in uploads:
        relative = _safe_relative_path(name)
        key = relative.as_posix()
        if key in seen:
            continue
        seen.add(key)
        target = source_dir / Path(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        files.append((relative, target))

    main_relative, main_path = _pick_main_source(files)
    include_root = fem_dir / "source"

    phases = _PhaseProgress(on_progress) if on_progress else None

    try:
        provider = FemModelProvider(
            main_path,
            include_root=include_root,
            on_progress=phases if phases else None,
        )
        model = provider.load()
        try:
            artifact: MeshArtifact = write_glb(
                model,
                fem_dir / "model.glb",
                fem_dir / "mapping.json",
                on_progress=phases.on_write if phases else None,
            )
        except ValueError as exc:
            raise FemModelError(f"网格生成失败：{exc}") from exc
    except ModelParseError as exc:
        raise FemModelError(f"FEM 解析失败：{exc}") from exc
    except ModelProviderError as exc:
        raise FemModelError(f"FEM 读取失败：{exc}") from exc
    except FileNotFoundError as exc:
        raise FemModelError(f"FEM 文件缺失：{exc}") from exc

    # 统计与分组（复用 preview 的逻辑，保持一致）。
    ignored = model.metadata.get("ignored_cards", {})
    element_types = {
        card: count
        for card, count in model.counts.items()
        if card not in {"nodes", "elements"}
    }
    stats = {
        "node_count": len(model.nodes),
        "element_count": len(model.elements),
        "triangle_count": len(artifact.triangles),
        "element_types": dict(
            sorted(element_types.items(), key=lambda item: (-item[1], item[0]))
        ),
        "ignored_cards": dict(sorted(ignored.items())),
        "included_files": list(model.metadata.get("included_files", [])),
        "source_name": main_relative.as_posix(),
    }
    grouping = _build_group_data(model)

    artifact_version = artifact_version or time.strftime("%Y%m%d%H%M%S")
    _write_roundtrip_json(
        fem_dir / "preview.json",
        stats,
        grouping,
        artifact_version,
    )
    if phases:
        phases.finalize()
    return FemArtifactBundle(
        source_name=main_relative.as_posix(),
        node_count=stats["node_count"],
        element_count=stats["element_count"],
        triangle_count=stats["triangle_count"],
        element_types=element_types,
        ignored_cards=ignored,
        included_files=stats["included_files"],
        grouping=grouping,
        glb_url="",
        mapping_url="",
    )


def _artifact_version(previous: str | None = None) -> str:
    """生成单调递增的产物版本号。

    同一项目重复导入会整体替换并重新渲染，产物版本必须每次变化，
    前端才能据此刷新三维视图。时间戳同一秒内重复导入时向后递增，
    避免版本号回退或保持不变。
    """
    stamp = time.strftime("%Y%m%d%H%M%S")
    if previous is None or stamp > previous:
        return stamp
    # 同一秒内再次导入：把上一版本当作十进制整数 +1，保证严格递增
    return str(int(previous) + 1)


def create_or_replace_fem_model(
    project: Any,
    uploads: list[tuple[str, bytes]],
    *,
    on_progress: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """为项目导入/覆盖 FEM 模型并生成持久化渲染产物。

    返回 API 可直接返回的 dict（stats + grouping + 产物 URL）。失败抛
    :class:`FemModelError`（目录与数据库记录一并回滚）。
    """
    db = SessionLocal()
    fem_dir = safe_fem_dir(project.project_id)
    # 先写产物到临时子目录，成功后原子替换，避免中途失败留下半成品。
    staging = fem_dir.with_name(f"{fem_dir.name}.staging-{int(time.time() * 1000)}")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)
    # 替换式导入：先取旧记录版本号，产物与数据库记录写入同一个单调递增版本，
    # 前端才能识别「模型已被替换」并刷新三维视图。
    model_record = db.query(FemModel).filter(FemModel.project_db_id == project.id).first()
    artifact_version = _artifact_version(model_record.artifact_version if model_record else None)
    try:
        bundle = build_fem_model_artifact(
            staging,
            uploads,
            on_progress=on_progress,
            artifact_version=artifact_version,
        )
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    # 原子切换：删除旧 fem 目录，再移动 staging。
    shutil.rmtree(fem_dir, ignore_errors=True)
    shutil.move(str(staging), str(fem_dir))

    model_record = db.query(FemModel).filter(FemModel.project_db_id == project.id).first()
    try:
        if model_record is None:
            model_record = FemModel(
                project_db_id=project.id,
                main_filename=bundle.source_name,
                source_name=bundle.source_name,
                node_count=bundle.node_count,
                element_count=bundle.element_count,
                triangle_count=bundle.triangle_count,
                status="ready",
                error_message=None,
                artifact_version=artifact_version,
            )
            db.add(model_record)
        else:
            model_record.main_filename = bundle.source_name
            model_record.source_name = bundle.source_name
            model_record.node_count = bundle.node_count
            model_record.element_count = bundle.element_count
            model_record.triangle_count = bundle.triangle_count
            model_record.status = "ready"
            model_record.error_message = None
            model_record.artifact_version = artifact_version
        db.commit()
    except Exception:
        db.rollback()
        # 数据库写入失败时回滚已替换的产物目录，保持一致性。
        shutil.rmtree(fem_dir, ignore_errors=True)
        raise
    finally:
        db.close()

    base = f"/api/projects/{project.id}/fem"
    return {
        "source_name": bundle.source_name,
        "stats": {
            "node_count": bundle.node_count,
            "element_count": bundle.element_count,
            "triangle_count": bundle.triangle_count,
            "element_types": bundle.element_types,
            "ignored_cards": bundle.ignored_cards,
            "included_files": bundle.included_files,
        },
        "grouping": bundle.grouping,
        "glb_url": f"{base}/model.glb",
        "mapping_url": f"{base}/mapping.json",
        "artifact_version": artifact_version,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def load_fem_model_payload(project: Any) -> dict[str, Any]:
    """读取项目 FEM 模型信息（读 preview.json 产物；无则返回 status 空态）。"""

    fem_dir = safe_fem_dir(project.project_id)
    preview_path = fem_dir / "preview.json"
    glb_path = fem_dir / "model.glb"
    mapping_path = fem_dir / "mapping.json"
    db = SessionLocal()
    try:
        record = db.query(FemModel).filter(FemModel.project_db_id == project.id).first()
    finally:
        db.close()

    if record is None or not preview_path.is_file() or not glb_path.is_file():
        return {"status": "none", "stats": None, "grouping": None, "glb_url": None, "mapping_url": None}

    base = f"/api/projects/{project.id}/fem"
    try:
        payload = json.loads(preview_path.read_text(encoding="utf-8"))
        stats = payload.get("stats") or {}
        grouping = payload.get("grouping") or {"coloring_mode": "none", "groups": [], "element_group_ids": {}}
        artifact_version = payload.get("artifact_version") or record.artifact_version
    except (OSError, ValueError):
        # 产物损坏时回退为仅记录信息。
        stats = {
            "node_count": record.node_count,
            "element_count": record.element_count,
            "triangle_count": record.triangle_count,
            "element_types": {},
            "ignored_cards": {},
            "included_files": [],
            "source_name": record.source_name,
        }
        grouping = {"coloring_mode": "none", "groups": [], "element_group_ids": {}}
        artifact_version = record.artifact_version

    return {
        "status": "ready",
        "stats": stats,
        "grouping": grouping,
        "glb_url": f"{base}/model.glb",
        "mapping_url": f"{base}/mapping.json",
        "artifact_version": artifact_version,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        "has_artifact": mapping_path.is_file(),
    }


def delete_fem_model(project: Any) -> None:
    """删除项目 FEM 模型（数据库记录 + 项目 fem 目录）。"""

    db = SessionLocal()
    try:
        record = db.query(FemModel).filter(FemModel.project_db_id == project.id).first()
        if record is not None:
            db.delete(record)
            db.commit()
    finally:
        db.close()
    fem_dir = safe_fem_dir(project.project_id)
    shutil.rmtree(fem_dir, ignore_errors=True)


def resolve_fem_artifact_dir(project: Any) -> Path | None:
    """返回项目 FEM 产物目录（含 model.glb 时），否则 None。"""
    fem_dir = safe_fem_dir(project.project_id)
    if (fem_dir / "model.glb").is_file():
        return fem_dir
    return None
