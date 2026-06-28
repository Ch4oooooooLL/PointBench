"""add_testrun_unique_cycle_per_project

Revision ID: fd634fc3e31d
Revises: 6fafdd0918ef
Create Date: 2026-06-28 15:48:12.516895

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd634fc3e31d'
down_revision: Union[str, Sequence[str], None] = '6fafdd0918ef'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('test_runs') as batch_op:
        batch_op.create_unique_constraint('uq_project_cycle', ['project_db_id', 'cycle_count'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('test_runs') as batch_op:
        batch_op.drop_constraint('uq_project_cycle', type_='unique')
