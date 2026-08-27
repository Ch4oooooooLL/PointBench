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

# HyperMesh ``$HWCOLOR COMP`` color index palette.  White (7) is shifted to a
# light grey-blue so components remain visible against the light viewer
# background; the rest match HyperMesh's classic first-12 color table.
_HM_COLOR_PALETTE: dict[int, str] = {
    1: "#d9534f",  # red
    2: "#d9b13a",  # yellow
    3: "#5cb85c",  # green
    4: "#33c4d9",  # cyan
    5: "#4d7fd9",  # blue
    6: "#c94fd9",  # magenta
    7: "#a8b2ba",  # white -> grey
    8: "#7f8c99",  # grey
    9: "#8c3b3b",  # dark red
    10: "#8a7d33",  # olive
    11: "#3d7a3d",  # dark green
    12: "#3a7a7a",  # dark cyan
}


def _group_color(position: int, total: int, hw_color: int | None) -> str:
    """Stable color for a component/group index.

    HyperMesh color index wins when present; otherwise distribute hues with
    the golden angle so adjacent groups stay visually distinct.
    """

    if hw_color is not None and hw_color in _HM_COLOR_PALETTE:
        return _HM_COLOR_PALETTE[hw_color]
    hue = (position * 137.5) % 360
    return f"hsl({hue:.0f}, 55%, 42%)"


def _build_group_data(model: "CanonicalFEModel") -> dict[str, Any]:
    """Turn component/property membership into frontend coloring groups.

    Returns ``coloring_mode`` (component | property | none), the ordered
    ``groups`` list (id/name/color/element_count) and an ``element_group_ids``
    map.  Real component membership comes from HyperMesh metadata; without it
    the model falls back to property (PID) grouping, then to no grouping.
    """

    metadata = model.metadata
    element_component_ids = metadata.get("element_component_ids") or {}
    component_element_ids = metadata.get("component_element_ids") or {}
    if element_component_ids:
        groups: list[dict[str, Any]] = []
        positions = {comp_id: index for index, comp_id in enumerate(sorted(component_element_ids))}
        for comp_id, element_ids in component_element_ids.items():
            component = model.components.get(comp_id)
            name = component.name if component is not None and component.name else f"COMP {comp_id}"
            hw_color = component.fields.get("hw_color") if component is not None else None
            groups.append(
                {
                    "id": comp_id,
                    "name": name,
                    "color": _group_color(positions[comp_id], len(positions), hw_color),
                    "element_count": len(element_ids),
                }
            )
        groups.sort(key=lambda group: (-group["element_count"], group["id"]))
        return {
            "coloring_mode": "component",
            "groups": groups,
            "element_group_ids": {element_id: comp_id for element_id, comp_id in element_component_ids.items()},
        }

    by_property: dict[int, list[int]] = {}
    for element_id, element in model.elements.items():
        if element.property_id is not None:
            by_property.setdefault(element.property_id, []).append(element_id)
    if len(by_property) > 1:
        property_groups: list[dict[str, Any]] = []
        for position, property_id in enumerate(sorted(by_property)):
            property_groups.append(
                {
                    "id": property_id,
                    "name": f"PID {property_id}",
                    "color": _group_color(position, len(by_property), None),
                    "element_count": len(by_property[property_id]),
                }
            )
        property_groups.sort(key=lambda group: (-group["element_count"], group["id"]))
        return {
            "coloring_mode": "property",
            "groups": property_groups,
            "element_group_ids": {
                element_id: property_id for property_id, element_ids in by_property.items() for element_id in element_ids
            },
        }
    return {"coloring_mode": "none", "groups": [], "element_group_ids": {}}


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
                "grouping": _build_group_data(model),
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
