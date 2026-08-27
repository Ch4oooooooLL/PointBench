"""Nastran/OptiStruct FEM parsing and GLB preview artifacts."""

from .canonical import CanonicalFEModel, Element, Node
from .glb import MeshArtifact, build_triangle_mesh, write_glb
from .parser import FemModelProvider, ModelParseError, ModelProviderError
from .preview import FemPreviewError, FemPreviewService, fem_preview_service

__all__ = [
    "CanonicalFEModel",
    "Element",
    "Node",
    "MeshArtifact",
    "build_triangle_mesh",
    "write_glb",
    "FemModelProvider",
    "ModelParseError",
    "ModelProviderError",
    "FemPreviewError",
    "FemPreviewService",
    "fem_preview_service",
]
