from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from typing import Any

from flask import Flask

from flaskr.dao import db
from flaskr.service.common.models import raise_param_error
from flaskr.service.config import get_config
from flaskr.service.learn.models import (
    CourseImageAsset,
    LearnAskImageRef,
    LearnGeneratedElement,
)
from flaskr.service.resource.models import Resource
from flaskr.service.tokui.api import generate_tokui_image_media_ref
from flaskr.util.datetime import now_utc


ASSET_SOURCE_LEARNER_ASK = "learner_ask"
ASSET_SOURCE_TEACHER = "teacher"

ASSET_STATUS_APPROVED = "approved"
ASSET_STATUS_FAILED = "failed"
ASSET_STATUS_GENERATING = "generating"
ASSET_STATUS_HIDDEN = "hidden"
ASSET_STATUS_PENDING_REVIEW = "pending_review"
ASSET_STATUS_READY = "ready"

REF_STATUS_FAILED = "failed"
REF_STATUS_GENERATING = "generating"
REF_STATUS_PENDING = "pending"
REF_STATUS_READY = "ready"
REF_STATUS_REUSED = "reused"
REF_STATUS_SKIPPED = "skipped"

_VISUAL_KEYWORDS = {
    "图",
    "图片",
    "画",
    "示意图",
    "图示",
    "结构",
    "形状",
    "外观",
    "长什么样",
    "样子",
    "可视化",
    "visual",
    "image",
    "picture",
    "diagram",
    "shape",
    "structure",
    "look like",
    "looks like",
}

_CONCRETE_HINTS = {
    "物体",
    "装置",
    "结构",
    "器官",
    "细胞",
    "分子",
    "电路",
    "地图",
    "几何",
    "植物",
    "动物",
    "机器",
    "工具",
    "object",
    "device",
    "organ",
    "cell",
    "molecule",
    "circuit",
    "map",
    "geometry",
    "plant",
    "machine",
    "tool",
}

_NEGATIVE_HINTS = {
    "为什么",
    "意义",
    "观点",
    "感受",
    "评价",
    "哲学",
    "why",
    "meaning",
    "opinion",
    "feeling",
    "philosophy",
}


@dataclass(frozen=True)
class AskImageRecommendation:
    should_generate: bool
    description: str = ""
    normalized_prompt: str = ""
    concept_key: str = ""
    reason: str = ""
    confidence: float = 0.0


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _truncate(value: str, limit: int) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").strip())
    return normalized[:limit]


def _normalize_prompt(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def _hash_prompt(value: str) -> str:
    return hashlib.sha256(_normalize_prompt(value).encode("utf-8")).hexdigest()


def _concept_key(value: str) -> str:
    normalized = _normalize_prompt(value)
    tokens = re.findall(r"[\w\u4e00-\u9fff]+", normalized)
    if not tokens:
        return _hash_prompt(normalized)[:32]
    joined = "-".join(tokens[:12])
    if len(joined) > 120:
        return _hash_prompt(normalized)[:32]
    return joined[:120]


def _contains_any(text: str, needles: set[str]) -> bool:
    normalized = text.lower()
    return any(needle.lower() in normalized for needle in needles)


def is_learner_ask_image_enabled() -> bool:
    return _coerce_bool(get_config("LEARNER_ASK_IMAGE_ENABLED", False))


def recommend_ask_image(
    *,
    ask_text: str,
    answer_text: str,
    anchor_content: str = "",
) -> AskImageRecommendation:
    combined = f"{ask_text}\n{answer_text}\n{anchor_content}"
    normalized_question = _truncate(ask_text, 240)
    has_visual_request = _contains_any(combined, _VISUAL_KEYWORDS)
    has_concrete_hint = _contains_any(combined, _CONCRETE_HINTS)
    has_negative_hint = _contains_any(ask_text, _NEGATIVE_HINTS)

    if not normalized_question:
        return AskImageRecommendation(False, reason="empty_question")

    if has_negative_hint and not has_visual_request:
        return AskImageRecommendation(False, reason="abstract_question")

    if not has_visual_request and not has_concrete_hint:
        return AskImageRecommendation(False, reason="no_visual_signal")

    description = normalized_question
    prompt = (
        "Create a clear educational diagram or illustration that helps explain: "
        f"{description}. Keep it accurate, uncluttered, and suitable for a course."
    )
    concept = _concept_key(description)
    confidence = 0.8 if has_visual_request else 0.62
    return AskImageRecommendation(
        should_generate=True,
        description=description,
        normalized_prompt=prompt,
        concept_key=concept,
        reason="visual_question",
        confidence=confidence,
    )


def _serialize_asset(asset: CourseImageAsset | None) -> dict[str, Any] | None:
    if asset is None:
        return None
    resource = None
    if asset.resource_id:
        resource = Resource.query.filter(
            Resource.resource_id == asset.resource_id,
            Resource.is_deleted == 0,
        ).first()
    return {
        "asset_bid": asset.asset_bid,
        "resource_id": asset.resource_id,
        "url": resource.url if resource else "",
        "title": resource.name if resource else "",
        "description": asset.description,
        "source": asset.source,
        "status": asset.status,
    }


def serialize_ask_image_ref(ref: LearnAskImageRef) -> dict[str, Any]:
    asset = None
    if ref.asset_bid:
        asset = CourseImageAsset.query.filter(
            CourseImageAsset.asset_bid == ref.asset_bid,
            CourseImageAsset.deleted == 0,
        ).first()
    return {
        "ref_bid": ref.ref_bid,
        "shifu_bid": ref.shifu_bid,
        "outline_item_bid": ref.outline_item_bid,
        "progress_record_bid": ref.progress_record_bid,
        "anchor_element_bid": ref.anchor_element_bid,
        "ask_element_bid": ref.ask_element_bid,
        "answer_element_bid": ref.answer_element_bid,
        "asset_bid": ref.asset_bid,
        "status": ref.status,
        "description": ref.description,
        "concept_key": ref.concept_key,
        "error_message": ref.error_message,
        "created_at": ref.created_at.isoformat() if ref.created_at else "",
        "updated_at": ref.updated_at.isoformat() if ref.updated_at else "",
        "asset": _serialize_asset(asset),
    }


def _eligible_asset_statuses() -> list[str]:
    statuses = [ASSET_STATUS_APPROVED]
    if _coerce_bool(get_config("LEARNER_ASK_IMAGE_AUTO_REUSE_PENDING", False)):
        statuses.extend([ASSET_STATUS_READY, ASSET_STATUS_PENDING_REVIEW])
    return statuses


def find_reusable_course_image(
    *,
    shifu_bid: str,
    normalized_prompt: str,
    concept_key: str,
) -> CourseImageAsset | None:
    if not _coerce_bool(get_config("LEARNER_ASK_IMAGE_REUSE_ENABLED", True)):
        return None

    prompt_hash = _hash_prompt(normalized_prompt)
    eligible_statuses = _eligible_asset_statuses()
    exact = (
        CourseImageAsset.query.filter(
            CourseImageAsset.shifu_bid == shifu_bid,
            CourseImageAsset.normalized_prompt_hash == prompt_hash,
            CourseImageAsset.deleted == 0,
            CourseImageAsset.status.in_(eligible_statuses),
        )
        .order_by(CourseImageAsset.id.desc())
        .first()
    )
    if exact:
        return exact

    if not concept_key:
        return None
    return (
        CourseImageAsset.query.filter(
            CourseImageAsset.shifu_bid == shifu_bid,
            CourseImageAsset.concept_key == concept_key,
            CourseImageAsset.deleted == 0,
            CourseImageAsset.status.in_(eligible_statuses),
        )
        .order_by(CourseImageAsset.id.desc())
        .first()
    )


def create_or_reuse_ask_image_ref(
    app: Flask,
    *,
    shifu_bid: str,
    outline_item_bid: str,
    progress_record_bid: str,
    user_bid: str,
    anchor_element_bid: str,
    ask_element_bid: str,
    answer_element_bid: str,
    ask_text: str,
    answer_text: str,
    anchor_content: str = "",
) -> LearnAskImageRef | None:
    if not is_learner_ask_image_enabled():
        return None
    if not answer_element_bid:
        app.logger.info("learner ask image skipped: missing answer_element_bid")
        return None

    existing = LearnAskImageRef.query.filter(
        LearnAskImageRef.answer_element_bid == answer_element_bid,
        LearnAskImageRef.user_bid == user_bid,
        LearnAskImageRef.deleted == 0,
    ).first()
    if existing:
        return existing

    recommendation = recommend_ask_image(
        ask_text=ask_text,
        answer_text=answer_text,
        anchor_content=anchor_content,
    )
    if not recommendation.should_generate:
        return None

    reusable_asset = find_reusable_course_image(
        shifu_bid=shifu_bid,
        normalized_prompt=recommendation.normalized_prompt,
        concept_key=recommendation.concept_key,
    )
    ref = LearnAskImageRef(
        ref_bid=uuid.uuid4().hex,
        shifu_bid=shifu_bid,
        outline_item_bid=outline_item_bid,
        progress_record_bid=progress_record_bid,
        user_bid=user_bid,
        anchor_element_bid=anchor_element_bid,
        ask_element_bid=ask_element_bid,
        answer_element_bid=answer_element_bid,
        asset_bid=reusable_asset.asset_bid if reusable_asset else "",
        status=REF_STATUS_REUSED if reusable_asset else REF_STATUS_GENERATING,
        description=recommendation.description,
        normalized_prompt=recommendation.normalized_prompt,
        concept_key=recommendation.concept_key,
    )
    db.session.add(ref)
    db.session.flush()

    if reusable_asset:
        return ref

    db.session.commit()
    try:
        from flaskr.service.learn.tasks import generate_ask_image_task

        generate_ask_image_task.delay(ref_bid=ref.ref_bid)
    except Exception:
        app.logger.warning("failed to enqueue learner ask image task", exc_info=True)
        ref.status = REF_STATUS_FAILED
        ref.error_message = "enqueue_failed"
    db.session.commit()
    return ref


def get_ask_image_refs_for_answer(
    *,
    shifu_bid: str,
    answer_element_bid: str,
    user_bid: str,
) -> list[dict[str, Any]]:
    if not answer_element_bid:
        raise_param_error("answer_element_bid")
    answer_lookup_bids = {answer_element_bid}
    element_row = LearnGeneratedElement.query.filter(
        LearnGeneratedElement.element_bid == answer_element_bid,
        LearnGeneratedElement.user_bid == user_bid,
        LearnGeneratedElement.deleted == 0,
    ).first()
    if element_row is not None and element_row.generated_block_bid:
        answer_lookup_bids.add(element_row.generated_block_bid)
    refs = (
        LearnAskImageRef.query.filter(
            LearnAskImageRef.shifu_bid == shifu_bid,
            LearnAskImageRef.answer_element_bid.in_(answer_lookup_bids),
            LearnAskImageRef.user_bid == user_bid,
            LearnAskImageRef.deleted == 0,
        )
        .order_by(LearnAskImageRef.id.asc())
        .all()
    )
    return [serialize_ask_image_ref(ref) for ref in refs]


def run_generate_ask_image(app: Flask, *, ref_bid: str) -> dict[str, Any]:
    ref = LearnAskImageRef.query.filter(
        LearnAskImageRef.ref_bid == ref_bid,
        LearnAskImageRef.deleted == 0,
    ).first()
    if ref is None:
        return {"status": "missing", "ref_bid": ref_bid}

    if ref.asset_bid and ref.status in {REF_STATUS_READY, REF_STATUS_REUSED}:
        return {"status": ref.status, "ref_bid": ref.ref_bid, "asset_bid": ref.asset_bid}

    reusable_asset = find_reusable_course_image(
        shifu_bid=ref.shifu_bid,
        normalized_prompt=ref.normalized_prompt,
        concept_key=ref.concept_key,
    )
    if reusable_asset:
        ref.asset_bid = reusable_asset.asset_bid
        ref.status = REF_STATUS_REUSED
        ref.error_message = ""
        db.session.commit()
        return {
            "status": REF_STATUS_REUSED,
            "ref_bid": ref.ref_bid,
            "asset_bid": reusable_asset.asset_bid,
        }

    asset = CourseImageAsset(
        asset_bid=uuid.uuid4().hex,
        shifu_bid=ref.shifu_bid,
        resource_id="",
        description=ref.description,
        normalized_prompt=ref.normalized_prompt,
        normalized_prompt_hash=_hash_prompt(ref.normalized_prompt),
        concept_key=ref.concept_key,
        source=ASSET_SOURCE_LEARNER_ASK,
        status=ASSET_STATUS_GENERATING,
        origin_user_bid=ref.user_bid,
        origin_progress_record_bid=ref.progress_record_bid,
        origin_answer_element_bid=ref.answer_element_bid,
        created_by=ref.user_bid,
        updated_by=ref.user_bid,
    )
    db.session.add(asset)
    ref.asset_bid = asset.asset_bid
    ref.status = REF_STATUS_GENERATING
    ref.updated_at = now_utc()
    db.session.flush()

    try:
        result = generate_tokui_image_media_ref(
            app,
            user_bid=ref.user_bid,
            prompt=ref.normalized_prompt,
            outline_bid=ref.outline_item_bid,
            title=ref.description,
        )
        media_ref = result.get("media_ref") if isinstance(result, dict) else {}
        resource_id = str((media_ref or {}).get("resource_id") or "")
        asset.resource_id = resource_id
        asset.status = ASSET_STATUS_PENDING_REVIEW
        asset.error_message = ""
        asset.updated_by = ref.user_bid
        ref.status = REF_STATUS_READY
        ref.error_message = ""
        db.session.commit()
        return {
            "status": REF_STATUS_READY,
            "ref_bid": ref.ref_bid,
            "asset_bid": asset.asset_bid,
            "resource_id": resource_id,
        }
    except Exception as exc:
        app.logger.warning(
            "learner ask image generation failed ref_bid=%s",
            ref.ref_bid,
            exc_info=True,
        )
        message = _truncate(str(exc) or exc.__class__.__name__, 500)
        asset.status = ASSET_STATUS_FAILED
        asset.error_message = message
        ref.status = REF_STATUS_FAILED
        ref.error_message = message
        db.session.commit()
        return {"status": REF_STATUS_FAILED, "ref_bid": ref.ref_bid}
