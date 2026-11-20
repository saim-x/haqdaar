import type { EvalDashboard, RouteAction, SweepPoint } from '../api/types';
import type { MockState } from './state';
import { rng } from './util';

// Dev-mock evaluation numbers. The real values come from engine/eval_sweep.py over
// backend/app/data/eval_cases.jsonl; this generator mimics that benchmark shape:
// 120 labelled cases, weakest-link confidence, cost matrix 100 / 8 / 5.

interface EvalCase {
  eligible: boolean;
  confidence: number;
  needsInfo: boolean;
}

function benchmark(): EvalCase[] {
  const r = rng(120);
  const out: EvalCase[] = [];
  for (let i = 0; i < 120; i++) {
    const eligible = i < 84; // 70 % genuinely eligible
    const needsInfo = r() < 0.1;
    let c: number;
    if (eligible) {
      // 60 clean records score high; 24 have spelling drift / survey gaps / verbal consent.
      c = i < 60 ? 0.9 + r() * 0.08 : 0.55 + r() * 0.34;
    } else if (i < 110) {
      c = 0.25 + r() * 0.5; // obvious problems
    } else if (i < 119) {
      // Convincing frauds: one weak pillar (a flag) caps weakest-link confidence below 0.90.
      c = 0.8 + r() * 0.095;
    } else {
      c = 0.92; // one fraud that fools every pillar — reported honestly as a false approval
    }
    out.push({ eligible, confidence: Math.round(c * 1000) / 1000, needsInfo });
  }
  return out;
}

export function sweep(costs = { fp: 100, hr: 8, ask: 5 }): SweepPoint[] {
  const cases = benchmark();
  const pts: SweepPoint[] = [];
  for (let t = 0.5; t <= 0.951; t += 0.05) {
    const tau = Math.round(t * 100) / 100;
    let auto = 0;
    let wrong = 0;
    let human = 0;
    let ask = 0;
    for (const c of cases) {
      if (c.needsInfo) ask++;
      else if (c.confidence >= tau) {
        auto++;
        if (!c.eligible) wrong++;
      } else human++;
    }
    pts.push({
      threshold: tau,
      auto_approve_rate: auto / cases.length,
      false_approval_rate: auto ? wrong / auto : 0,
      human_review_load: human / cases.length,
      expected_total_cost: wrong * costs.fp + human * costs.hr + ask * costs.ask,
    });
  }
  return pts;
}

export function evalDashboard(s: MockState): EvalDashboard {
  const dist: Record<RouteAction, number> = { AUTO_APPROVE: 0, ASK_MORE: 0, HUMAN_REVIEW: 0, WAIT_EXTERNAL: 0 };
  for (const d of s.decisions.filter((x) => x.decision_source === 'AI_ENGINE')) dist[d.route_action] += 1;
  const officer = s.decisions.filter((d) => d.decision_source !== 'AI_ENGINE');
  const sahara = s.programs.find((p) => p.code === 'SAHARA_WIDOW_GRANT');
  const active = s.ruleVersions.find((r) => r.id === sahara?.active_rule_version_id);
  return {
    threshold_sweep: { active_threshold: active?.rules_json.policy.auto_approve_confidence_threshold ?? 0.9, sample_size: 120, points: sweep() },
    scam: {
      precision: 0.94,
      recall: 0.91,
      f1: 0.925,
      confusion_matrix: { tp: 20, fp: 1, tn: 25, fn: 2 },
      hard_negative_fpr: 1 / 7,
      test_size: 48,
      disputed_count: s.scamChecks.filter((c) => c.disputed).length,
    },
    documents: { sample_size: 30, genuine_verified_rate: 1, tamper_catch_rate: 0.875, false_tamper_rate: 0, blurry_retake_rate: 1 },
    live: {
      route_distribution: dist,
      officer_override_rate: officer.length ? officer.filter((d) => d.is_override).length / officer.length : 0,
      pipeline_latency_ms: { p50: 2900, p95: 4700 },
      llm: { calls: s.audit.filter((e) => e.actor_type === 'AI').length, cost_usd: 0.0, failure_rate: 0, fallback_count: 0 },
    },
  };
}
