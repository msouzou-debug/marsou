"""Hands engine events to the notifier.

Phase 4 sends emails from here. Until then nothing is sent: each event is written to the audit log as
`notification_due`, in the caller's transaction, so what would be sent is visible and testable.
"""
from ehr.models import audit


def notify(events):
    """Record each event. The caller commits."""
    for event in events or ():
        audit("notification_due", user_id=None, request_id=event.request_id, object_type="notification",
              object_id=event.recipient_user_id,
              detail={"kind": event.kind, "recipient_user_id": event.recipient_user_id, "data": dict(event.data or {})})
