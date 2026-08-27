"""Source-independent finite-element model records.

The canonical model intentionally keeps solver IDs as dictionary keys and as
fields on every record.  This makes accidental ordinal/index-based element
mapping difficult and gives mesh conversion code a single contract regardless
of whether data came from FEM or FORM2 H5.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Self

from .capability import Capability


def _as_int(value: Any, *, field_name: str) -> int:
    """Convert scalar integer-like values while rejecting lossy values."""

    if isinstance(value, bool):
        raise TypeError(f"{field_name} must be an integer, not bool")
    try:
        integer = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer, got {value!r}") from exc
    try:
        if float(value) != integer:
            raise ValueError(f"{field_name} must be integral, got {value!r}")
    except (TypeError, ValueError):
        # Strings such as ``"423"`` are valid and are already checked by int.
        if isinstance(value, str) and value.strip().lstrip("+-").isdigit():
            return integer
        if isinstance(value, int):
            return integer
        raise
    return integer


@dataclass(frozen=True, slots=True, eq=False)
class Node:
    """A GRID record in canonical form."""

    node_id: int
    coordinates: tuple[float, float, float]
    metadata: Mapping[str, Any] = field(default_factory=dict)
    coordinate_system: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "node_id", _as_int(self.node_id, field_name="node_id"))
        coordinates = tuple(float(value) for value in self.coordinates)
        if len(coordinates) != 3:
            raise ValueError(f"a node requires exactly three coordinates, got {coordinates!r}")
        object.__setattr__(self, "coordinates", coordinates)
        if self.coordinate_system is not None:
            object.__setattr__(
                self,
                "coordinate_system",
                _as_int(self.coordinate_system, field_name="coordinate_system"),
            )

    @property
    def id(self) -> int:
        """Short ID alias used by mesh consumers."""

        return self.node_id

    @property
    def xyz(self) -> tuple[float, float, float]:
        return self.coordinates

    def __iter__(self) -> Iterator[float]:
        return iter(self.coordinates)

    def __len__(self) -> int:
        return 3

    def __getitem__(self, key: int | str) -> Any:
        if isinstance(key, int):
            return self.coordinates[key]
        aliases = {
            "id": self.node_id,
            "node_id": self.node_id,
            "coordinates": self.coordinates,
            "coords": self.coordinates,
            "xyz": self.coordinates,
            "coordinate_system": self.coordinate_system,
            "cp": self.coordinate_system,
        }
        try:
            return aliases[key]
        except KeyError as exc:
            raise KeyError(key) from exc

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Node):
            return self.node_id == other.node_id and self.coordinates == other.coordinates
        if isinstance(other, (tuple, list)):
            return self.coordinates == tuple(float(value) for value in other)
        return NotImplemented

    def __hash__(self) -> int:
        return hash((self.node_id, self.coordinates))


CanonicalNode = Node


@dataclass(frozen=True, slots=True, eq=False)
class Element:
    """An element record with its original solver Element ID intact."""

    element_id: int
    element_type: str
    node_ids: tuple[int, ...]
    property_id: int | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    component_id: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "element_id",
            _as_int(self.element_id, field_name="element_id"),
        )
        element_type = str(self.element_type).strip().upper()
        if not element_type:
            raise ValueError("element_type must not be empty")
        object.__setattr__(self, "element_type", element_type)
        node_ids = tuple(_as_int(value, field_name="node_id") for value in self.node_ids)
        if not node_ids:
            raise ValueError("an element requires at least one node ID")
        object.__setattr__(self, "node_ids", node_ids)
        if self.property_id is not None:
            object.__setattr__(
                self,
                "property_id",
                _as_int(self.property_id, field_name="property_id"),
            )
        if self.component_id is not None:
            object.__setattr__(
                self,
                "component_id",
                _as_int(self.component_id, field_name="component_id"),
            )

    @property
    def id(self) -> int:
        return self.element_id

    @property
    def eid(self) -> int:
        return self.element_id

    @property
    def type(self) -> str:
        return self.element_type

    @property
    def card(self) -> str:
        return self.element_type

    @property
    def connectivity(self) -> tuple[int, ...]:
        return self.node_ids

    @property
    def nodes(self) -> tuple[int, ...]:
        return self.node_ids

    @property
    def pid(self) -> int | None:
        return self.property_id

    @property
    def cid(self) -> int | None:
        return self.component_id

    def __iter__(self) -> Iterator[int]:
        return iter(self.node_ids)

    def __len__(self) -> int:
        return len(self.node_ids)

    def __getitem__(self, key: int | str) -> Any:
        if isinstance(key, int):
            return self.node_ids[key]
        aliases = {
            "id": self.element_id,
            "eid": self.element_id,
            "element_id": self.element_id,
            "type": self.element_type,
            "card": self.element_type,
            "element_type": self.element_type,
            "nodes": self.node_ids,
            "node_ids": self.node_ids,
            "connectivity": self.node_ids,
            "pid": self.property_id,
            "property_id": self.property_id,
            "component_id": self.component_id,
        }
        try:
            return aliases[key]
        except KeyError as exc:
            raise KeyError(key) from exc

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Element):
            return (
                self.element_id == other.element_id
                and self.element_type == other.element_type
                and self.node_ids == other.node_ids
                and self.property_id == other.property_id
                and self.component_id == other.component_id
            )
        if isinstance(other, (tuple, list)):
            return self.node_ids == tuple(int(value) for value in other)
        return NotImplemented

    def __hash__(self) -> int:
        return hash(
            (self.element_id, self.element_type, self.node_ids, self.property_id, self.component_id)
        )


CanonicalElement = Element


@dataclass(frozen=True, slots=True, eq=False)
class Property:
    """A solver property with known references and lossless raw fields."""

    property_id: int
    property_type: str
    material_ids: tuple[int, ...] = ()
    fields: Mapping[str, Any] = field(default_factory=dict)
    raw_fields: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "property_id", _as_int(self.property_id, field_name="property_id"))
        object.__setattr__(self, "property_type", str(self.property_type).strip().upper())
        object.__setattr__(
            self,
            "material_ids",
            tuple(_as_int(value, field_name="material_id") for value in self.material_ids),
        )
        object.__setattr__(self, "fields", dict(self.fields))
        object.__setattr__(self, "raw_fields", tuple(str(value) for value in self.raw_fields))

    @property
    def id(self) -> int:
        return self.property_id

    @property
    def pid(self) -> int:
        return self.property_id

    @property
    def type(self) -> str:
        return self.property_type

    def __getitem__(self, key: str) -> Any:
        values = {
            "id": self.property_id,
            "pid": self.property_id,
            "property_id": self.property_id,
            "type": self.property_type,
            "property_type": self.property_type,
            "material_ids": self.material_ids,
            "fields": self.fields,
            "raw_fields": self.raw_fields,
        }
        if key in values:
            return values[key]
        return self.fields[key]


@dataclass(frozen=True, slots=True, eq=False)
class Material:
    """A solver material with common fields and the original field sequence."""

    material_id: int
    material_type: str
    fields: Mapping[str, Any] = field(default_factory=dict)
    raw_fields: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "material_id", _as_int(self.material_id, field_name="material_id"))
        object.__setattr__(self, "material_type", str(self.material_type).strip().upper())
        object.__setattr__(self, "fields", dict(self.fields))
        object.__setattr__(self, "raw_fields", tuple(str(value) for value in self.raw_fields))

    @property
    def id(self) -> int:
        return self.material_id

    @property
    def mid(self) -> int:
        return self.material_id

    @property
    def type(self) -> str:
        return self.material_type

    def __getitem__(self, key: str) -> Any:
        values = {
            "id": self.material_id,
            "mid": self.material_id,
            "material_id": self.material_id,
            "type": self.material_type,
            "material_type": self.material_type,
            "fields": self.fields,
            "raw_fields": self.raw_fields,
        }
        if key in values:
            return values[key]
        return self.fields[key]


@dataclass(frozen=True, slots=True, eq=False)
class Component:
    """Best-effort HyperMesh component metadata."""

    component_id: int
    name: str | None = None
    element_ids: tuple[int, ...] = ()
    property_id: int | None = None
    fields: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "component_id", _as_int(self.component_id, field_name="component_id"))
        object.__setattr__(self, "name", None if self.name is None else str(self.name))
        object.__setattr__(
            self,
            "element_ids",
            tuple(_as_int(value, field_name="element_id") for value in self.element_ids),
        )
        if self.property_id is not None:
            object.__setattr__(self, "property_id", _as_int(self.property_id, field_name="property_id"))
        object.__setattr__(self, "fields", dict(self.fields))

    @property
    def id(self) -> int:
        return self.component_id


@dataclass(frozen=True, slots=True, eq=False)
class SetDefinition:
    """A SET/SET1 definition; unknown card semantics stay in ``fields``."""

    set_id: int
    name: str | None = None
    entity_type: str = "unknown"
    entity_ids: tuple[int, ...] = ()
    fields: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "set_id", _as_int(self.set_id, field_name="set_id"))
        object.__setattr__(self, "name", None if self.name is None else str(self.name))
        object.__setattr__(self, "entity_type", str(self.entity_type).strip().lower() or "unknown")
        object.__setattr__(
            self,
            "entity_ids",
            tuple(_as_int(value, field_name="entity_id") for value in self.entity_ids),
        )
        object.__setattr__(self, "fields", dict(self.fields))

    @property
    def id(self) -> int:
        return self.set_id


@dataclass(frozen=True, slots=True, eq=False)
class Subcase:
    """Case-control metadata retained without guessing result semantics."""

    subcase_id: int
    label: str | None = None
    analysis: str | None = None
    references: Mapping[str, Any] = field(default_factory=dict)
    fields: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "subcase_id", _as_int(self.subcase_id, field_name="subcase_id"))
        object.__setattr__(self, "label", None if self.label is None else str(self.label))
        object.__setattr__(self, "analysis", None if self.analysis is None else str(self.analysis))
        object.__setattr__(self, "references", dict(self.references))
        object.__setattr__(self, "fields", dict(self.fields))

    @property
    def id(self) -> int:
        return self.subcase_id


def _node_record(key: Any, value: Any) -> Node:
    if isinstance(value, Node):
        if value.node_id != _as_int(key, field_name="node key"):
            raise ValueError(f"node key {key!r} does not match record ID {value.node_id}")
        return value
    if isinstance(value, Mapping):
        node_id = value.get("node_id", value.get("id", key))
        coordinates = value.get("coordinates", value.get("coords", value.get("xyz")))
        if coordinates is None:
            coordinates = (value.get("x"), value.get("y"), value.get("z"))
        return Node(
            node_id,
            coordinates,
            value.get("metadata", {}),
            value.get("coordinate_system", value.get("cp")),
        )
    return Node(key, value)


def _element_record(key: Any, value: Any) -> Element:
    if isinstance(value, Element):
        if value.element_id != _as_int(key, field_name="element key"):
            raise ValueError(f"element key {key!r} does not match record ID {value.element_id}")
        return value
    if isinstance(value, Mapping):
        element_id = value.get("element_id", value.get("eid", value.get("id", key)))
        element_type = value.get("element_type", value.get("type", value.get("card")))
        node_ids = value.get("node_ids", value.get("connectivity", value.get("nodes")))
        if element_type is None or node_ids is None:
            raise ValueError(f"element mapping for {key!r} lacks type or connectivity")
        return Element(
            element_id,
            element_type,
            node_ids,
            value.get("property_id", value.get("pid")),
            value.get("metadata", {}),
            value.get("component_id", value.get("cid")),
        )
    if isinstance(value, (tuple, list)) and len(value) == 2:
        return Element(key, value[0], value[1])
    raise TypeError(f"unsupported element record for {key!r}: {type(value)!r}")


def _normalize_properties(values: Mapping[int, Property | Mapping[str, Any]]) -> dict[int, Property]:
    normalized: dict[int, Property] = {}
    for key, value in values.items():
        if isinstance(value, Property):
            record = value
        elif isinstance(value, Mapping):
            record = Property(
                value.get("property_id", value.get("pid", value.get("id", key))),
                value.get("property_type", value.get("type", value.get("card", "UNKNOWN"))),
                value.get("material_ids", value.get("materials", ())),
                value.get("fields", {}),
                value.get("raw_fields", ()),
            )
        else:
            raise TypeError(f"unsupported property record for {key!r}: {type(value)!r}")
        if record.property_id != _as_int(key, field_name="property key"):
            raise ValueError(f"property key {key!r} does not match record ID {record.property_id}")
        if record.property_id in normalized:
            raise ValueError(f"duplicate property ID {record.property_id}")
        normalized[record.property_id] = record
    return normalized


def _normalize_materials(values: Mapping[int, Material | Mapping[str, Any]]) -> dict[int, Material]:
    normalized: dict[int, Material] = {}
    for key, value in values.items():
        if isinstance(value, Material):
            record = value
        elif isinstance(value, Mapping):
            record = Material(
                value.get("material_id", value.get("mid", value.get("id", key))),
                value.get("material_type", value.get("type", value.get("card", "UNKNOWN"))),
                value.get("fields", {}),
                value.get("raw_fields", ()),
            )
        else:
            raise TypeError(f"unsupported material record for {key!r}: {type(value)!r}")
        if record.material_id != _as_int(key, field_name="material key"):
            raise ValueError(f"material key {key!r} does not match record ID {record.material_id}")
        if record.material_id in normalized:
            raise ValueError(f"duplicate material ID {record.material_id}")
        normalized[record.material_id] = record
    return normalized


def _normalize_components(values: Mapping[int, Component | Mapping[str, Any]]) -> dict[int, Component]:
    normalized: dict[int, Component] = {}
    for key, value in values.items():
        if isinstance(value, Component):
            record = value
        elif isinstance(value, Mapping):
            record = Component(
                value.get("component_id", value.get("cid", value.get("id", key))),
                value.get("name"),
                value.get("element_ids", value.get("elements", ())),
                value.get("property_id", value.get("pid")),
                value.get("fields", {}),
            )
        else:
            raise TypeError(f"unsupported component record for {key!r}: {type(value)!r}")
        if record.component_id != _as_int(key, field_name="component key"):
            raise ValueError(f"component key {key!r} does not match record ID {record.component_id}")
        if record.component_id in normalized:
            raise ValueError(f"duplicate component ID {record.component_id}")
        normalized[record.component_id] = record
    return normalized


def _normalize_sets(values: Mapping[int, SetDefinition | Mapping[str, Any]]) -> dict[int, SetDefinition]:
    normalized: dict[int, SetDefinition] = {}
    for key, value in values.items():
        if isinstance(value, SetDefinition):
            record = value
        elif isinstance(value, Mapping):
            record = SetDefinition(
                value.get("set_id", value.get("sid", value.get("id", key))),
                value.get("name"),
                value.get("entity_type", value.get("type", "unknown")),
                value.get("entity_ids", value.get("ids", ())),
                value.get("fields", {}),
            )
        else:
            raise TypeError(f"unsupported set record for {key!r}: {type(value)!r}")
        if record.set_id != _as_int(key, field_name="set key"):
            raise ValueError(f"set key {key!r} does not match record ID {record.set_id}")
        if record.set_id in normalized:
            raise ValueError(f"duplicate set ID {record.set_id}")
        normalized[record.set_id] = record
    return normalized


def _normalize_subcases(values: Mapping[int, Subcase | Mapping[str, Any]]) -> dict[int, Subcase]:
    normalized: dict[int, Subcase] = {}
    for key, value in values.items():
        if isinstance(value, Subcase):
            record = value
        elif isinstance(value, Mapping):
            record = Subcase(
                value.get("subcase_id", value.get("sid", value.get("id", key))),
                value.get("label"),
                value.get("analysis"),
                value.get("references", {}),
                value.get("fields", {}),
            )
        else:
            raise TypeError(f"unsupported subcase record for {key!r}: {type(value)!r}")
        if record.subcase_id != _as_int(key, field_name="subcase key"):
            raise ValueError(f"subcase key {key!r} does not match record ID {record.subcase_id}")
        if record.subcase_id in normalized:
            raise ValueError(f"duplicate subcase ID {record.subcase_id}")
        normalized[record.subcase_id] = record
    return normalized


@dataclass(slots=True)
class CanonicalFEModel:
    """Normalized model contract shared by FEM and H5 providers."""

    nodes: Mapping[int, Node | Mapping[str, Any] | Iterable[float]] = field(default_factory=dict)
    elements: Mapping[int, Element | Mapping[str, Any] | tuple[Any, Any]] = field(
        default_factory=dict
    )
    properties: Mapping[int, Property | Mapping[str, Any]] = field(default_factory=dict)
    materials: Mapping[int, Material | Mapping[str, Any]] = field(default_factory=dict)
    components: Mapping[int, Component | Mapping[str, Any]] = field(default_factory=dict)
    sets: Mapping[int, SetDefinition | Mapping[str, Any]] = field(default_factory=dict)
    subcases: Mapping[int, Subcase | Mapping[str, Any]] = field(default_factory=dict)
    source: str = "unknown"
    source_path: Path | str | None = None
    capabilities: Iterable[Capability | str] = field(default_factory=tuple)
    metadata: dict[str, Any] = field(default_factory=dict)
    enrichments: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_nodes: dict[int, Node] = {}
        for key, value in self.nodes.items():
            node = _node_record(key, value)
            if node.node_id in normalized_nodes:
                raise ValueError(f"duplicate node ID {node.node_id}")
            normalized_nodes[node.node_id] = node

        normalized_elements: dict[int, Element] = {}
        for key, value in self.elements.items():
            element = _element_record(key, value)
            if element.element_id in normalized_elements:
                raise ValueError(f"duplicate element ID {element.element_id}")
            normalized_elements[element.element_id] = element

        object.__setattr__(self, "nodes", normalized_nodes)
        object.__setattr__(self, "elements", normalized_elements)
        object.__setattr__(self, "properties", _normalize_properties(self.properties))
        object.__setattr__(self, "materials", _normalize_materials(self.materials))
        object.__setattr__(self, "components", _normalize_components(self.components))
        object.__setattr__(self, "sets", _normalize_sets(self.sets))
        object.__setattr__(self, "subcases", _normalize_subcases(self.subcases))
        object.__setattr__(self, "source", str(self.source).strip().lower() or "unknown")
        if self.source_path is not None:
            object.__setattr__(self, "source_path", Path(self.source_path))
        capability_set = frozenset(Capability.coerce(value) for value in self.capabilities)
        object.__setattr__(self, "capabilities", capability_set)
        object.__setattr__(self, "metadata", dict(self.metadata))
        object.__setattr__(self, "enrichments", dict(self.enrichments))

    @property
    def grid(self) -> dict[int, Node]:
        """GRID alias retained for callers that use solver card terminology."""

        return self.nodes

    @property
    def grids(self) -> dict[int, Node]:
        return self.nodes

    @property
    def node_map(self) -> dict[int, Node]:
        return self.nodes

    @property
    def element_map(self) -> dict[int, Element]:
        return self.elements

    @property
    def property_map(self) -> dict[int, Property]:
        return self.properties

    @property
    def material_map(self) -> dict[int, Material]:
        return self.materials

    @property
    def component_map(self) -> dict[int, Component]:
        return self.components

    @property
    def elements_by_id(self) -> dict[int, Element]:
        return self.elements

    @property
    def node_ids(self) -> tuple[int, ...]:
        return tuple(self.nodes)

    @property
    def element_ids(self) -> tuple[int, ...]:
        return tuple(self.elements)

    @property
    def element_types(self) -> frozenset[str]:
        return frozenset(element.element_type for element in self.elements.values())

    @property
    def counts(self) -> dict[str, int]:
        return {
            "nodes": len(self.nodes),
            "elements": len(self.elements),
            **{
                element_type: sum(
                    1 for element in self.elements.values() if element.element_type == element_type
                )
                for element_type in self.element_types
            },
        }

    def node(self, node_id: int) -> Node:
        return self.nodes[_as_int(node_id, field_name="node_id")]

    def element(self, element_id: int) -> Element:
        return self.elements[_as_int(element_id, field_name="element_id")]

    def has_capability(self, capability: Capability | str) -> bool:
        return Capability.coerce(capability) in self.capabilities

    def supports(self, capability: Capability | str) -> bool:
        return self.has_capability(capability)

    def centroid(self, element_id: int) -> tuple[float, float, float]:
        """Return the centroid of an element using its solver node IDs."""

        element = self.element(element_id)
        points = [self.node(node_id).coordinates for node_id in element.node_ids]
        count = len(points)
        return tuple(sum(point[index] for point in points) / count for index in range(3))  # type: ignore[return-value]

    def copy_with_enrichment(
        self,
        *,
        name: str,
        value: Any,
        capabilities: Iterable[Capability | str] = (),
    ) -> Self:
        """Return a shallow model copy with optional provider enrichment."""

        enriched = type(self)(
            nodes=self.nodes,
            elements=self.elements,
            properties=self.properties,
            materials=self.materials,
            components=self.components,
            sets=self.sets,
            subcases=self.subcases,
            source=self.source,
            source_path=self.source_path,
            capabilities=set(self.capabilities) | {Capability.coerce(capability) for capability in capabilities},
            metadata=self.metadata,
            enrichments={**self.enrichments, name: value},
        )
        return enriched
