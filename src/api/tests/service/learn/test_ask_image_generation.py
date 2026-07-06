from __future__ import annotations


def _prompt_hash(prompt: str) -> str:
    import hashlib

    normalized = " ".join(prompt.strip().lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def test_recommend_ask_image_accepts_visual_question():
    from flaskr.service.learn.ask_image_generation import recommend_ask_image

    recommendation = recommend_ask_image(
        ask_text="这个细胞结构长什么样？能画个图吗",
        answer_text="细胞膜包裹细胞质和细胞核。",
    )

    assert recommendation.should_generate is True
    assert recommendation.description
    assert recommendation.normalized_prompt
    assert recommendation.concept_key


def test_recommend_ask_image_rejects_abstract_question():
    from flaskr.service.learn.ask_image_generation import recommend_ask_image

    recommendation = recommend_ask_image(
        ask_text="为什么这个观点有意义？",
        answer_text="它帮助我们理解历史背景。",
    )

    assert recommendation.should_generate is False
    assert recommendation.reason == "abstract_question"


def test_find_reusable_course_image_uses_approved_exact_match(app):
    with app.app_context():
        from flaskr.dao import db
        from flaskr.service.learn.ask_image_generation import (
            ASSET_STATUS_APPROVED,
            find_reusable_course_image,
        )
        from flaskr.service.learn.models import CourseImageAsset

        prompt = "Create a clear educational diagram of a cell."
        asset = CourseImageAsset(
            asset_bid="asset-1",
            shifu_bid="shifu-1",
            resource_id="resource-1",
            description="cell",
            normalized_prompt=prompt,
            normalized_prompt_hash=_prompt_hash(prompt),
            concept_key="cell",
            source="teacher",
            status=ASSET_STATUS_APPROVED,
            created_by="teacher-1",
            updated_by="teacher-1",
        )
        db.session.add(asset)
        db.session.commit()

        matched = find_reusable_course_image(
            shifu_bid="shifu-1",
            normalized_prompt=prompt,
            concept_key="cell",
        )

        assert matched is not None
        assert matched.asset_bid == "asset-1"


def test_create_or_reuse_ask_image_ref_enqueues_when_no_reusable_asset(app, monkeypatch):
    with app.app_context():
        from flaskr.dao import db
        from flaskr.service.learn import ask_image_generation as module
        from flaskr.service.learn.models import LearnAskImageRef

        def _fake_get_config(key, default=None):
            if key == "LEARNER_ASK_IMAGE_ENABLED":
                return True
            return default

        monkeypatch.setattr(module, "get_config", _fake_get_config)

        enqueued = {}

        class _Task:
            @staticmethod
            def delay(*, ref_bid):
                enqueued["ref_bid"] = ref_bid

        monkeypatch.setattr(
            "flaskr.service.learn.tasks.generate_ask_image_task",
            _Task(),
        )

        ref = module.create_or_reuse_ask_image_ref(
            app,
            shifu_bid="shifu-1",
            outline_item_bid="outline-1",
            progress_record_bid="progress-1",
            user_bid="user-1",
            anchor_element_bid="anchor-1",
            ask_element_bid="ask-1",
            answer_element_bid="answer-1",
            ask_text="这个电路结构能画个示意图吗",
            answer_text="它由电源、电阻和开关组成。",
        )

        assert ref is not None
        assert ref.status == module.REF_STATUS_GENERATING
        assert enqueued["ref_bid"] == ref.ref_bid
        persisted = LearnAskImageRef.query.filter_by(ref_bid=ref.ref_bid).first()
        assert persisted is not None
        assert persisted.answer_element_bid == "answer-1"
        db.session.delete(persisted)
        db.session.commit()


def test_run_generate_ask_image_marks_ready(app, monkeypatch):
    with app.app_context():
        from flaskr.dao import db
        from flaskr.service.learn import ask_image_generation as module
        from flaskr.service.learn.models import LearnAskImageRef
        from flaskr.service.resource.models import Resource

        resource = Resource(
            resource_id="resource-ask-image",
            name="diagram.png",
            type=0,
            oss_bucket="bucket",
            oss_name="diagram.png",
            url="https://example.test/diagram.png",
            status=0,
            is_deleted=0,
            created_by="user-1",
            updated_by="user-1",
        )
        ref = LearnAskImageRef(
            ref_bid="ref-ready",
            shifu_bid="shifu-generate-1",
            outline_item_bid="outline-1",
            progress_record_bid="progress-1",
            user_bid="user-1",
            anchor_element_bid="anchor-1",
            ask_element_bid="ask-1",
            answer_element_bid="answer-1",
            status=module.REF_STATUS_PENDING,
            description="battery circuit diagram",
            normalized_prompt="Create a clear educational diagram of a battery circuit.",
            concept_key="battery-circuit",
        )
        db.session.add(resource)
        db.session.add(ref)
        db.session.commit()

        monkeypatch.setattr(
            module,
            "generate_tokui_image_media_ref",
            lambda *_args, **_kwargs: {
                "media_ref": {"resource_id": "resource-ask-image"}
            },
        )

        result = module.run_generate_ask_image(app, ref_bid="ref-ready")

        assert result["status"] == module.REF_STATUS_READY
        db.session.refresh(ref)
        assert ref.status == module.REF_STATUS_READY
        assert ref.asset_bid
