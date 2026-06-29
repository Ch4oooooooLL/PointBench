import logging
import os
import sys
from pathlib import Path


DEFAULT_LOG_FORMAT = "[%(asctime)s] %(levelname)s %(name)s: %(message)s"


def configure_logging() -> None:
    level_name = os.environ.get("POINTBENCH_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    has_pointbench_handler = any(getattr(handler, "_pointbench_handler", False) for handler in root_logger.handlers)
    if not has_pointbench_handler:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(DEFAULT_LOG_FORMAT))
        handler._pointbench_handler = True  # type: ignore[attr-defined]
        root_logger.addHandler(handler)

    error_log_path = os.environ.get("POINTBENCH_ERROR_LOG")
    if error_log_path:
        resolved_error_log_path = str(Path(error_log_path).resolve())
        has_error_file_handler = any(
            getattr(handler, "_pointbench_error_file", None) == resolved_error_log_path
            for handler in root_logger.handlers
        )
        if not has_error_file_handler:
            Path(resolved_error_log_path).parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(resolved_error_log_path, encoding="utf-8")
            file_handler.setLevel(logging.ERROR)
            file_handler.setFormatter(logging.Formatter(DEFAULT_LOG_FORMAT))
            file_handler._pointbench_error_file = resolved_error_log_path  # type: ignore[attr-defined]
            root_logger.addHandler(file_handler)

    for logger_name in ("app", "uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(logger_name).setLevel(level)
