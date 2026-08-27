"""FEM preview service tests (parser + GLB generation + API payload)."""

import struct

import pytest

from app.services.fem import FemPreviewError, fem_preview_service
from app.services.fem.glb import build_triangle_mesh
from app.services.fem.parser import FemModelProvider


def _card(name: str, *fields: object) -> str:
    """Build an 8-character fixed-field Nastran card row."""

    return name.ljust(8) + "".join(str(field).rjust(8) for field in fields)


def _continuation(*fields: object) -> str:
    """Build a fixed-field continuation row (first field is the marker)."""

    return "+       " + "".join(str(field).rjust(8) for field in fields)


# A small fixed-field deck: two CQUAD4 shells + one CTRIA3 + one CHEXA solid.
SMALL_FEM = "\n".join(
    [
        "$$",
        "$$ Minimal test deck",
        "$$",
        "BEGIN BULK",
        '$HMNAME COMP                   1"plate"',
        "$HMCOMP ID 1",
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 10.0, 0.0, 0.0),
        _card("GRID", 3, "", 10.0, 10.0, 0.0),
        _card("GRID", 4, "", 0.0, 10.0, 0.0),
        _card("GRID", 5, "", 0.0, 0.0, 10.0),
        _card("GRID", 6, "", 10.0, 0.0, 10.0),
        _card("GRID", 7, "", 10.0, 10.0, 10.0),
        _card("GRID", 8, "", 0.0, 10.0, 10.0),
        _card("CQUAD4", 1, 1, 1, 2, 3, 4),
        _card("CTRIA3", 2, 1, 5, 6, 7),
        _card("CHEXA", 3, 1, 1, 2, 3, 4, 5, 6),
        _continuation(7, 8),
        "ENDDATA",
    ]
)

# Same deck with an INCLUDE card pulling in the shell elements.
MAIN_WITH_INCLUDE = "\n".join(
    [
        "BEGIN BULK",
        "INCLUDE 'shells.inc'",
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 10.0, 0.0, 0.0),
        _card("GRID", 3, "", 10.0, 10.0, 0.0),
        _card("GRID", 4, "", 0.0, 10.0, 0.0),
        _card("GRID", 5, "", 0.0, 0.0, 10.0),
        _card("GRID", 6, "", 10.0, 0.0, 10.0),
        _card("GRID", 7, "", 10.0, 10.0, 10.0),
        _card("GRID", 8, "", 0.0, 10.0, 10.0),
        _card("CHEXA", 3, 1, 1, 2, 3, 4, 5, 6),
        _continuation(7, 8),
        "ENDDATA",
    ]
)

INCLUDE_FILE = "\n".join(
    [
        _card("CQUAD4", 1, 1, 1, 2, 3, 4),
        _card("CTRIA3", 2, 1, 5, 6, 7),
    ]
)


def _parse(deck: str):
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "model.fem"
        path.write_text(deck, encoding="utf-8")
        return FemModelProvider(path).load()


def test_parse_small_deck_counts() -> None:
    model = _parse(SMALL_FEM)
    assert model.counts["nodes"] == 8
    assert model.counts["elements"] == 3
    assert model.counts["CQUAD4"] == 1
    assert model.counts["CTRIA3"] == 1
    assert model.counts["CHEXA"] == 1
    assert model.node(1).coordinates == (0.0, 0.0, 0.0)
    assert model.element(3).node_ids == (1, 2, 3, 4, 5, 6, 7, 8)


def test_build_triangle_mesh_counts() -> None:
    model = _parse(SMALL_FEM)
    artifact = build_triangle_mesh(model)
    # CQUAD4 -> 2 triangles, CTRIA3 -> 1, CHEXA -> 12 outer-face triangles.
    assert len(artifact.triangles) == 2 + 1 + 12
    assert len(artifact.element_ids) == len(artifact.triangles)
    # Every triangle maps to a real element ID.
    assert set(artifact.element_ids) == {1, 2, 3}


def test_preview_create_payload(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    result = fem_preview_service.create_preview(
        [("model.fem", SMALL_FEM.encode("utf-8"))]
    )
    assert result["preview_id"]
    assert result["stats"]["node_count"] == 8
    assert result["stats"]["element_count"] == 3
    assert result["stats"]["triangle_count"] == 15
    assert result["stats"]["element_types"]["CQUAD4"] == 1
    assert result["glb_url"].endswith("/model.glb")
    assert result["mapping_url"].endswith("/mapping.json")

    preview_dir = fem_preview_service.resolve_preview_dir(result["preview_id"])
    glb = (preview_dir / "model.glb").read_bytes()
    # GLB header: magic "glTF", version 2.
    assert glb[:4] == b"glTF"
    assert struct.unpack("<I", glb[4:8])[0] == 2
    mapping = (preview_dir / "mapping.json").read_text(encoding="utf-8")
    assert "triangle_element_ids" in mapping


def test_preview_include_files(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    result = fem_preview_service.create_preview(
        [
            ("model.fem", MAIN_WITH_INCLUDE.encode("utf-8")),
            ("shells.inc", INCLUDE_FILE.encode("utf-8")),
        ]
    )
    assert result["stats"]["node_count"] == 8
    assert result["stats"]["element_count"] == 3
    assert result["stats"]["included_files"] == ["shells.inc"]


def test_preview_missing_include_fails(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    with pytest.raises(FemPreviewError, match="INCLUDE"):
        fem_preview_service.create_preview(
            [("model.fem", MAIN_WITH_INCLUDE.encode("utf-8"))]
        )


def test_preview_no_main_file_fails(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    with pytest.raises(FemPreviewError, match="未找到"):
        fem_preview_service.create_preview([("notes.txt", b"hello")])


def test_preview_invalid_deck_fails(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    with pytest.raises(FemPreviewError, match="FEM 解析失败"):
        fem_preview_service.create_preview([("model.fem", b"GRID 1 0 0 0\n")])


def test_resolve_preview_dir_rejects_traversal(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    with pytest.raises(KeyError):
        fem_preview_service.resolve_preview_dir("../../etc")


# A deck without any HyperMesh component metadata but two properties, so the
# preview falls back to property (PID) grouping.
MULTI_PID_FEM = "\n".join(
    [
        "BEGIN BULK",
        _card("GRID", 1, "", 0.0, 0.0, 0.0),
        _card("GRID", 2, "", 10.0, 0.0, 0.0),
        _card("GRID", 3, "", 10.0, 10.0, 0.0),
        _card("GRID", 4, "", 0.0, 10.0, 0.0),
        _card("GRID", 5, "", 0.0, 0.0, 10.0),
        _card("GRID", 6, "", 10.0, 0.0, 10.0),
        _card("CQUAD4", 1, 1, 1, 2, 3, 4),
        _card("CQUAD4", 2, 2, 3, 4, 5, 6),
        "ENDDATA",
    ]
)


def test_parse_component_blocks() -> None:
    model = _parse(SMALL_FEM)
    assert model.components[1].name == "plate"
    assert model.metadata["element_component_ids"] == {1: 1, 2: 1, 3: 1}


def test_preview_grouping_component(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    result = fem_preview_service.create_preview([("model.fem", SMALL_FEM.encode("utf-8"))])
    grouping = result["grouping"]
    assert grouping["coloring_mode"] == "component"
    assert grouping["groups"] == [
        {"id": 1, "name": "plate", "color": "hsl(0, 55%, 42%)", "element_count": 3}
    ]
    assert grouping["element_group_ids"] == {1: 1, 2: 1, 3: 1}


def test_preview_grouping_property_fallback(tmp_path, monkeypatch) -> None:
    from app.services import fem as fem_module

    preview_root = tmp_path / "fem_preview"
    monkeypatch.setattr(fem_module.preview, "PREVIEW_ROOT", preview_root)

    result = fem_preview_service.create_preview([("model.fem", MULTI_PID_FEM.encode("utf-8"))])
    grouping = result["grouping"]
    assert grouping["coloring_mode"] == "property"
    assert {group["name"] for group in grouping["groups"]} == {"PID 1", "PID 2"}
    assert grouping["element_group_ids"] == {1: 1, 2: 2}
