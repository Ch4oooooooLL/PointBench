"""清理 storage/temp 过期临时文件。

用法:
    python scripts/cleanup_storage.py --older-than 24h
    python scripts/cleanup_storage.py --older-than 7d --dry-run
"""
import argparse
import shutil
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
STORAGE_DIR = BACKEND_DIR / "storage"
TEMP_DIRS = [
    STORAGE_DIR / "temp" / "imports",
    STORAGE_DIR / "temp" / "exports",
    STORAGE_DIR / "temp" / "uploads",
    STORAGE_DIR / "temp" / "xlsx",
    STORAGE_DIR / "temp",
]


def parse_duration(value: str) -> float:
    """解析时长字符串，如 24h, 7d, 30m。"""
    value = value.strip().lower()
    multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    for unit, multiplier in multipliers.items():
        if value.endswith(unit):
            try:
                return float(value[:-1]) * multiplier
            except ValueError:
                pass
    try:
        return float(value)
    except ValueError:
        pass
    raise argparse.ArgumentTypeError(f"无法解析时长: {value}。支持的格式: 24h, 7d, 30m, 3600")


def main() -> None:
    parser = argparse.ArgumentParser(description="清理 PointProcess 临时文件")
    parser.add_argument(
        "--older-than",
        type=parse_duration,
        default="24h",
        help="清理超过指定时长的文件（默认: 24h）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅列出将要删除的文件，不实际删除",
    )
    args = parser.parse_args()

    threshold_seconds: float = args.older_than
    now = time.time()
    cutoff = now - threshold_seconds

    removed_count = 0
    removed_size = 0

    for temp_dir in TEMP_DIRS:
        if not temp_dir.exists():
            continue
        for path in temp_dir.rglob("*"):
            if not path.is_file():
                continue
            try:
                stat = path.stat()
                if stat.st_mtime < cutoff:
                    size = stat.st_size
                    if args.dry_run:
                        age = timedelta(seconds=now - stat.st_mtime)
                        print(f"  [DRY-RUN] {path} ({size} bytes, age: {age})")
                    else:
                        path.unlink()
                        print(f"  已删除: {path} ({size} bytes)")
                    removed_count += 1
                    removed_size += size
            except OSError as exc:
                print(f"  跳过: {path} ({exc})", file=sys.stderr)

    # 清理空目录
    if not args.dry_run:
        for temp_dir in TEMP_DIRS:
            if not temp_dir.exists():
                continue
            for dirpath in sorted(temp_dir.rglob("*"), reverse=True):
                if dirpath.is_dir() and not any(dirpath.iterdir()):
                    try:
                        dirpath.rmdir()
                    except OSError:
                        pass

    action = "将删除" if args.dry_run else "已删除"
    threshold_display = timedelta(seconds=threshold_seconds)
    print(
        f"\n清理完成: {action} {removed_count} 个文件 "
        f"({removed_size / 1024 / 1024:.2f} MB)，"
        f"清理条件: 超过 {threshold_display}"
    )


if __name__ == "__main__":
    main()
