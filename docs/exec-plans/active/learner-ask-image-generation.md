# ExecPlan: Learner Ask Image Generation

## Purpose / Big Picture

让学生在学习端追问时，系统能够识别“适合用图片解释”的问题，异步生成或复用课程图库中的教学图片。学生先继续阅读文字回答；图片生成完成后收到提醒，并可一键跳回对应追问位置查看图片。生成后的图片进入课程图库，带有描述、来源和复用元数据，后续相似问题优先复用已有图片。

这个能力要保持现有学习体验的流畅性：追问文字回答仍然实时流式返回，图片生成作为异步增强挂在追问结果之后。图片不能阻塞追问，也不能把低质量学生触发图片直接无治理地污染老师课程素材。

## Progress

- [x] 2026-07-06 01:42 JST: Assessed feasibility against the existing ask flow, TokUI image generation service, resource model, Celery worker, and learner element identifiers.
- [x] 2026-07-06 01:45 JST: Created this ExecPlan to capture the product boundary, rollout path, data model, and implementation stages.
- [x] 2026-07-06 02:30 JST: Added the first backend MVP slice: feature flags, `course_image_assets`, `learn_ask_image_refs`, ask completion trigger, Celery task, reuse-before-generate lookup, and learner polling API.
- [x] 2026-07-06 02:45 JST: Added the first learner UI slice: answer-level image ref polling, pending/ready/failed rendering, ready toast, i18n strings, and API declaration.
- [x] 2026-07-06 03:05 JST: Ran available verification: Python compile checks for touched backend files, `git diff --check`, `python3 scripts/check_repo_harness.py`, Docker-based env example generation, and a migration-head script confirming a single Alembic head.
- [x] 2026-07-06 08:00 JST: Completed focused backend and frontend verification after pytest/type-check environment fixes: `cd src/api && .venv/bin/python -m pytest -s tests/service/learn/test_ask_image_generation.py -q` passed with 5 tests; Docker builder verification for `src/cook-web/Dockerfile` completed `npm run type-check` and `npm run build`; `python3 scripts/check_architecture_boundaries.py` passed with no new violations after moving TokUI/risk/shifu cross-service calls behind stable `api.py` entry points.
- [ ] 2026-07-06 02:45 JST: Implement teacher-side gallery review controls for learner-generated assets.
- [ ] 2026-07-06 02:45 JST: Replace the MVP heuristic recommendation with a stronger model-backed classifier, add rate limits, and add observability counters.
- [ ] 2026-07-06 02:45 JST: Run full backend/frontend verification in an environment with WSL-local Node tooling and the full backend suite.

## Surprises & Discoveries

- Student follow-up questions already have stable anchors through `anchor_element_bid`, ask/answer sidecar elements, and generated block IDs. This makes “jump back to the image's follow-up position” practical without inventing a new navigation identity.
- Existing image generation is teacher-side TokUI material generation: `generate_tokui_image_media_ref()` calls an OpenAI-compatible `/images/generations` endpoint, uploads the image, and records a `resource` row. It can be reused as a low-level primitive, but the learner ask feature needs its own task and governance layer.
- The current local Docker config has Qwen/Token Plan text model keys but no `TOKUI_IMAGE_API_BASE_URL` or `TOKUI_IMAGE_API_KEY`. The feature must degrade cleanly when image generation is not configured.
- `docs/exec-plans/index.md` is generated. Do not edit it by hand after adding this plan; regenerate repository knowledge indexes instead.
- `handle_input_ask()` knows the generated answer block bid, while the learner frontend displays answer element bids from the listen-element sidecar. The learner ask-image polling API maps answer element bids back to generated block bids so the SSE protocol does not need a new event shape.
- The first recommendation implementation is a conservative keyword/concrete-object heuristic. It is intentionally replaceable and should become a model-backed classifier before broad rollout.

## Decision Log

- Keep text follow-up generation synchronous and streaming. Image generation must be asynchronous and non-blocking.
- Treat this as a learner ask enhancement, not a general rewrite of MarkdownFlow runtime.
- Use course-level image assets as the reusable unit, not per-student transient files.
- Generated learner-triggered images enter the course gallery with source metadata and a moderation status. MVP should default to “visible to the requesting learner, pending teacher review for broad reuse” unless product explicitly chooses automatic reuse.
- Reuse should happen before generation. The backend should search the course gallery for a matching approved or reusable image and only enqueue generation when no acceptable match exists.
- Use feature flags/config to control rollout, model/provider configuration, per-course enablement, rate limits, and whether pending learner-generated images are eligible for reuse.
- Keep the first implementation disabled by default via `LEARNER_ASK_IMAGE_ENABLED=false`.
- Store learner-triggered generated assets as `pending_review` after provider success. They are visible to the requesting learner through the ask ref, but not broadly reused unless explicitly approved or `LEARNER_ASK_IMAGE_AUTO_REUSE_PENDING` is enabled.

## Outcomes & Retrospective

The first MVP slice is implemented but not production-complete. It provides a disabled-by-default backend/frontend path where visual-worthy follow-up questions create a durable image ref, reuse eligible approved course images, enqueue generation through Celery when needed, and let the learner UI poll and render pending/ready/failed image cards under the answer.

Focused verification now passes for the learner ask image service and frontend production builder path. Direct WSL-local `npm run type-check` is still not the reliable check in this environment because local WSL Node is missing, so frontend verification used the Docker builder path that installs dependencies, runs `npm run type-check`, and then runs `npm run build`.

Remaining before full product completion: teacher-side gallery moderation UI, stronger recommendation/classification, rate limits, observability, and full automated verification in an environment with pytest and WSL-local Node tooling.

Retrospective notes should be filled after implementation, especially around generation quality, cost, moderation burden, reuse precision, and whether asynchronous notifications feel timely enough.

## Context and Orientation

Relevant backend surfaces:

- Learner run route: `src/api/flaskr/service/learn/routes.py`
- Ask handling: `src/api/flaskr/service/learn/handle_input_ask.py`
- Runtime orchestration: `src/api/flaskr/service/learn/runscript_v2.py`
- Element persistence and ask sidecars: `src/api/flaskr/service/learn/listen_elements.py`, `src/api/flaskr/service/learn/listen_element_run_sidecar.py`
- Learn models: `src/api/flaskr/service/learn/models.py`
- Existing image generation primitive: `src/api/flaskr/service/tokui/image_generation.py`
- Resource model: `src/api/flaskr/service/resource/models.py`
- Celery app and task patterns: `src/api/flaskr/common/celery_app.py`, `src/api/flaskr/service/billing/tasks.py`, `src/api/flaskr/service/tts/tasks.py`

Relevant frontend surfaces:

- Learner route: `src/cook-web/src/app/c/[[...id]]/page.tsx`
- Chat runtime hook: `src/cook-web/src/app/c/[[...id]]/Components/ChatUi/useChatLogicHook.tsx`
- Ask UI: `src/cook-web/src/app/c/[[...id]]/Components/ChatUi/AskBlock.tsx`
- Read/listen mode element projection: `src/cook-web/src/app/c/[[...id]]/Components/ChatUi/readModeItems.ts`, `src/cook-web/src/app/c/[[...id]]/Components/ChatUi/chatUiModeProjection.ts`
- Frontend API map: `src/cook-web/src/api/api.ts`
- User-facing strings: `src/i18n/`

Existing behavior to preserve:

- The ask answer stream returns text first through `GeneratedType.CONTENT`.
- Ask answers currently constrain output to plain text or standard Markdown and do not call the image provider.
- Teacher-side TokUI image generation stores images as resources, but it is not wired into learner ask.

## Plan of Work

1. Add feature configuration and durable data models for course image assets and ask-image job state.
2. Add a post-answer image recommendation step that decides whether a visual explanation is warranted.
3. Search the course gallery for reusable matching images before generation.
4. Enqueue a Celery task to generate and store a new image only when no reusable asset is found.
5. Expose learner APIs to poll image job state and retrieve image attachments for a specific ask answer.
6. Update the learner frontend to show non-blocking image generation status, completion notifications, and jump-to-follow-up behavior.
7. Add teacher-side gallery visibility for learner-generated images, including source, description, status, hide/delete/review actions, and reuse controls.
8. Add tests, observability, rate limits, and rollout safeguards.

## Concrete Steps

1. Add backend configuration keys:
   - `LEARNER_ASK_IMAGE_ENABLED`
   - `LEARNER_ASK_IMAGE_REUSE_ENABLED`
   - `LEARNER_ASK_IMAGE_AUTO_REUSE_PENDING`
   - `LEARNER_ASK_IMAGE_MAX_PER_USER_PER_DAY`
   - `LEARNER_ASK_IMAGE_MAX_PER_COURSE_PER_DAY`
   - `LEARNER_ASK_IMAGE_MATCH_THRESHOLD`
   - `TOKUI_IMAGE_API_BASE_URL`, `TOKUI_IMAGE_API_KEY`, `TOKUI_IMAGE_MODEL`, and existing image config remain the provider boundary.
2. Add durable course image asset table, for example `course_image_assets`, with:
   - `asset_bid`
   - `shifu_bid`
   - `resource_id`
   - `description`
   - `normalized_prompt`
   - `concept_key`
   - optional `embedding_vector` or `embedding_ref`
   - `source` values such as `teacher`, `learner_ask`
   - `status` values such as `generating`, `ready`, `failed`, `hidden`, `pending_review`, `approved`
   - `origin_user_bid`
   - `origin_progress_record_bid`
   - `origin_answer_element_bid`
   - `created_by`, `updated_by`, `created_at`, `updated_at`
3. Add ask-to-image association table, for example `learn_ask_image_refs`, with:
   - `ref_bid`
   - `shifu_bid`
   - `outline_item_bid`
   - `progress_record_bid`
   - `user_bid`
   - `anchor_element_bid`
   - `ask_element_bid`
   - `answer_element_bid`
   - `asset_bid`
   - `status`
   - `created_at`, `updated_at`
4. Add an image recommendation service:
   - input: course ID, outline ID, ask text, answer text, anchor content, learner context
   - output: `should_generate`, `description`, `normalized_prompt`, `concept_key`, `reason`, `confidence`
   - must reject abstract, sensitive, personal, unsafe, or low-value prompts
   - should prefer “teaching diagram” style over photorealistic default when the course context is explanatory
5. Add course gallery lookup:
   - first exact or normalized prompt match
   - then concept key or embedding similarity
   - only reuse `approved` assets by default; allow `ready` learner assets only if feature config explicitly permits it
6. Add Celery task, for example `learn.generate_ask_image`, that:
   - locks or dedupes by course plus concept key
   - calls the existing image generation primitive or a learner-specific wrapper
   - when wiring local/test image provider config, reference `/home/xm/workwork/test_krill_image_generation(1).py` for the source values of `DEFAULT_API_BASE_URL` and `DEFAULT_API_KEY`, and map them into `TOKUI_IMAGE_API_BASE_URL` and `TOKUI_IMAGE_API_KEY` through environment/config rather than committing the literal secret values
   - stores the result as a `resource`
   - creates or updates `course_image_assets`
   - updates `learn_ask_image_refs`
   - records failure details without breaking the text ask flow
7. Wire the task after ask completion:
   - run after `answer_block.generated_content` is known
   - do not delay the final `BREAK` event for text answer
   - if an existing asset is found, attach it immediately
   - if generation is needed, return/persist a pending ref for the frontend to poll
8. Add learner APIs:
   - list image refs for a progress record or answer element
   - get single image job state
   - optional acknowledge notification endpoint
9. Add frontend behavior:
   - show “image being prepared” state near the ask thread only when the backend created a pending image ref
   - poll while pending, with sane backoff and stop conditions
   - show toast/banner when ready
   - clicking the notification scrolls to the ask anchor or answer element and expands the ask panel
   - render the image card with title/description and reuse status
10. Add teacher gallery behavior:
   - list course images from both teacher and learner sources
   - show source ask and description
   - allow approve, hide, delete, edit description, and regenerate if supported
   - make approved learner images equivalent to teacher-side reusable resources
11. Add observability and limits:
   - image recommendation accepted/rejected counts
   - reuse hit rate
   - generation success/failure counts
   - queue latency and provider latency
   - per-user/course daily limits
   - provider-not-configured counts
12. Add tests:
   - recommendation service unit tests
   - gallery reuse and dedupe tests
   - Celery task success/failure tests
   - ask flow regression proving text stream is not blocked
   - frontend polling, notification, jump, and image rendering tests
   - teacher gallery status/action tests

## Validation and Acceptance

- A student can ask a normal text question and receive the same streaming text behavior as before.
- For a visual-worthy question, the text answer completes before the image is ready.
- The system creates a pending image ref tied to the ask answer and exposes it to the frontend.
- The frontend shows a non-blocking pending state and later a completion reminder.
- Clicking the reminder jumps to the correct ask/answer location and expands the relevant ask panel if needed.
- Generated images are stored as `resource` rows and represented as course image assets with description and source metadata.
- A later similar question in the same course reuses an eligible existing asset instead of generating a duplicate.
- If image provider config is missing, disabled, rate-limited, or fails, the text answer still succeeds and the UI shows no disruptive failure.
- Teacher-side gallery can identify learner-generated images and approve or hide them.
- User-facing strings are in `src/i18n/`.
- Minimum docs-only validation: `python scripts/check_repo_harness.py`.
- Implementation validation must include focused backend tests, task tests, frontend tests, and architecture boundary checks if shared contracts change.

## Idempotence and Recovery

- The feature must be safe to retry. A task retry should not create duplicate resources when an equivalent `course_image_assets` row already exists for the same course and concept key.
- Store pending and failed states durably so frontend polling can recover after refresh.
- Use stable dedupe keys such as `ask-image:{shifu_bid}:{concept_key}` or a stronger key that includes normalized prompt and provider model.
- If image generation succeeds but DB update fails, a cleanup or reconciliation path should be able to attach the orphaned resource or mark the task failed with enough detail.
- If DB update succeeds but frontend misses the notification, reloading the lesson should show the ready image in the ask thread.
- If a teacher hides or deletes an asset, future reuse must skip it.
- If an asset is pending review, reuse behavior must follow explicit config rather than accidental default.

## Interfaces and Dependencies

- Existing image provider dependency:
  - `TOKUI_IMAGE_API_BASE_URL`
  - `TOKUI_IMAGE_API_KEY`
  - `TOKUI_IMAGE_MODEL`
  - `TOKUI_IMAGE_TIMEOUT_SECONDS`
  - `TOKUI_IMAGE_SIZE`
- Existing storage/resource dependency:
  - `src/api/flaskr/service/tokui/image_generation.py`
  - `src/api/flaskr/service/resource/models.py`
  - `src/api/flaskr/service/common/storage.py`
- Existing async dependency:
  - Redis-backed Celery worker from `docker/docker-compose.latest.yml`
  - `src/api/flaskr/common/celery_app.py`
- Existing learner identifiers:
  - `progress_record_bid`
  - `generated_block_bid`
  - `element_bid`
  - `anchor_element_bid`
  - `ask_element_bid`
  - `answer_element_bid`
- New or changed backend interfaces should live under the learn/resource/shifu service boundaries rather than adding ad-hoc route logic in frontend components.
- New frontend API methods should be added to `src/cook-web/src/api/api.ts` and called through existing request helpers.
