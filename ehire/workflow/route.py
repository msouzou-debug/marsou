"""Route computation (contract 02, section 2)."""

CATEGORIES = ("medical", "nursing", "allied", "admin", "other")
STATUSES = ("draft", "in_progress", "returned", "approved", "rejected", "withdrawn")
CLOSED_STATUSES = ("approved", "rejected", "withdrawn")
STEPS = (1, 2, 3, 4, 5, 6)
STEP3_PHASES = ("inputs", "decision")
ROLES = ("requester", "dir_accountant", "sci_director", "dir_hr_officer", "dir_exec",
         "fin_mgmt_head", "central_hr_officer", "medical_director", "nursing_director", "ceo")
ACTIONS = ("submit", "resubmit", "check", "opinion", "approve", "reject", "return", "withdraw")
TASK_STATUSES = ("open", "paused", "closed")
STOP_STATES = ("done", "current", "pending", "not_applicable", "stopped", "paused", "withdrawn")
PERSON_STATES = ("done", "waiting", "paused", "negative", "replaced")
REDIRECT_REASONS = ("out_of_office", "conflict_of_interest")

MATERIAL_FIELDS = ("category", "facility", "cost_centre", "position", "positions_count")
DEPARTURE_REASONS = ("retirement", "resignation", "secondment_end", "contract_end")

_SCI_CATEGORIES = ("medical", "nursing", "allied")
_FINANCIAL_CATEGORIES = ("medical", "allied")


def compute_route(category, directorate_has_sci_director):
    if category not in CATEGORIES:
        raise ValueError("unknown category: {!r}".format(category))
    inputs = []
    if category in _SCI_CATEGORIES and directorate_has_sci_director:  # R1
        inputs.append("sci_director")
    inputs.append("dir_hr_officer")
    if category in ("medical", "allied"):  # R3
        step5 = {"step": 5, "roles": ["medical_director"], "applies": True}
    elif category == "nursing":
        step5 = {"step": 5, "roles": ["nursing_director"], "applies": True}
    else:
        step5 = {"step": 5, "roles": [], "applies": False}
    return {
        "financials_required": category in _FINANCIAL_CATEGORIES,  # R2
        "steps": [
            {"step": 1, "roles": ["requester"]},
            {"step": 2, "roles": ["dir_accountant"]},
            {"step": 3, "inputs": inputs, "decision": "dir_exec"},
            {"step": 4, "inputs": ["fin_mgmt_head", "central_hr_officer"]},
            step5,
            {"step": 6, "roles": ["ceo"]},
        ],
    }
