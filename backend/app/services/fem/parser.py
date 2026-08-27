"""Nastran/OptiStruct FEM card parser producing a canonical model."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, ClassVar

from .canonical import (
    CanonicalFEModel,
    Component,
    Element,
    Material,
    Node,
    Property,
    SetDefinition,
    Subcase,
)
from .capability import Capability


class ModelProviderError(RuntimeError):
    """Base error for a source provider that cannot build a model."""


class ModelParseError(ModelProviderError, ValueError):
    """Raised when a required source contains invalid model records."""


_SEMANTIC_SOLID_FIELDS = frozenset({"CORDM", "CID", "THETA", "PHI"})

# HyperMesh export metadata cards.  These live in ``$`` comment rows and are
# the standard way a deck records component names/colors and element-to-comp
# membership (``$HMCOMP ID`` is the block marker that groups the elements
# following it until the next marker).
_HMNAME_COMP_RE = re.compile(r'^\$HMNAME\s+COMP\s+(\d+)\s*"([^"]*)"', re.IGNORECASE)
_HWCOLOR_COMP_RE = re.compile(r"^\$HWCOLOR\s+COMP\s+(\d+)\s+(\d+)", re.IGNORECASE)
_HMCOMP_ID_RE = re.compile(r"^\$HMCOMP\s+ID\s+(\d+)", re.IGNORECASE)
_ELEMENTPROP_RE = re.compile(r"^\$ELEMENTPROP\s+(\d+)\s+(\d+)", re.IGNORECASE)


def _as_int(value: Any, *, field_name: str) -> int:
    if isinstance(value, bool):
        raise ModelParseError(f"{field_name} must be an integer, not bool")
    try:
        integer = int(value)
    except (TypeError, ValueError) as exc:
        raise ModelParseError(f"{field_name} must be an integer, got {value!r}") from exc
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = float(integer)
    if numeric != integer:
        raise ModelParseError(f"{field_name} must be integral, got {value!r}")
    return integer


def _parse_float(value: Any, *, field_name: str) -> float:
    """Parse Nastran/OptiStruct real formats, including compact exponents."""

    if isinstance(value, bytes):
        value = value.decode("ascii", errors="replace")
    text = str(value).strip().replace("D", "E").replace("d", "e")
    if not text:
        raise ModelParseError(f"{field_name} is empty")
    # Nastran permits compact exponents such as ``1.25-3`` for 1.25e-3.
    if "e" not in text.lower():
        compact = re.match(r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([+-]\d+)$", text)
        if compact:
            text = f"{compact.group(1)}e{compact.group(2)}"
    try:
        return float(text)
    except ValueError as exc:
        raise ModelParseError(f"invalid {field_name}: {value!r}") from exc


def _fixed_fields(line: str) -> list[str]:
    """Return standard 8-character fields, preserving empty fields.

    OptiStruct decks in this repository use small-field cards.  A whitespace
    fallback is retained for hand-written fixtures and a comma branch handles
    free-field cards without changing the fixed-width interpretation.
    """

    if "," in line[:16]:
        return [field.strip() for field in line.split(",")]
    fields = [line[index : index + 8].strip() for index in range(0, len(line), 8)]
    fixed_card = line[:8].strip().rstrip("*")
    if fields and fixed_card and " " not in fixed_card:
        return fields
    # A standard small-field continuation reserves a blank first field.  Keep
    # that empty slot when the physical row is long enough to be unambiguously
    # fixed-width; short indented hand-written rows retain the whitespace
    # fallback below.
    if fields and not fixed_card and len(line) >= 16:
        return fields
    return line.split()


def _card_name(line: str) -> str:
    if "," in line[:16]:
        return line.split(",", 1)[0].strip().upper()
    card = line[:8].strip().upper()
    if card:
        return card.rstrip("*")
    return line.split(maxsplit=1)[0].upper().rstrip("*") if line.split() else ""


def _read_card_fields(line: str, card: str) -> list[str]:
    fields = _fixed_fields(line)
    if fields and fields[0].upper().rstrip("*") == card:
        return fields
    tokens = line.split()
    if tokens and tokens[0].upper().rstrip("*") == card:
        return tokens
    return fields


def _large_field_values(line: str) -> list[str]:
    """Return the four 16-character fields of a large-field card row.

    Large-field rows reserve the first 8 characters for the card name (main
    row) or the ``*`` continuation marker, followed by four 16-character
    fields.
    """

    return [line[8 + 16 * index : 8 + 16 * (index + 1)].strip() for index in range(4)]


def _strip_inline_comment(line: str) -> str:
    """Remove an inline ``$`` comment while preserving quoted dollar signs."""

    quote: str | None = None
    index = 0
    while index < len(line):
        character = line[index]
        if quote is not None:
            if character == quote:
                # Doubled quote characters are the conventional escaped quote
                # in solver string fields; keep scanning inside the field.
                if index + 1 < len(line) and line[index + 1] == quote:
                    index += 2
                    continue
                quote = None
        elif character in {"'", '"'}:
            quote = character
        elif character == "$":
            return line[:index]
        index += 1
    return line


def _standard_fixed_row(line: str) -> bool:
    """Return whether *line* uses the eight-character small-field layout.

    A number of the repository's hand-written fixtures use ordinary
    whitespace-separated records (for example ``"CTETRA 100 1 ..."``).  A
    continuation line in that form cannot be distinguished reliably from the
    next record, so it must retain the existing whitespace fallback.  Solver
    decks use a card/continuation identifier in the first eight-character
    field, which is the unambiguous form handled by the continuation
    assembler.
    """

    if "," in line[:16]:
        return False
    first = line[:8]
    token = first.strip()
    return bool(token) and " " not in token and "\t" not in token


def _continuation_label(value: str) -> bool:
    """Return whether a field is a continuation marker/label.

    Numeric values, including signed node IDs, are deliberately not labels.
    A marker can be just ``+``/``*`` or a solver continuation identifier such
    as ``+CONT``.  The alphabetic branch also accepts a fixed-field label that
    does not carry a marker; it is used only after a continuation row has
    already been identified.
    """

    token = value.strip()
    if not token:
        return False
    if token in {"+", "*"}:
        return True
    if _looks_numeric(token):
        return False
    if token[0] in {"+", "*"}:
        return True
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$-]*", token))


def _continuation_values(line: str, *, mode: str) -> list[str]:
    """Tokenize one small/free-field continuation row.

    Fixed-field continuations reserve their first eight-character field for a
    blank or continuation identifier.  Free-field continuations put that
    marker in the first comma-delimited field.  Removing these fields here
    prevents labels from being interpreted as connectivity IDs while keeping
    empty data fields intact for the required-field validation in the card
    parser.
    """

    fields = _fixed_fields(line)
    if mode == "free":
        if fields and (not fields[0].strip() or fields[0].lstrip().startswith(("+", "*"))):
            fields = fields[1:]
    elif mode == "fixed" and fields:
        # The first field is always reserved by the fixed-field continuation
        # layout, including the blank-field form used by OptiStruct.  The
        # final field is the optional continuation identifier.  Deck writers
        # commonly omit trailing blank columns, so remove it by value rather
        # than requiring a physical 80-character row.
        if len(fields) >= 10:
            # A full-width physical row has exactly one continuation-ID
            # column after the eight data fields; its value may be numeric.
            fields.pop(9)
        elif len(fields) > 1 and (not fields[-1].strip() or _continuation_label(fields[-1])):
            fields.pop()
        fields = fields[1:]
    # Some free-field writers put the continuation ID in a separate first
    # field (``+,CONT,G7,...``), while others attach it to the marker
    # (``+CONT,G7,...``).  The physical marker has already been removed;
    # remove one remaining nonnumeric edge label unless it is semantic data.
    if fields and _continuation_label(fields[0]) and fields[0].strip().upper() not in _SEMANTIC_SOLID_FIELDS:
        fields.pop(0)
    # A trailing continuation identifier is legal in several deck writers.
    # Remove only trailing markers/padding; preserve interior empty fields so
    # missing required connectivity still fails at its original card line.
    while fields and (
        not fields[-1].strip()
        or (
            _continuation_label(fields[-1])
            and fields[-1].strip().upper() not in _SEMANTIC_SOLID_FIELDS
        )
    ):
        fields.pop()
    return fields


def _free_continuation_row(line: str) -> bool:
    """Return whether a comma-delimited row carries a free-field marker."""

    if "," not in line[:16]:
        return False
    marker = line.split(",", 1)[0].strip()
    return not marker or marker.startswith(("+", "*"))


def _fixed_continuation_row(line: str) -> bool:
    """Return whether a physical row has a fixed-field continuation shape."""

    if "," in line[:16]:
        return False
    marker = line[:8].strip()
    if not marker or marker.startswith(("+", "*")):
        return True
    return False


def _looks_numeric(value: str) -> bool:
    """Return whether a field can represent a numeric solver value."""

    token = value.strip()
    if not token:
        return False
    normalized = token.replace("D", "E").replace("d", "e")
    try:
        float(normalized)
    except ValueError:
        compact = re.match(r"^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([+-]\d+)$", normalized)
        return compact is not None
    return True


def _continuation_mode(line: str) -> str | None:
    """Return the physical tokenizer for a legal continuation row."""

    if _free_continuation_row(line):
        return "free"
    if _fixed_continuation_row(line):
        return "fixed"
    return None


def _strip_free_parent_continuation(fields: list[str]) -> list[str]:
    """Drop one nonnumeric trailing continuation identifier from a parent."""

    while fields and not fields[-1].strip():
        fields.pop()
    if fields:
        token = fields[-1].strip()
        if token.upper() not in _SEMANTIC_SOLID_FIELDS and _continuation_label(token):
            fields.pop()
    return fields


def _field(fields: Sequence[str], index: int, *, card: str, line_number: int) -> str:
    try:
        value = fields[index].strip()
    except IndexError as exc:
        raise ModelParseError(f"{card} line {line_number} is missing field {index}") from exc
    if not value:
        raise ModelParseError(f"{card} line {line_number} has an empty field {index}")
    return value


class FEModelProvider(ABC):
    """Abstract provider interface consumed by downstream mesh code."""

    provider_name: ClassVar[str] = "unknown"

    @property
    @abstractmethod
    def capabilities(self) -> frozenset[Capability]:
        """Capabilities available from this provider instance."""

    @abstractmethod
    def load(self) -> CanonicalFEModel:
        """Read and normalize the source into a canonical model."""

    def provide(self) -> CanonicalFEModel:
        """Compatibility alias for callers using provider terminology."""

        return self.load()

    def read(self) -> CanonicalFEModel:
        """Compatibility alias for source-reader callers."""

        return self.load()

    def get_model(self) -> CanonicalFEModel:
        """Compatibility alias for service-style callers."""

        return self.load()

    def supports(self, capability: Capability | str) -> bool:
        return Capability.coerce(capability) in self.capabilities

    def has_capability(self, capability: Capability | str) -> bool:
        return self.supports(capability)


_FEM_CAPABILITIES = frozenset(
    {
        Capability.FEM,
        Capability.MODEL_FEM_PARSE,
        Capability.MODEL_ID_VALIDATE,
        Capability.GEOMETRY,
        Capability.TOPOLOGY,
        Capability.GRID,
        Capability.NODE_IDS,
        Capability.COORDINATES,
        Capability.ELEMENTS,
        Capability.ELEMENT_IDS,
        Capability.CONNECTIVITY,
        Capability.PROPERTIES,
        Capability.CTRIA3,
        Capability.CTRIA6,
        Capability.CQUAD4,
        Capability.CQUAD8,
        Capability.CTETRA,
        Capability.CTETRA10,
        Capability.CPENTA,
        Capability.CPENTA15,
        Capability.CPYRA,
        Capability.CPYRA13,
        Capability.CHEXA,
        Capability.CHEXA20,
        Capability.CROD,
        Capability.CBAR,
        Capability.CBEAM,
        Capability.CONROD,
        Capability.PSHELL,
        Capability.PSOLID,
        Capability.MAT1,
        Capability.SET1,
    }
)


class FemModelProvider(FEModelProvider):
    """Parse supported small-field FEM cards into :class:`CanonicalFEModel`."""

    provider_name = "fem"
    _supported_cards = frozenset(
        {
            "GRID",
            "CTRIA3",
            "CTRIA6",
            "CQUAD4",
            "CQUAD8",
            "CTETRA",
            "CTETRA10",
            "CPENTA",
            "CPENTA15",
            "CPYRA",
            "CPYRA13",
            "CHEXA",
            "CHEXA20",
            "CROD",
            "CBAR",
            "CBEAM",
            "CONROD",
            "PSHELL",
            "PSOLID",
            "MAT1",
            "SET1",
            "SUBCASE",
            "LOAD",
            "SPC",
            "ANALYSIS",
        }
    )
    # Node counts per solid card, including the mid-side node variants.
    _solid_node_counts = {
        "CTETRA": 4,
        "CPENTA": 6,
        "CPYRA": 5,
        "CHEXA": 8,
        "CTETRA10": 10,
        "CPENTA15": 15,
        "CPYRA13": 13,
        "CHEXA20": 20,
    }
    # OptiStruct uses the base card names for both linear and optional
    # mid-side-node solids.  The suffixed names remain accepted for the
    # repository's established fixtures, while a standard CHEXA/CPENTA/
    # CTETRA card may expose the larger connectivity directly.
    _solid_max_node_counts = {
        "CTETRA": 10,
        "CPENTA": 15,
        "CPYRA": 13,
        "CHEXA": 20,
    }
    # Free-field continuation identifiers can occur after any element's
    # connectivity, not only after solids.  Remove them before assembling a
    # logical card so a labeled CTRIA6/CQUAD8 row cannot shift the following
    # node IDs into the wrong positions.
    _continuable_connectivity_cards = frozenset(
        {
            "CTRIA3",
            "CTRIA6",
            "CQUAD4",
            "CQUAD8",
            "CROD",
            "CBAR",
            "CBEAM",
            "CONROD",
        }
    ) | frozenset(_solid_node_counts)

    _element_cards = frozenset(
        {
            "CTRIA3",
            "CTRIA6",
            "CQUAD4",
            "CQUAD8",
            "CTETRA",
            "CTETRA10",
            "CPENTA",
            "CPENTA15",
            "CPYRA",
            "CPYRA13",
            "CHEXA",
            "CHEXA20",
            "CROD",
            "CBAR",
            "CBEAM",
            "CONROD",
        }
    )

    def __init__(
        self,
        fem_path: str | Path,
        *,
        include_root: str | Path | None = None,
        max_include_depth: int = 64,
        max_include_files: int = 512,
        on_progress: Callable[..., None] | None = None,
    ) -> None:
        self.fem_path = Path(fem_path)
        self.include_root = Path(include_root) if include_root is not None else None
        if isinstance(max_include_depth, bool) or not isinstance(max_include_depth, int) or not 1 <= max_include_depth <= 512:
            raise ValueError("max_include_depth must be between 1 and 512")
        if isinstance(max_include_files, bool) or not isinstance(max_include_files, int) or not 1 <= max_include_files <= 10000:
            raise ValueError("max_include_files must be between 1 and 10000")
        self.max_include_depth = max_include_depth
        self.max_include_files = max_include_files
        self.on_progress = on_progress

    @property
    def path(self) -> Path:
        return self.fem_path

    @property
    def capabilities(self) -> frozenset[Capability]:
        return _FEM_CAPABILITIES

    def load(self) -> CanonicalFEModel:
        if not self.fem_path.is_file():
            raise FileNotFoundError(f"FEM source does not exist: {self.fem_path}")
        main_path = self.fem_path.resolve(strict=False)
        include_root = (self.include_root or main_path.parent).resolve(strict=False)
        try:
            main_path.relative_to(include_root)
        except ValueError as exc:
            raise ModelParseError(
                f"main FEM source is outside include root: {main_path} (root {include_root})"
            ) from exc
        source_lines, included_files = self._read_with_includes(main_path, include_root)

        nodes: dict[int, Node] = {}
        elements: dict[int, Element] = {}
        properties: dict[int, Property] = {}
        materials: dict[int, Material] = {}
        sets: dict[int, SetDefinition] = {}
        subcases: dict[int, Subcase] = {}
        components: dict[int, Component] = {}
        ignored_cards: dict[str, int] = {}
        current_subcase: int | None = None
        # HyperMesh component metadata: element->comp membership collected
        # from ``$HMCOMP ID`` block markers plus ``$ELEMENTPROP`` pid links.
        element_comp_block: dict[int, int] = {}
        elementprop_by_pid: dict[int, int] = {}
        current_component_id: int | None = None

        def dispatch(fields: Sequence[str], line_number: int) -> None:
            nonlocal current_subcase
            card = str(fields[0]).strip().upper().rstrip("*")
            if card in self._element_cards and current_component_id is not None and len(fields) > 1:
                try:
                    element_comp_block[_as_int(fields[1], field_name=f"{card} EID")] = current_component_id
                except ModelParseError:
                    pass
            if card not in self._supported_cards:
                if card and not card.startswith("$"):
                    ignored_cards[card] = ignored_cards.get(card, 0) + 1
                return
            if card == "GRID":
                self._parse_grid(fields, line_number, nodes)
            elif card in {"CTRIA3", "CTRIA6"}:
                self._parse_shell(card, fields, line_number, elements, 3 if card == "CTRIA3" else 6)
            elif card in {"CQUAD4", "CQUAD8"}:
                self._parse_shell(card, fields, line_number, elements, 4 if card == "CQUAD4" else 8)
            elif card in self._solid_node_counts:
                self._parse_solid(card, fields, line_number, elements)
            elif card in {"CROD", "CBAR", "CBEAM", "CONROD"}:
                self._parse_bar(card, fields, line_number, elements)
            elif card in {"PSHELL", "PSOLID"}:
                self._parse_property(card, fields, line_number, properties)
            elif card == "MAT1":
                self._parse_mat1(fields, line_number, materials)
            elif card == "SET1":
                self._parse_set1(fields, line_number, sets)
            elif card == "SUBCASE":
                current_subcase = self._parse_subcase(fields, line_number, subcases)
            elif card in {"LOAD", "SPC", "ANALYSIS"} and current_subcase is not None:
                self._parse_subcase_reference(
                    card,
                    fields,
                    line_number,
                    subcases[current_subcase],
                )

        # Large-field cards (16-character fields, name ending in ``*``, rows
        # starting with ``*``) and ordinary small/free-field continuation rows
        # are assembled before dispatch.  Dispatching each physical row on
        # its own loses CHEXA G7/G8 (and all high-order continuation nodes).
        large_fields: list[str] | None = None
        large_line_number = 0
        large_source_path: Path | None = None
        pending_fields: list[str] | None = None
        pending_card = ""
        pending_mode = ""
        pending_line_number = 0
        pending_source_path: Path | None = None

        def flush_pending() -> None:
            nonlocal pending_fields, pending_card, pending_mode, pending_line_number, pending_source_path
            if pending_fields is not None:
                dispatch(pending_fields, pending_line_number)
            pending_fields = None
            pending_card = ""
            pending_mode = ""
            pending_line_number = 0
            pending_source_path = None

        def flush_large() -> None:
            nonlocal large_fields, large_line_number, large_source_path
            if large_fields is not None:
                dispatch(large_fields, large_line_number)
            large_fields = None
            large_line_number = 0
            large_source_path = None

        def required_field_count(card: str) -> int | None:
            if card in {"CTRIA3", "CTRIA6"}:
                return 3 + (3 if card == "CTRIA3" else 6)
            if card in {"CQUAD4", "CQUAD8"}:
                return 3 + (4 if card == "CQUAD4" else 8)
            if card in self._solid_node_counts:
                node_count = self._solid_max_node_counts.get(
                    card,
                    self._solid_node_counts[card],
                )
                return 3 + node_count
            if card == "CONROD":
                return 4
            if card in {"CROD", "CBAR", "CBEAM"}:
                return 5
            return None

        def regular_continuation(line: str) -> bool:
            if pending_fields is None:
                return False
            child_mode = _continuation_mode(line)
            if child_mode is None:
                return False
            marker = (
                line.split(",", 1)[0].strip()
                if child_mode == "free"
                else line[:8].strip()
            )
            if marker.startswith(("+", "*")):
                return True
            required = required_field_count(pending_card)
            return required is not None and len(pending_fields) < required

        for source_path, line_number, raw_line in source_lines:
            line = _strip_inline_comment(raw_line.rstrip("\r\n"))
            stripped_line = line.lstrip()
            is_comment_or_blank = (
                not line.strip()
                or stripped_line.startswith("$")
                or stripped_line.startswith("#")
                or stripped_line.startswith("//")
            )
            if is_comment_or_blank:
                # Comments and blank lines are ignored by the solver and may
                # occur between continuation rows.  A later non-continuation
                # row still flushes the pending logical card, while source
                # path changes below prevent INCLUDE records crossing files.
                # HyperMesh component metadata also lives in comment rows, so
                # scan the raw line (inline-comment stripping would erase it).
                block_marker = self._parse_component_metadata(
                    raw_line, components, elementprop_by_pid, current_component_id
                )
                if block_marker is not None:
                    current_component_id = block_marker
                continue

            if (
                (pending_source_path is not None and source_path != pending_source_path)
                or (large_source_path is not None and source_path != large_source_path)
            ):
                # INCLUDE expansion preserves physical line provenance.  A
                # continuation cannot cross into an included file implicitly.
                flush_large()
                flush_pending()

            head = line[:8].strip()
            if large_fields is not None and head.startswith("*"):
                large_fields.extend(_large_field_values(line))
                continue
            if large_fields is not None:
                flush_large()

            if regular_continuation(line):
                assert pending_fields is not None
                child_mode = _continuation_mode(line)
                assert child_mode is not None
                pending_fields.extend(_continuation_values(line, mode=child_mode))
                continue
            if pending_fields is not None:
                flush_pending()

            # A legal continuation marker without a parent card is malformed
            # input.  Include expansion keeps the physical source path and
            # line number, so report both instead of silently discarding the
            # row or counting it as an unsupported card name.
            if _continuation_mode(line) is not None:
                raise ModelParseError(
                    f"orphan continuation row at {source_path} line {line_number}"
                )

            if len(head) > 1 and head.endswith("*") and "," not in line[:16]:
                large_fields = [head.rstrip("*"), *_large_field_values(line)]
                large_line_number = line_number
                large_source_path = source_path
                continue

            card = _card_name(line)
            fields = _read_card_fields(line, card)
            mode = "free" if "," in line[:16] else "fixed" if _standard_fixed_row(line) else "whitespace"
            if mode == "free" and card in self._continuable_connectivity_cards:
                fields = _strip_free_parent_continuation(fields)
            if mode == "fixed" and len(fields) >= 10:
                # Field 10 (columns 73-80) is the small-field continuation
                # identifier, never an element/property value.
                fields.pop(9)
            if mode == "fixed":
                while len(fields) > 1 and not fields[-1].strip():
                    fields.pop()
            pending_fields = list(fields)
            pending_card = card
            pending_mode = mode
            pending_line_number = line_number
            pending_source_path = source_path

        flush_large()
        flush_pending()

        if not nodes:
            raise ModelParseError(f"FEM source contains no GRID cards: {self.fem_path}")
        if not elements:
            raise ModelParseError(f"FEM source contains no supported elements: {self.fem_path}")
        missing_node_ids = sorted(
            {node_id for element in elements.values() for node_id in element.node_ids if node_id not in nodes}
        )
        if missing_node_ids:
            raise ModelParseError(
                f"FEM source references missing GRID IDs {missing_node_ids[:10]}"
                + (" ..." if len(missing_node_ids) > 10 else "")
            )

        metadata: dict[str, Any] = {
            "provider": self.provider_name,
            "supported_cards": sorted(self._supported_cards),
            "ignored_cards": ignored_cards,
            "unsupported_cards": ignored_cards,
            "include_root": include_root.as_posix(),
            "included_files": included_files,
            "include_status": "resolved" if included_files else "none",
        }
        metadata.update(
            self._finalize_component_association(
                components,
                element_comp_block,
                elementprop_by_pid,
                elements,
            )
        )
        return CanonicalFEModel(
            nodes=nodes,
            elements=elements,
            properties=properties,
            materials=materials,
            components=components,
            sets=sets,
            subcases=subcases,
            source="fem",
            source_path=self.fem_path,
            capabilities=self.capabilities,
            metadata=metadata,
        )

    @classmethod
    def _extract_include(cls, raw_line: str) -> str | None:
        """Return the path from a one-line OptiStruct/Nastran INCLUDE card.

        The supported forms intentionally remain narrow and deterministic:
        ``INCLUDE 'relative/file.fem'``, ``INCLUDE "relative/file.fem"`` and
        an unquoted single token.  A malformed INCLUDE is an actionable parse
        error rather than an ignored card.
        """

        stripped = raw_line.strip()
        if not stripped or stripped.startswith("$"):
            return None
        match = re.match(r"(?i)^INCLUDE(?:\s+|,)(.*)$", stripped)
        if not match:
            return None
        rest = match.group(1).strip()
        if not rest:
            raise ModelParseError("INCLUDE card has no file path")
        if rest[0] in {"'", '"'}:
            quote = rest[0]
            end = rest.find(quote, 1)
            if end < 0:
                raise ModelParseError("INCLUDE card has an unterminated quoted path")
            value = rest[1:end]
        else:
            # Free-field cards occasionally use a comma after the path;
            # anything after the first token is not part of the path.
            value = re.split(r"[\s,]", rest, maxsplit=1)[0]
        if not value or "\x00" in value or any(ord(char) < 0x20 for char in value):
            raise ModelParseError("INCLUDE card has an invalid file path")
        return value

    def _read_with_includes(
        self,
        main_path: Path,
        include_root: Path,
    ) -> tuple[list[tuple[Path, int, str]], list[str]]:
        lines: list[tuple[Path, int, str]] = []
        included_files: list[str] = []
        total_bytes = 0
        for path in include_root.rglob("*"):
            if path.is_file():
                try:
                    total_bytes += path.stat().st_size
                except OSError:
                    pass
        read_bytes = 0

        def visit(path: Path, stack: tuple[Path, ...], depth: int) -> None:
            nonlocal read_bytes
            if depth > self.max_include_depth:
                raise ModelParseError(
                    f"FEM INCLUDE depth exceeds {self.max_include_depth}: {path}"
                )
            resolved = path.resolve(strict=False)
            try:
                resolved.relative_to(include_root)
            except ValueError as exc:
                raise ModelParseError(
                    f"FEM INCLUDE path escapes input root: {resolved} (root {include_root})"
                ) from exc
            if resolved in stack:
                chain = " -> ".join(item.as_posix() for item in (*stack, resolved))
                raise ModelParseError(f"FEM INCLUDE cycle detected: {chain}")
            try:
                text = resolved.read_text(encoding="utf-8", errors="replace")
            except FileNotFoundError as exc:
                raise ModelParseError(f"FEM INCLUDE source is missing: {resolved}") from exc
            except OSError as exc:
                raise ModelProviderError(f"cannot read FEM source {resolved}: {exc}") from exc
            next_stack = (*stack, resolved)
            for line_number, raw_line in enumerate(text.splitlines(), start=1):
                include_value = self._extract_include(raw_line)
                if include_value is None:
                    lines.append((resolved, line_number, raw_line))
                    continue
                if len(included_files) >= self.max_include_files:
                    raise ModelParseError(
                        f"FEM INCLUDE count exceeds {self.max_include_files}"
                    )
                include_path = self._resolve_include_path(include_value, resolved, include_root)
                relative = include_path.relative_to(include_root).as_posix()
                included_files.append(relative)
                visit(include_path, next_stack, depth + 1)
            try:
                done_bytes = resolved.stat().st_size
            except OSError:
                done_bytes = len(text.encode("utf-8"))
            read_bytes += done_bytes
            if self.on_progress is not None and total_bytes:
                self.on_progress(
                    done=min(read_bytes, total_bytes),
                    total=total_bytes,
                    message=f"正在读取 FEM 输入 {path.name}",
                )

        visit(main_path, (), 0)
        return lines, included_files

    @staticmethod
    def _resolve_include_path(value: str, including_path: Path, include_root: Path) -> Path:
        # Normalize Windows separators for portable project decks while still
        # rejecting drive-qualified and rooted paths before resolution.
        normalized = value.replace("\\", "/")
        windows = PureWindowsPath(normalized)
        posix = PurePosixPath(normalized)
        if windows.is_absolute() or windows.drive or posix.is_absolute() or normalized.startswith("/"):
            raise ModelParseError(f"absolute FEM INCLUDE path is not allowed: {value!r}")
        candidate = (including_path.parent / Path(*posix.parts)).resolve(strict=False)
        try:
            candidate.relative_to(include_root)
        except ValueError as exc:
            raise ModelParseError(
                f"FEM INCLUDE path escapes input root: {value!r} from {including_path.name}"
            ) from exc
        if not candidate.is_file():
            raise ModelParseError(f"FEM INCLUDE source is missing: {value!r} (resolved {candidate})")
        return candidate

    @staticmethod
    def _parse_grid(fields: Sequence[str], line_number: int, nodes: dict[int, Node]) -> None:
        # Standard small-field GRID: card, ID, CP, X, Y, Z, CD, ...
        # Whitespace/free-field fallback: card, ID, CP, X, Y, Z, ...
        node_id = _as_int(_field(fields, 1, card="GRID", line_number=line_number), field_name="GRID ID")
        try:
            x_field = _field(fields, 3, card="GRID", line_number=line_number)
            y_field = _field(fields, 4, card="GRID", line_number=line_number)
            z_field = _field(fields, 5, card="GRID", line_number=line_number)
        except ModelParseError:
            # A compact free-field fixture may omit CP (GRID,ID,X,Y,Z).
            x_field = _field(fields, 2, card="GRID", line_number=line_number)
            y_field = _field(fields, 3, card="GRID", line_number=line_number)
            z_field = _field(fields, 4, card="GRID", line_number=line_number)
        if node_id in nodes:
            raise ModelParseError(f"duplicate GRID ID {node_id} at line {line_number}")
        nodes[node_id] = Node(
            node_id,
            (
                _parse_float(x_field, field_name="GRID X"),
                _parse_float(y_field, field_name="GRID Y"),
                _parse_float(z_field, field_name="GRID Z"),
            ),
        )

    @staticmethod
    def _parse_shell(
        card: str,
        fields: Sequence[str],
        line_number: int,
        elements: dict[int, Element],
        node_count: int,
    ) -> None:
        element_id = _as_int(_field(fields, 1, card=card, line_number=line_number), field_name=f"{card} EID")
        property_id = _as_int(_field(fields, 2, card=card, line_number=line_number), field_name=f"{card} PID")
        node_ids = tuple(
            _as_int(_field(fields, index, card=card, line_number=line_number), field_name=f"{card} GRID")
            for index in range(3, 3 + node_count)
        )
        FemModelProvider._add_element(
            elements,
            Element(element_id, card, node_ids, property_id),
            line_number,
        )

    @staticmethod
    def _parse_solid(
        card: str,
        fields: Sequence[str],
        line_number: int,
        elements: dict[int, Element],
    ) -> None:
        minimum_nodes = FemModelProvider._solid_node_counts[card]
        maximum_nodes = FemModelProvider._solid_max_node_counts.get(card, minimum_nodes)
        element_id = _as_int(_field(fields, 1, card=card, line_number=line_number), field_name=f"{card} EID")
        property_id = _as_int(_field(fields, 2, card=card, line_number=line_number), field_name=f"{card} PID")
        node_ids_list: list[int] = []
        for index in range(minimum_nodes):
            value = _field(fields, index + 3, card=card, line_number=line_number)
            if value.upper() in _SEMANTIC_SOLID_FIELDS:
                raise ModelParseError(
                    f"{card} line {line_number} has semantic field {value!r} before required corners"
                )
            node_id = _as_int(value, field_name=f"{card} GRID")
            if node_id <= 0:
                raise ModelParseError(
                    f"{card} line {line_number} has invalid required GRID ID {node_id}"
                )
            node_ids_list.append(node_id)

        # High-order G fields are optional on the base card.  Empty and zero
        # slots are absent (and may be followed by later optional nodes),
        # while CORDM/CID/THETA/PHI starts a semantic continuation rather than
        # connectivity.  Explicit suffixed aliases keep all nodes required.
        for value in fields[3 + minimum_nodes : 3 + maximum_nodes]:
            token = value.strip()
            upper = token.upper()
            if upper in _SEMANTIC_SOLID_FIELDS:
                break
            if not token or token == "0":
                continue
            try:
                node_id = _as_int(token, field_name=f"{card} GRID")
            except ModelParseError as exc:
                # Continuation labels are removed while tokenizing their
                # physical rows.  Anything left in the optional G range is
                # therefore malformed connectivity, not a harmless label.
                raise ModelParseError(
                    f"{card} line {line_number} has invalid optional GRID field {token!r}"
                ) from exc
            if node_id < 0:
                raise ModelParseError(
                    f"{card} line {line_number} has invalid optional GRID ID {node_id}"
                )
            if node_id > 0:
                node_ids_list.append(node_id)
        node_ids = tuple(node_ids_list)
        FemModelProvider._add_element(
            elements,
            Element(element_id, card, node_ids, property_id),
            line_number,
        )

    @staticmethod
    def _parse_bar(
        card: str,
        fields: Sequence[str],
        line_number: int,
        elements: dict[int, Element],
    ) -> None:
        element_id = _as_int(_field(fields, 1, card=card, line_number=line_number), field_name=f"{card} EID")
        if card == "CONROD":
            # CONROD has no property card: EID, G1, G2.
            property_id = 0
            node_ids = (
                _as_int(_field(fields, 2, card=card, line_number=line_number), field_name=f"{card} G1"),
                _as_int(_field(fields, 3, card=card, line_number=line_number), field_name=f"{card} G2"),
            )
        else:
            property_id = _as_int(_field(fields, 2, card=card, line_number=line_number), field_name=f"{card} PID")
            node_ids = (
                _as_int(_field(fields, 3, card=card, line_number=line_number), field_name=f"{card} GA"),
                _as_int(_field(fields, 4, card=card, line_number=line_number), field_name=f"{card} GB"),
            )
        FemModelProvider._add_element(
            elements,
            Element(element_id, card, node_ids, property_id),
            line_number,
        )

    @staticmethod
    def _parse_property(
        card: str,
        fields: Sequence[str],
        line_number: int,
        properties: dict[int, Property],
    ) -> None:
        property_id = _as_int(_field(fields, 1, card=card, line_number=line_number), field_name=f"{card} PID")
        material_indexes = (2,) if card == "PSOLID" else (2, 4, 6, 11)
        material_ids: list[int] = []
        for index in material_indexes:
            if index >= len(fields) or not fields[index].strip():
                continue
            try:
                material_id = _as_int(fields[index], field_name=f"{card} MID")
            except ModelParseError:
                # A property field may legitimately contain a non-material
                # option; retain it in raw fields instead of guessing.
                continue
            if material_id > 0 and material_id not in material_ids:
                material_ids.append(material_id)
        names = ("PID", "MID1", "T", "MID2", "MID3", "MID4")
        parsed_fields: dict[str, Any] = {
            names[index - 1]: fields[index]
            for index in range(1, min(len(fields), len(names) + 1))
            if fields[index].strip()
        }
        record = Property(property_id, card, tuple(material_ids), parsed_fields, tuple(fields[1:]))
        if property_id in properties:
            raise ModelParseError(f"duplicate {card} PID {property_id} at line {line_number}")
        properties[property_id] = record

    @staticmethod
    def _parse_mat1(fields: Sequence[str], line_number: int, materials: dict[int, Material]) -> None:
        material_id = _as_int(_field(fields, 1, card="MAT1", line_number=line_number), field_name="MAT1 MID")
        names = ("MID", "E", "G", "NU", "RHO", "A", "TREF", "GE", "ST", "SC", "SS", "MCSID")
        parsed_fields: dict[str, Any] = {
            names[index - 1]: fields[index]
            for index in range(1, min(len(fields), len(names) + 1))
            if fields[index].strip()
        }
        record = Material(material_id, "MAT1", parsed_fields, tuple(fields[1:]))
        if material_id in materials:
            raise ModelParseError(f"duplicate MAT1 MID {material_id} at line {line_number}")
        materials[material_id] = record

    @staticmethod
    def _parse_set1(fields: Sequence[str], line_number: int, sets: dict[int, SetDefinition]) -> None:
        set_id = _as_int(_field(fields, 1, card="SET1", line_number=line_number), field_name="SET1 SID")
        entity_ids: list[int] = []
        index = 2
        while index < len(fields):
            value = fields[index].strip()
            index += 1
            if not value:
                continue
            if value.upper() == "THRU" and entity_ids and index < len(fields):
                end = _as_int(fields[index], field_name="SET1 THRU end")
                index += 1
                start = entity_ids[-1]
                step = 1 if end >= start else -1
                entity_ids.extend(range(start + step, end + step, step))
                continue
            try:
                entity_ids.append(_as_int(value, field_name="SET1 entity ID"))
            except ModelParseError:
                # Keep unknown tokens losslessly in fields; the supported ID
                # subset remains valid for downstream mapping.
                continue
        if set_id in sets:
            raise ModelParseError(f"duplicate SET1 SID {set_id} at line {line_number}")
        sets[set_id] = SetDefinition(
            set_id,
            entity_type="unknown",
            entity_ids=tuple(dict.fromkeys(entity_ids)),
            fields={"card": "SET1", "raw_fields": tuple(fields[1:])},
        )

    @staticmethod
    def _parse_subcase(
        fields: Sequence[str],
        line_number: int,
        subcases: dict[int, Subcase],
    ) -> int:
        subcase_id = _as_int(
            _field(fields, 1, card="SUBCASE", line_number=line_number),
            field_name="SUBCASE ID",
        )
        if subcase_id in subcases:
            raise ModelParseError(f"duplicate SUBCASE ID {subcase_id} at line {line_number}")
        label = None
        if len(fields) > 2 and fields[2].strip():
            label = fields[2].strip()
        subcases[subcase_id] = Subcase(
            subcase_id,
            label=label,
            references={},
            fields={"raw_fields": tuple(fields[1:])},
        )
        return subcase_id

    @staticmethod
    def _parse_subcase_reference(
        card: str,
        fields: Sequence[str],
        line_number: int,
        subcase: Subcase,
    ) -> None:
        if len(fields) < 2 or not fields[1].strip():
            raise ModelParseError(f"{card} line {line_number} has no reference value")
        value: Any = fields[1].strip()
        try:
            value = _as_int(value, field_name=f"{card} reference")
        except ModelParseError:
            value = str(value)
        subcase.references[card] = value
        if card == "ANALYSIS":
            object.__setattr__(subcase, "analysis", str(value))

    @staticmethod
    def _add_element(elements: dict[int, Element], element: Element, line_number: int) -> None:
        if element.element_id in elements:
            previous = elements[element.element_id]
            raise ModelParseError(
                f"duplicate Element ID {element.element_id} ({previous.element_type}/{element.element_type})"
                f" at line {line_number}"
            )
        elements[element.element_id] = element

    @classmethod
    def _parse_component_metadata(
        cls,
        raw_line: str,
        components: dict[int, Component],
        elementprop_by_pid: dict[int, int],
        current_component_id: int | None,
    ) -> int | None:
        """Parse one HyperMesh metadata comment row.

        Handles ``$HMNAME COMP`` (name), ``$HWCOLOR COMP`` (color index),
        ``$HMCOMP ID`` (block marker) and ``$ELEMENTPROP`` (pid -> comp).
        Returns the new current component ID for a block marker, else None.
        Components are frozen records, so updates replace the dict entry.
        """

        line = raw_line.strip()
        if not line:
            return None
        block = _HMCOMP_ID_RE.match(line)
        if block:
            return _as_int(block.group(1), field_name="HMCOMP ID")
        name_match = _HMNAME_COMP_RE.match(line)
        if name_match:
            comp_id = _as_int(name_match.group(1), field_name="HMNAME COMP ID")
            name = name_match.group(2).strip() or None
            existing = components.get(comp_id)
            if existing is None:
                components[comp_id] = Component(comp_id, name)
            elif name and not existing.name:
                components[comp_id] = Component(
                    comp_id, name, existing.element_ids, existing.property_id, existing.fields
                )
            return None
        color_match = _HWCOLOR_COMP_RE.match(line)
        if color_match:
            comp_id = _as_int(color_match.group(1), field_name="HWCOLOR COMP ID")
            color = _as_int(color_match.group(2), field_name="HWCOLOR value")
            existing = components.get(comp_id)
            fields = {"hw_color": color}
            if existing is None:
                components[comp_id] = Component(comp_id, None, fields=fields)
            else:
                components[comp_id] = Component(
                    comp_id,
                    existing.name,
                    existing.element_ids,
                    existing.property_id,
                    {**existing.fields, **fields},
                )
            return None
        prop_match = _ELEMENTPROP_RE.match(line)
        if prop_match:
            pid = _as_int(prop_match.group(1), field_name="ELEMENTPROP PID")
            comp_id = _as_int(prop_match.group(2), field_name="ELEMENTPROP COMP ID")
            elementprop_by_pid[pid] = comp_id
            if comp_id not in components:
                components[comp_id] = Component(comp_id, None)
        return None

    @staticmethod
    def _finalize_component_association(
        components: dict[int, Component],
        element_comp_block: dict[int, int],
        elementprop_by_pid: dict[int, int],
        elements: dict[int, Element],
    ) -> dict[str, Any]:
        """Resolve element->component membership and record it in metadata.

        Block markers are authoritative; ``$ELEMENTPROP`` pid links back-fill
        any elements left unassigned.  When nothing links elements to a
        component the mapping stays empty so callers can fall back to
        property-based coloring.
        """

        element_component_ids: dict[int, int] = {}
        element_component_ids.update(element_comp_block)
        for element_id, element in elements.items():
            if element_id in element_component_ids:
                continue
            pid = element.property_id
            if pid is not None and pid in elementprop_by_pid:
                element_component_ids[element_id] = elementprop_by_pid[pid]
        if not element_component_ids:
            return {"element_component_ids": {}, "component_element_ids": {}}
        component_element_ids: dict[int, list[int]] = {}
        for element_id, comp_id in element_component_ids.items():
            component_element_ids.setdefault(comp_id, []).append(element_id)
        for comp_id in components:
            component_element_ids.setdefault(comp_id, [])
        return {
            "element_component_ids": element_component_ids,
            "component_element_ids": component_element_ids,
        }


__all__ = [
    "FEModelProvider",
    "FemModelProvider",
    "ModelParseError",
    "ModelProviderError",
]
