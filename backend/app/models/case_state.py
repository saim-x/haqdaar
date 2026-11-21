"""Case state machine - docs/04 §3.3, implemented literally.

Two invariants are load-bearing for judging:

1. ``PROCESSING -> REJECTED`` is not in the table, so it raises
   ``409 INVALID_TRANSITION``. There is no ``AUTO_REJECT`` route action anywhere.
2. ``REJECTED`` is reachable only from ``IN_REVIEW`` / ``PENDING_SECOND_APPROVAL``
   and only by an ``OFFICER`` (enforced by ``assert_transition(..., actor_role=...)``).
"""

from __future__ import annotations

from app.models.enums import CaseStatus, UserRole
from app.security.errors import InvalidTransitionError

#: Allowed next statuses per docs/04 §3.3. ON_HOLD_CONSENT is special-cased below
#: because its only forward edge is "restore previous_status".
CASE_TRANSITIONS: dict[CaseStatus, frozenset[CaseStatus]] = {
    CaseStatus.DRAFT: frozenset({CaseStatus.SUBMITTED, CaseStatus.WITHDRAWN}),
    CaseStatus.SUBMITTED: frozenset({CaseStatus.PROCESSING, CaseStatus.ON_HOLD_CONSENT}),
    CaseStatus.PROCESSING: frozenset(
        {
            CaseStatus.APPROVED,
            CaseStatus.NEEDS_INFO,
            CaseStatus.HUMAN_REVIEW,
            CaseStatus.WAITING_EXTERNAL,
            CaseStatus.ON_HOLD_CONSENT,
        }
    ),
    CaseStatus.WAITING_EXTERNAL: frozenset(
        {CaseStatus.PROCESSING, CaseStatus.HUMAN_REVIEW, CaseStatus.ON_HOLD_CONSENT}
    ),
    CaseStatus.NEEDS_INFO: frozenset(
        {
            CaseStatus.SUBMITTED,
            CaseStatus.HUMAN_REVIEW,
            CaseStatus.ON_HOLD_CONSENT,
            CaseStatus.WITHDRAWN,
        }
    ),
    CaseStatus.HUMAN_REVIEW: frozenset({CaseStatus.IN_REVIEW, CaseStatus.ON_HOLD_CONSENT}),
    CaseStatus.IN_REVIEW: frozenset(
        {
            CaseStatus.APPROVED,
            CaseStatus.PENDING_SECOND_APPROVAL,
            CaseStatus.REJECTED,
            CaseStatus.NEEDS_INFO,
            CaseStatus.HUMAN_REVIEW,
            CaseStatus.ON_HOLD_CONSENT,
        }
    ),
    CaseStatus.PENDING_SECOND_APPROVAL: frozenset(
        {
            CaseStatus.APPROVED,
            CaseStatus.IN_REVIEW,
            CaseStatus.REJECTED,
            CaseStatus.ON_HOLD_CONSENT,
        }
    ),
    # Forward edge is dynamic: restore previous_status on re-grant, else WITHDRAWN.
    CaseStatus.ON_HOLD_CONSENT: frozenset({CaseStatus.WITHDRAWN}),
    CaseStatus.APPROVED: frozenset({CaseStatus.PAYMENT_INITIATED, CaseStatus.CLOSED}),
    CaseStatus.PAYMENT_INITIATED: frozenset({CaseStatus.PAID, CaseStatus.PAYMENT_FAILED}),
    CaseStatus.PAID: frozenset({CaseStatus.CLOSED}),
    CaseStatus.PAYMENT_FAILED: frozenset(
        {CaseStatus.PAYMENT_INITIATED, CaseStatus.HUMAN_REVIEW, CaseStatus.CLOSED}
    ),
    CaseStatus.REJECTED: frozenset({CaseStatus.CLOSED}),
    CaseStatus.WITHDRAWN: frozenset(),
    CaseStatus.CLOSED: frozenset(),
}

#: Statuses only an OFFICER may set. AI/agent/system paths can never reach these.
OFFICER_ONLY_TARGETS: frozenset[CaseStatus] = frozenset({CaseStatus.REJECTED})

#: Statuses that count as "open" for consent-withdrawal case holds (docs/09 §4.2).
CLOSED_STATUSES: frozenset[CaseStatus] = frozenset(
    {
        CaseStatus.DRAFT,
        CaseStatus.PAID,
        CaseStatus.REJECTED,
        CaseStatus.WITHDRAWN,
        CaseStatus.CLOSED,
    }
)

TERMINAL_STATUSES: frozenset[CaseStatus] = frozenset({CaseStatus.WITHDRAWN, CaseStatus.CLOSED})


def can_transition(
    current: CaseStatus | str,
    target: CaseStatus | str,
    *,
    previous_status: CaseStatus | str | None = None,
) -> bool:
    """True when ``current -> target`` is legal, including the consent-hold restore."""
    current = CaseStatus(current)
    target = CaseStatus(target)

    if current is CaseStatus.ON_HOLD_CONSENT:
        if target is CaseStatus.WITHDRAWN:
            return True
        # Restore path: only back to the status the case held before the hold.
        return previous_status is not None and target is CaseStatus(previous_status)

    return target in CASE_TRANSITIONS[current]


def assert_transition(
    current: CaseStatus | str,
    target: CaseStatus | str,
    *,
    previous_status: CaseStatus | str | None = None,
    actor_role: UserRole | str | None = None,
) -> None:
    """Raise ``409 INVALID_TRANSITION`` unless the move is allowed for this actor."""
    current_enum = CaseStatus(current)
    target_enum = CaseStatus(target)

    if not can_transition(current_enum, target_enum, previous_status=previous_status):
        raise InvalidTransitionError(
            details={"from": current_enum.value, "to": target_enum.value}
        )

    if target_enum in OFFICER_ONLY_TARGETS:
        role = UserRole(actor_role) if actor_role is not None else None
        if role is not UserRole.OFFICER:
            raise InvalidTransitionError(
                message_en="Only an officer can reject a case.",
                message_ur="صرف افسر درخواست مسترد کر سکتا ہے۔",
                details={
                    "from": current_enum.value,
                    "to": target_enum.value,
                    "reason": "OFFICER_ONLY",
                },
            )
