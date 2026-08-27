"""FEM preview service: persist uploaded decks and produce GLB artifacts."""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from app.database import STORAGE_DIR

from .glb import write_glb
from .parser import FemModelProvider, ModelParseError, ModelProviderError

PREVIEW_ROOT = STORAGE_DIR / "temp" / "fem_preview"
PREVIEW_MAX_AGE_SECONDS = 24 * 60 * 60


class FemPreviewError(ValueError):
    """User-facing FEM preview failure with a Chinese message."""


@dataclass(frozen=True, slots=True)
class FemPreviewStats:
    node_count: int
    element_count: int
    triangle_count: int
    element_types: dict[str, int]
    ignored_cards: dict[str, int]
    included_files: list[str]
    source_name: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "node_count": self.node_count,
            "element_count": self.element_count,
            "triangle_count": self.triangle_count,
            "element_types": dict(
                sorted(self.element_types.items(), key=lambda item: (-item[1], item[0]))
            ),
            "ignored_cards": dict(sorted(self.ignored_cards.items())),
            "included_files": self.included_files,
            "source_name": self.source_name,
        }


def _safe_relative_path(name: str) -> PurePosixPath:
    """Normalize an upload filename into a portable relative path.

    Browser uploads may carry ``C:\\fakepath\\...`` prefixes (single-file
    inputs) or ``folder/sub/model.fem`` (webkitdirectory inputs).  Reject
    anything that could escape the preview root.
    """

    normalized = name.replace("\\", "/")
    parts = [part for part in normalized.split("/") if part not in {"", ".", ".."}]
    if not parts:
        raise FemPreviewError("上传文件名无效")
    if ".." in normalized.split("/") or ":" in parts[0]:
        raise FemPreviewError(f"上传文件名包含非法路径：{name}")
    return PurePosixPath(*parts)


def _ensure_preview_root() -> Path:
    PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    return PREVIEW_ROOT


def _cleanup_stale_previews() -> None:
    """Remove preview directories untouched for more than 24 hours."""

    root = PREVIEW_ROOT
    if not root.is_dir():
        return
    now = time.time()
    for child in root.iterdir():
        if not child.is_dir():
            continue
        try:
            if now - child.stat().st_mtime > PREVIEW_MAX_AGE_SECONDS:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def _pick_main_source(files: list[tuple[PurePosixPath, Path]]) -> tuple[PurePosixPath, Path]:
    """Choose the primary deck among uploaded .fem/.dat files.

    The main source is the shallowest supported deck (decks referenced via
    INCLUDE usually sit next to the main file); ties resolve by name.
    """

    candidates = [
        (relative, absolute)
        for relative, absolute in files
        if relative.suffix.lower() in {".fem", ".dat"}
    ]
    if not candidates:
        raise FemPreviewError("未找到 .fem / .dat 主文件，请选择 Nastran/OptiStruct 格式的模型文件")
    return min(candidates, key=lambda item: (len(item[0].parts), item[0].as_posix().lower()))


class FemPreviewService:
    """Persist uploaded deck files and produce a three.js-ready GLB + mapping."""

    def create_preview(
        self,
        uploads: list[tuple[str, bytes]],
    ) -> dict[str, Any]:
        """Build a preview from raw upload entries ``(filename, content)``.

        Returns an API payload with ``preview_id``, ``stats`` and artifact
        URLs; raises :class:`FemPreviewError` on any user-fixable failure.
        """

        if not uploads:
            raise FemPreviewError("没有收到任何上传文件")
        _ensure_preview_root()
        _cleanup_stale_previews()

        import uuid

        preview_id = uuid.uuid4().hex
        preview_dir = PREVIEW_ROOT / preview_id
        preview_dir.mkdir(parents=True, exist_ok=False)

        try:
            files: list[tuple[PurePosixPath, Path]] = []
            seen: set[str] = set()
            for name, content in uploads:
                relative = _safe_relative_path(name)
                key = relative.as_posix()
                if key in seen:
                    continue
                seen.add(key)
                target = preview_dir / Path(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                files.append((relative, target))

            main_relative, main_path = _pick_main_source(files)
            include_root = preview_dir
            try:
                model = FemModelProvider(
                    main_path,
                    include_root=include_root,
                    on_progress=None,
                ).load()
            except ModelParseError as exc:
                raise FemPreviewError(f"FEM 解析失败：{exc}") from exc
            except ModelProviderError as exc:
                raise FemPreviewError(f"FEM 读取失败：{exc}") from exc
            except FileNotFoundError as exc:
                raise FemPreviewError(f"FEM 文件缺失：{exc}") from exc

            try:
                artifact = write_glb(
                    model,
                    preview_dir / "model.glb",
                    preview_dir / "mapping.json",
                )
            except ValueError as exc:
                raise FemPreviewError(f"网格生成失败：{exc}") from exc

            ignored = model.metadata.get("ignored_cards", {})
            # model.counts mixes node/element totals into the type map; keep
            # only real element card types for the preview stats.
            element_types = {
                card: count
                for card, count in model.counts.items()
                if card not in {"nodes", "elements"}
            }
            stats = FemPreviewStats(
                node_count=len(model.nodes),
                element_count=len(model.elements),
                triangle_count=len(artifact.triangles),
                element_types=element_types,
                ignored_cards=ignored,
                included_files=list(model.metadata.get("included_files", [])),
                source_name=main_relative.as_posix(),
            )
            return {
                "preview_id": preview_id,
                "stats": stats.as_dict(),
                "glb_url": f"/api/fem-preview/{preview_id}/model.glb",
                "mapping_url": f"/api/fem-preview/{preview_id}/mapping.json",
            }
        except Exception:
            shutil.rmtree(preview_dir, ignore_errors=True)
            raise

    def resolve_preview_dir(self, preview_id: str) -> Path:
        """Return the preview directory for *preview_id* or raise KeyError."""

        candidate = PREVIEW_ROOT / preview_id
        resolved = candidate.resolve(strict=False)
        root = PREVIEW_ROOT.resolve(strict=False)
        if resolved.parent != root or not resolved.is_dir():
            raise KeyError(preview_id)
        return resolved


fem_preview_service = FemPreviewService()
