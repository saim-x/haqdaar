"""Haqdaar pure decision engine.

``LLM proposes, policy disposes.`` This package is 100 % pure Python: stdlib,
pydantic and rapidfuzz only. It has no database, HTTP, or AI imports, and given the
same ``FactBundle``, ``RuleSetSchema``, flags and config it returns byte-identical
output.

Public surface:

* :mod:`app.engine.facts` — canonical fact registry and tri-state bundle
* :mod:`app.engine.rules_dsl` — versioned rules DSL and validator
* :mod:`app.engine.evaluator` — Kleene tri-state evaluation and benefit formula
* :mod:`app.engine.confidence` — four-pillar weakest-link confidence
* :mod:`app.engine.router` — cost-aware routing, priority score, handoff note
* :mod:`app.engine.entity_resolution` — Urdu/Roman name matching, never name-only
* :mod:`app.engine.anomalies` — the risk flag catalogue
* :mod:`app.engine.explainer` — deterministic bilingual citizen explanations
* :mod:`app.engine.twin` — pure Digital Twin replay
* :mod:`app.engine.eval_sweep` — cost-of-being-wrong threshold sweep
* :mod:`app.engine.pipeline` — ``evaluate_and_route``, the single entry point
"""

from app.engine.anomalies import (
    FLAG_CATALOGUE,
    FlagCode,
    FlagSeverity,
    RiskFlag,
    run_anomaly_checks,
    sort_flags,
)
from app.engine.confidence import (
    ConfidenceComponents,
    ConsentMethod,
    DocumentEvidence,
    DocumentStatus,
    build_confidence,
    weakest_pillar,
)
from app.engine.entity_resolution import (
    IdentityCandidate,
    IdentityResolution,
    MatchOutcome,
    canonical_name,
    name_sim,
    resolve_identity,
)
from app.engine.eval_sweep import (
    DEFAULT_THRESHOLDS,
    LabelledCase,
    SweepResult,
    dashboard_payload,
    load_labelled_cases,
    sweep,
)
from app.engine.evaluator import (
    BenefitComputation,
    EvaluationResult,
    RuleResult,
    RuleTrace,
    compute_benefit,
    evaluate_ruleset,
)
from app.engine.explainer import CitizenExplanation, build_explanation
from app.engine.facts import (
    FACT_REGISTRY,
    EnteredBy,
    Fact,
    FactBundle,
    FactSource,
    FactState,
    MissingReason,
    known_fact,
    unknown_fact,
)
from app.engine.pipeline import ENGINE_VERSION, EngineResult, evaluate_and_route
from app.engine.router import (
    CaseHandoffNote,
    CaseOutcome,
    PriorityBand,
    RouteAction,
    RouteDecision,
    compute_priority_score,
    priority_band,
    route_case,
)
from app.engine.rules_dsl import (
    BenefitFormula,
    CostMatrix,
    EligibilityRule,
    Policy,
    RuleAction,
    RuleOperator,
    RuleSetSchema,
    validate_rules_json,
)
from app.engine.twin import TwinCase, TwinFlip, TwinResult, replay

__all__ = [
    "DEFAULT_THRESHOLDS",
    "ENGINE_VERSION",
    "FACT_REGISTRY",
    "FLAG_CATALOGUE",
    "BenefitComputation",
    "BenefitFormula",
    "CaseHandoffNote",
    "CaseOutcome",
    "CitizenExplanation",
    "ConfidenceComponents",
    "ConsentMethod",
    "CostMatrix",
    "DocumentEvidence",
    "DocumentStatus",
    "EligibilityRule",
    "EngineResult",
    "EnteredBy",
    "EvaluationResult",
    "Fact",
    "FactBundle",
    "FactSource",
    "FactState",
    "FlagCode",
    "FlagSeverity",
    "IdentityCandidate",
    "IdentityResolution",
    "LabelledCase",
    "MatchOutcome",
    "MissingReason",
    "Policy",
    "PriorityBand",
    "RiskFlag",
    "RouteAction",
    "RouteDecision",
    "RuleAction",
    "RuleOperator",
    "RuleResult",
    "RuleSetSchema",
    "RuleTrace",
    "SweepResult",
    "TwinCase",
    "TwinFlip",
    "TwinResult",
    "build_confidence",
    "build_explanation",
    "canonical_name",
    "compute_benefit",
    "compute_priority_score",
    "dashboard_payload",
    "evaluate_and_route",
    "evaluate_ruleset",
    "known_fact",
    "load_labelled_cases",
    "name_sim",
    "priority_band",
    "replay",
    "resolve_identity",
    "route_case",
    "run_anomaly_checks",
    "sort_flags",
    "sweep",
    "unknown_fact",
    "validate_rules_json",
    "weakest_pillar",
]
