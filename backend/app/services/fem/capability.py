"""Capabilities exposed by finite-element model providers."""

from __future__ import annotations

from enum import StrEnum


class Capability(StrEnum):
    """Stable feature names used to select model providers.

    The aliases and the more granular names are intentional.  Older callers
    can ask whether a provider has ``GRID``/``CTRIA3``/``CQUAD4`` while newer
    callers can use the source-independent ``GEOMETRY`` and ``TOPOLOGY``
    capabilities.  No product-version checks are needed by downstream code.
    """

    FEM = "fem"
    H5 = "h5"
    H5_ENRICHMENT = "h5_enrichment"

    GEOMETRY = "geometry"
    TOPOLOGY = "topology"
    GRID = "grid"
    NODE_IDS = "node_ids"
    COORDINATES = "coordinates"
    ELEMENTS = "elements"
    ELEMENT_IDS = "element_ids"
    CONNECTIVITY = "connectivity"
    PROPERTIES = "properties"

    CTRIA3 = "ctria3"
    CTRIA6 = "ctria6"
    CQUAD4 = "cquad4"
    CQUAD8 = "cquad8"
    CTETRA = "ctetra"
    CTETRA10 = "ctetra10"
    CPENTA = "cpenta"
    CPENTA15 = "cpenta15"
    CPYRA = "cpyra"
    CPYRA13 = "cpyra13"
    CHEXA = "chexa"
    CHEXA20 = "chexa20"
    CROD = "crod"
    CBAR = "cbar"
    CBEAM = "cbeam"
    CONROD = "conrod"
    PSHELL = "pshell"
    PSOLID = "psolid"
    MAT1 = "mat1"
    SET1 = "set1"

    # Capability-routing names from the public model contract.
    MODEL_FEM_PARSE = "model_fem_parse"
    MODEL_H5_ENRICH = "model_h5_enrich"
    MODEL_ID_VALIDATE = "model_id_validate"
    RESULT_H3D_LOAD = "result_h3d_load"
    HOTSPOT_FIND = "hotspot_find"
    BEST_VIEW = "best_view"
    VIEW_RESTORE = "view_restore"

    @classmethod
    def coerce(cls, value: "Capability | str") -> "Capability":
        """Convert a capability-like value into :class:`Capability`.

        ``Capability`` is a ``StrEnum`` so values are already convenient to
        serialize.  This helper also accepts case-insensitive member names,
        which keeps configuration and API boundary code forgiving without
        silently accepting unknown capabilities.
        """

        if isinstance(value, cls):
            return value
        if not isinstance(value, str):
            raise TypeError(f"capability must be a Capability or str, got {type(value)!r}")
        normalized = value.strip().lower()
        try:
            return cls(normalized)
        except ValueError:
            try:
                return cls[value.strip().upper()]
            except KeyError as exc:
                raise ValueError(f"unknown capability: {value!r}") from exc
