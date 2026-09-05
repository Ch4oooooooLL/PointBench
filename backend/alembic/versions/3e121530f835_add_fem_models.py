"""add_fem_models

Revision ID: 3e121530f835
Revises: 1f01be8b477c
Create Date: 2026-09-05 13:45:34.119791

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3e121530f835'
down_revision: Union[str, Sequence[str], None] = '1f01be8b477c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'fem_models',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'project_db_id',
            sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('main_filename', sa.String(length=500), nullable=False),
        sa.Column('source_name', sa.String(length=500), nullable=False),
        sa.Column('node_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('element_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('triangle_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='ready'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('artifact_version', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('project_db_id', name='uq_fem_models_project'),
    )
    op.create_index('ix_fem_models_project_db_id', 'fem_models', ['project_db_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_fem_models_project_db_id', table_name='fem_models')
    op.drop_table('fem_models')
