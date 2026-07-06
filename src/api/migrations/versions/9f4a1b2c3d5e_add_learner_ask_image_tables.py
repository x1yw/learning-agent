"""add learner ask image tables

Revision ID: 9f4a1b2c3d5e
Revises: a9c2d4e6f8b1
Create Date: 2026-07-06 02:30:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "9f4a1b2c3d5e"
down_revision = "a9c2d4e6f8b1"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _drop_table_if_exists(table_name: str) -> None:
    if _table_exists(table_name):
        op.drop_table(table_name)


def upgrade():
    if not _table_exists("course_image_assets"):
        op.create_table(
            "course_image_assets",
            sa.Column("id", mysql.BIGINT(), autoincrement=True, nullable=False),
            sa.Column("asset_bid", sa.String(length=36), nullable=False, server_default="", comment="Course image asset business identifier"),
            sa.Column("shifu_bid", sa.String(length=36), nullable=False, server_default="", comment="Shifu business identifier"),
            sa.Column("resource_id", sa.String(length=36), nullable=False, server_default="", comment="Resource business identifier"),
            sa.Column("description", sa.Text(), nullable=False, comment="Image description for teachers and learners"),
            sa.Column("normalized_prompt", sa.Text(), nullable=False, comment="Normalized generation prompt"),
            sa.Column("normalized_prompt_hash", sa.String(length=64), nullable=False, server_default="", comment="SHA256 hash of normalized prompt"),
            sa.Column("concept_key", sa.String(length=128), nullable=False, server_default="", comment="Reusable concept key"),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="teacher", comment="Asset source: teacher or learner_ask"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending_review", comment="Asset status: generating/ready/failed/hidden/pending_review/approved"),
            sa.Column("origin_user_bid", sa.String(length=36), nullable=False, server_default="", comment="Origin learner user business identifier"),
            sa.Column("origin_progress_record_bid", sa.String(length=36), nullable=False, server_default="", comment="Origin progress record business identifier"),
            sa.Column("origin_answer_element_bid", sa.String(length=64), nullable=False, server_default="", comment="Origin answer element business identifier"),
            sa.Column("error_message", sa.Text(), nullable=False, comment="Last generation error summary"),
            sa.Column("deleted", sa.SmallInteger(), nullable=False, server_default=sa.text("0"), comment="Deletion flag: 0=active, 1=deleted"),
            sa.Column("created_by", sa.String(length=36), nullable=False, server_default="", comment="Creator user business identifier"),
            sa.Column("updated_by", sa.String(length=36), nullable=False, server_default="", comment="Updater user business identifier"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now(), comment="Creation time"),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now(), comment="Update time"),
            sa.PrimaryKeyConstraint("id"),
            comment="Course reusable image assets",
        )
        op.create_index("ix_course_image_assets_asset_bid", "course_image_assets", ["asset_bid"], unique=False)
        op.create_index("ix_course_image_assets_shifu_bid", "course_image_assets", ["shifu_bid"], unique=False)
        op.create_index("ix_course_image_assets_resource_id", "course_image_assets", ["resource_id"], unique=False)
        op.create_index("ix_course_image_assets_normalized_prompt_hash", "course_image_assets", ["normalized_prompt_hash"], unique=False)
        op.create_index("ix_course_image_assets_concept_key", "course_image_assets", ["concept_key"], unique=False)
        op.create_index("ix_course_image_assets_source", "course_image_assets", ["source"], unique=False)
        op.create_index("ix_course_image_assets_status", "course_image_assets", ["status"], unique=False)
        op.create_index("ix_course_image_assets_origin_user_bid", "course_image_assets", ["origin_user_bid"], unique=False)
        op.create_index("ix_course_image_assets_origin_progress_record_bid", "course_image_assets", ["origin_progress_record_bid"], unique=False)
        op.create_index("ix_course_image_assets_origin_answer_element_bid", "course_image_assets", ["origin_answer_element_bid"], unique=False)
        op.create_index("ix_course_image_assets_deleted", "course_image_assets", ["deleted"], unique=False)
        op.create_index("idx_course_image_asset_concept", "course_image_assets", ["shifu_bid", "concept_key", "deleted", "status"], unique=False)
        op.create_index("idx_course_image_asset_prompt", "course_image_assets", ["shifu_bid", "normalized_prompt_hash", "deleted", "status"], unique=False)

    if not _table_exists("learn_ask_image_refs"):
        op.create_table(
            "learn_ask_image_refs",
            sa.Column("id", mysql.BIGINT(), autoincrement=True, nullable=False),
            sa.Column("ref_bid", sa.String(length=36), nullable=False, server_default="", comment="Ask image reference business identifier"),
            sa.Column("shifu_bid", sa.String(length=36), nullable=False, server_default="", comment="Shifu business identifier"),
            sa.Column("outline_item_bid", sa.String(length=36), nullable=False, server_default="", comment="Outline item business identifier"),
            sa.Column("progress_record_bid", sa.String(length=36), nullable=False, server_default="", comment="Learn progress record business identifier"),
            sa.Column("user_bid", sa.String(length=36), nullable=False, server_default="", comment="User business identifier"),
            sa.Column("anchor_element_bid", sa.String(length=64), nullable=False, server_default="", comment="Ask anchor element business identifier"),
            sa.Column("ask_element_bid", sa.String(length=64), nullable=False, server_default="", comment="Ask element business identifier"),
            sa.Column("answer_element_bid", sa.String(length=64), nullable=False, server_default="", comment="Answer element business identifier"),
            sa.Column("asset_bid", sa.String(length=36), nullable=False, server_default="", comment="Course image asset business identifier"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending", comment="Reference status: pending/reused/generating/ready/failed/skipped"),
            sa.Column("description", sa.Text(), nullable=False, comment="Learner-facing image description"),
            sa.Column("normalized_prompt", sa.Text(), nullable=False, comment="Normalized generation prompt"),
            sa.Column("concept_key", sa.String(length=128), nullable=False, server_default="", comment="Reusable concept key"),
            sa.Column("error_message", sa.Text(), nullable=False, comment="Last generation error summary"),
            sa.Column("deleted", sa.SmallInteger(), nullable=False, server_default=sa.text("0"), comment="Deletion flag: 0=active, 1=deleted"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now(), comment="Creation time"),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now(), comment="Update time"),
            sa.PrimaryKeyConstraint("id"),
            comment="Learner ask image references",
        )
        op.create_index("ix_learn_ask_image_refs_ref_bid", "learn_ask_image_refs", ["ref_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_shifu_bid", "learn_ask_image_refs", ["shifu_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_outline_item_bid", "learn_ask_image_refs", ["outline_item_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_progress_record_bid", "learn_ask_image_refs", ["progress_record_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_user_bid", "learn_ask_image_refs", ["user_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_anchor_element_bid", "learn_ask_image_refs", ["anchor_element_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_ask_element_bid", "learn_ask_image_refs", ["ask_element_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_answer_element_bid", "learn_ask_image_refs", ["answer_element_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_asset_bid", "learn_ask_image_refs", ["asset_bid"], unique=False)
        op.create_index("ix_learn_ask_image_refs_status", "learn_ask_image_refs", ["status"], unique=False)
        op.create_index("ix_learn_ask_image_refs_concept_key", "learn_ask_image_refs", ["concept_key"], unique=False)
        op.create_index("ix_learn_ask_image_refs_deleted", "learn_ask_image_refs", ["deleted"], unique=False)
        op.create_index("idx_learn_ask_image_answer", "learn_ask_image_refs", ["answer_element_bid", "user_bid", "deleted"], unique=False)
        op.create_index("idx_learn_ask_image_progress", "learn_ask_image_refs", ["progress_record_bid", "user_bid", "deleted", "status"], unique=False)


def downgrade():
    _drop_table_if_exists("learn_ask_image_refs")
    _drop_table_if_exists("course_image_assets")
