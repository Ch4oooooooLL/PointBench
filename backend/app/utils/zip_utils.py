from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def normalize_zip_name(name: str) -> str:
    return name.replace("\\", "/")


def is_safe_zip_path(name: str) -> bool:
    normalized = normalize_zip_name(name)
    if not normalized or normalized.startswith("/"):
        return False
    posix = PurePosixPath(normalized)
    if posix.is_absolute():
        return False
    return ".." not in posix.parts


def validate_zip_members(zip_file: ZipFile) -> list[str]:
    errors: list[str] = []
    for member in zip_file.namelist():
        if not is_safe_zip_path(member):
            errors.append(f"zip 内部路径不安全: {member}")
    return errors


def safe_extract(zip_file: ZipFile, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    root = target_dir.resolve()
    for member in zip_file.infolist():
        if member.is_dir():
            continue
        if not is_safe_zip_path(member.filename):
            raise ValueError(f"zip 内部路径不安全: {member.filename}")
        target = (root / normalize_zip_name(member.filename)).resolve()
        if root not in target.parents and target != root:
            raise ValueError(f"zip 解压路径越界: {member.filename}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with zip_file.open(member) as source, target.open("wb") as output:
            output.write(source.read())
