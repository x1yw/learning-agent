"""Task entrypoints for learner follow-up background jobs."""

from __future__ import annotations

import os
from typing import Any, Callable

try:  # pragma: no cover - exercised indirectly when Celery is installed.
    from celery import shared_task
except ImportError:  # pragma: no cover - local fallback for non-Celery test envs.

    def shared_task(*args, **kwargs):
        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            return func

        return decorator


def _create_task_app():
    os.environ.setdefault("SKIP_APP_AUTOCREATE", "1")
    from app import create_app

    return create_app()


@shared_task(name="learn.generate_ask_image")
def generate_ask_image_task(*, ref_bid: str) -> dict[str, Any]:
    from flaskr.service.learn.ask_image_generation import run_generate_ask_image

    app = _create_task_app()
    result = run_generate_ask_image(app, ref_bid=ref_bid)
    result["task_name"] = "learn.generate_ask_image"
    return result
