"""Where the step 2 activity figures come from.

Today the Directorate Accountant types every line (ManualEntryProvider). In Phase 5 a provider backed by the
loaded HIO files can fill visits, procedures and revenue; the card then shows those three read-only and the
server takes the provider's snapshot instead of the posted values.
"""

PERIODS = ("prev_year", "ytd")
LINES = ("visits", "procedures", "revenue", "payroll_cost", "headcount")


class ActivityProvider:
    """Interface. A provider names the lines it fills and returns a snapshot for one period."""

    source = "manual"
    provided_lines = frozenset()  # lines shown read-only in the card

    def snapshot(self, facility_id, specialty_id, period):
        """{'visits': int, 'procedures': int, 'revenue': Decimal, 'data_month': date} or None."""
        return None

    def is_read_only(self, line):
        return line in self.provided_lines


class ManualEntryProvider(ActivityProvider):
    """All five lines and the data month are typed."""


def get_provider():
    return ManualEntryProvider()
