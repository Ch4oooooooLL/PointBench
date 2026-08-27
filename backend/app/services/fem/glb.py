"""Deterministic FEM-only GLB and triangle-to-Element-ID conversion.

The FEM canonical model keeps solver coordinates as-is (X/Y/Z with Z as the
vertical axis).  glTF/Three.js instead convention Y as up, so the GLB export
maps each coordinate (x, y, z) -> (x, z, y) to keep the model upright in the
web viewer while leaving the canonical model untouched.
"""

from __future__ import annotations

import json
import math
import struct
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .canonical import CanonicalFEModel


def glb_coordinate(xyz: tuple[float, float, float]) -> tuple[float, float, float]:
    """Map a FEM (x, y, z) coordinate into the Y-up GLB frame: (x, z, y)."""

    x, y, z = xyz
    return (x, z, y)


@dataclass(frozen=True, slots=True)
class MeshArtifact:
    positions: tuple[tuple[float, float, float], ...]
    triangles: tuple[tuple[int, int, int], ...]
    element_ids: tuple[int, ...]

    def __post_init__(self) -> None:
        if len(self.triangles) != len(self.element_ids):
            raise ValueError("each triangle must map to one solver Element ID")


_SOLID_FACES: dict[str, tuple[tuple[int, ...], ...]] = {
    "CTETRA": ((0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)),
    "CPENTA": ((0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)),
    "CPYRA": ((0, 3, 2, 1), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)),
    "CHEXA": (
        (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
        (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    ),
}

# Corner (vertex) node count per card.  High-order cards keep their mid-side
# nodes in the canonical topology but contribute linearized corner faces to
# the surface mesh.
_CORNER_NODE_COUNTS: dict[str, int] = {
    "CTRIA3": 3,
    "CTRIA6": 3,
    "CQUAD4": 4,
    "CQUAD8": 4,
    "CTETRA": 4,
    "CTETRA10": 4,
    "CPENTA": 6,
    "CPENTA15": 6,
    "CPYRA": 5,
    "CPYRA13": 5,
    "CHEXA": 8,
    "CHEXA20": 8,
}

_SHELL_CARDS = frozenset({"CTRIA3", "CTRIA6", "CQUAD4", "CQUAD8"})

# High-order solids reuse the face layout of their linear base card.
_SOLID_BASE_CARDS: dict[str, str] = {
    "CTETRA": "CTETRA",
    "CTETRA10": "CTETRA",
    "CPENTA": "CPENTA",
    "CPENTA15": "CPENTA",
    "CPYRA": "CPYRA",
    "CPYRA13": "CPYRA",
    "CHEXA": "CHEXA",
    "CHEXA20": "CHEXA",
}


def _triangulate(face: tuple[int, ...]) -> tuple[tuple[int, int, int], ...]:
    if len(face) == 3:
        return (face,)
    return tuple((face[0], face[index], face[index + 1]) for index in range(1, len(face) - 1))


def build_triangle_mesh(model: "CanonicalFEModel") -> MeshArtifact:
    """Build a pickable surface mesh while preserving original Element IDs."""

    faces: list[tuple[tuple[int, ...], int]] = []
    solid_candidates: list[tuple[tuple[int, ...], int]] = []
    solid_face_counts: dict[tuple[int, ...], int] = {}

    for element_id in sorted(model.elements):
        element = model.elements[element_id]
        card = element.element_type.upper()
        nodes = tuple(element.node_ids)
        if card in _SHELL_CARDS:
            corners = nodes[:_CORNER_NODE_COUNTS[card]]
            if len(corners) < _CORNER_NODE_COUNTS[card]:
                raise ValueError(f"{card} {element_id} has incomplete connectivity")
            faces.append((corners, element_id))
        elif card in _SOLID_BASE_CARDS:
            corners = nodes[:_CORNER_NODE_COUNTS[card]]
            for offsets in _SOLID_FACES[_SOLID_BASE_CARDS[card]]:
                if max(offsets) >= len(corners):
                    raise ValueError(f"{card} {element_id} has incomplete connectivity")
                face = tuple(corners[offset] for offset in offsets)
                solid_candidates.append((face, element_id))
                key = tuple(sorted(face))
                solid_face_counts[key] = solid_face_counts.get(key, 0) + 1

    faces.extend(
        (face, element_id)
        for face, element_id in solid_candidates
        if solid_face_counts[tuple(sorted(face))] == 1
    )

    used_node_ids = sorted({node_id for face, _ in faces for node_id in face})
    missing = [node_id for node_id in used_node_ids if node_id not in model.nodes]
    if missing:
        raise ValueError(f"mesh references missing Node IDs: {missing[:10]}")
    node_index = {node_id: index for index, node_id in enumerate(used_node_ids)}
    # Positions stay in FEM space inside the artifact (build_triangle_mesh is
    # the topology/ID layer); write_glb applies the Y-up mapping on export.
    positions = tuple(tuple(model.nodes[node_id].coordinates) for node_id in used_node_ids)
    triangles: list[tuple[int, int, int]] = []
    element_ids: list[int] = []
    for face, element_id in faces:
        indexed_face = tuple(node_index[node_id] for node_id in face)
        for triangle in _triangulate(indexed_face):
            triangles.append(triangle)
            element_ids.append(element_id)
    return MeshArtifact(positions, tuple(triangles), tuple(element_ids))


def _pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * ((-len(data)) % 4)


def write_glb(
    model: "CanonicalFEModel",
    glb_path: str | Path,
    mapping_path: str | Path,
    *,
    on_progress: Callable[..., None] | None = None,
) -> MeshArtifact:
    """Write GLB plus JSON mapping, returning the generated in-memory artifact."""

    artifact = build_triangle_mesh(model)
    if not artifact.triangles:
        raise ValueError("canonical model contains no supported surface triangles")
    glb_positions = tuple(glb_coordinate(xyz) for xyz in artifact.positions)
    positions_raw = b"".join(struct.pack("<3f", *xyz) for xyz in glb_positions)
    indices = tuple(value for triangle in artifact.triangles for value in triangle)
    indices_raw = b"".join(struct.pack("<I", index) for index in indices)
    positions_raw = _pad(positions_raw, b"\x00")
    binary = positions_raw + indices_raw

    minima = [min(xyz[axis] for xyz in glb_positions) for axis in range(3)]
    maxima = [max(xyz[axis] for xyz in glb_positions) for axis in range(3)]
    if not all(math.isfinite(value) for value in minima + maxima):
        raise ValueError("non-finite node coordinates cannot be written to GLB")
    gltf = {
        "asset": {"version": "2.0", "generator": "pointbench-fem-preview"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(positions_raw), "target": 34962},
            {"buffer": 0, "byteOffset": len(positions_raw), "byteLength": len(indices_raw), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(artifact.positions), "type": "VEC3", "min": minima, "max": maxima},
            {"bufferView": 1, "componentType": 5125, "count": len(indices), "type": "SCALAR"},
        ],
    }
    json_chunk = _pad(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bin_chunk = _pad(binary, b"\x00")
    total_length = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    glb = (
        struct.pack("<4sII", b"glTF", 2, total_length)
        + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
        + struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk
    )
    glb_target = Path(glb_path)
    mapping_target = Path(mapping_path)
    glb_target.parent.mkdir(parents=True, exist_ok=True)
    mapping_target.parent.mkdir(parents=True, exist_ok=True)
    if on_progress is not None:
        on_progress(done=1, total=1, message="正在写出几何索引")
    glb_target.write_bytes(glb)
    mapping_target.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "triangle_element_ids": list(artifact.element_ids),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return artifact
