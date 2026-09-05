"""add_point_element_bindings

Revision ID: 9f3a1c2d5e47
Revises: 3e121530f835
Create Date: 2026-09-05 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9f3a1c2d5e47'
down_revision: Union[str, Sequence[str], None] = '3e121530f835'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'point_element_bindings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'project_db_id',
            sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'point_db_id',
            sa.Integer(),
            sa.ForeignKey('test_points.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('element_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('project_db_id', 'point_db_id', name='uq_point_element_binding'),
    )
    op.create_index(
        'ix_point_element_bindings_project_db_id', 'point_element_bindings', ['project_db_id']
    )
    op.create_index(
        'ix_point_element_bindings_point_db_id', 'point_element_bindings', ['point_db_id']
    )
    op.create_index('ix_point_element_bindings_element_id', 'point_element_bindings', ['element_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_point_element_bindings_element_id', table_name='point_element_bindings')
    op.drop_index('ix_point_element_bindings_point_db_id', table_name='point_element_bindings')
    op.drop_index('ix_point_element_bindings_project_db_id', table_name='point_element_bindings')
    op.drop_table('point_element_bindings')
