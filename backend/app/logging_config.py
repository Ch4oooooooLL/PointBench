import logging
import os
import sys


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

    for logger_name in ("app", "uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(logger_name).setLevel(level)
