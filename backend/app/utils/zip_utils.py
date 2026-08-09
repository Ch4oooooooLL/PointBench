from pathlib import Path, PurePosixPath
from zipfile import ZipFile


# ── zip 炸弹防护参数 ────────────────────────────────────────────────────────
# 单文件解压后大小上限（默认 200MB）
MAX_FILE_SIZE = 200 * 1024 * 1024
# 累计解压总大小上限（默认 500MB）
MAX_TOTAL_SIZE = 500 * 1024 * 1024
# 解压文件成员数量上限（默认 2000，目录项不计入）
MAX_MEMBER_COUNT = 2000
# 压缩比上限：解压后大小 / 压缩后大小 超过该值视为高压缩可疑（zip 炸弹特征）
MAX_COMPRESSION_RATIO = 100
# 仅对解压后大小不低于该阈值的成员检查压缩比，避免小文件压缩比天然波动造成误报
MIN_RATIO_CHECK_FILE_SIZE = 1024 * 1024


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
    # zip 炸弹预检：全部基于 zip 中央目录声明的元数据（file_size/compress_size），
    # 不把文件内容读入内存，超限直接抛异常使导入失败
    file_members = [member for member in zip_file.infolist() if not member.is_dir()]
    if len(file_members) > MAX_MEMBER_COUNT:
        raise ValueError(
            f"zip 包含过多文件成员（{len(file_members)} 个），超过上限 {MAX_MEMBER_COUNT}"
        )
    total_size = 0
    for member in file_members:
        # 单文件解压后大小上限
        if member.file_size > MAX_FILE_SIZE:
            raise ValueError(
                f"zip 成员解压后过大: {member.filename} "
                f"({member.file_size} 字节 > {MAX_FILE_SIZE})"
            )
        # 累计解压总大小上限
        total_size += member.file_size
        if total_size > MAX_TOTAL_SIZE:
            raise ValueError(
                f"zip 解压累计总大小过大（{total_size} 字节 > {MAX_TOTAL_SIZE}）"
            )
        # 压缩比上限：解压后大小远大于压缩后大小视为高压缩可疑（zip 炸弹特征）
        if (
            member.file_size >= MIN_RATIO_CHECK_FILE_SIZE
            and member.compress_size > 0
            and member.file_size / member.compress_size > MAX_COMPRESSION_RATIO
        ):
            raise ValueError(
                f"zip 成员压缩比异常: {member.filename} "
                f"（解压后 {member.file_size} 字节 / 压缩后 {member.compress_size} 字节）"
            )
        # zip-slip 防护（保持原有逻辑不变）
        if not is_safe_zip_path(member.filename):
            raise ValueError(f"zip 内部路径不安全: {member.filename}")
        target = (root / normalize_zip_name(member.filename)).resolve()
        if root not in target.parents and target != root:
            raise ValueError(f"zip 解压路径越界: {member.filename}")
        target.parent.mkdir(parents=True, exist_ok=True)
        with zip_file.open(member) as source, target.open("wb") as output:
            output.write(source.read())
