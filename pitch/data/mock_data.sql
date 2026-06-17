-- ============================================================
-- AI Adoption Tracker — Mock Dataset (Demo / Pitch Only)
-- Generated: 2026-06-10
-- In-world date range: 2026-04-28 → 2026-06-10
-- Load into SQLite: sqlite3 adoption.db < mock_data.sql
-- ============================================================

-- ============================================================
-- SCHEMA
-- ============================================================

CREATE TABLE IF NOT EXISTS leaf (
    id           INTEGER PRIMARY KEY,
    path         TEXT UNIQUE NOT NULL,
    lead_email   TEXT NOT NULL,
    champion_email TEXT NOT NULL,
    target_task  TEXT NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weekly_entry (
    id                    INTEGER PRIMARY KEY,
    leaf_id               INTEGER NOT NULL REFERENCES leaf(id),
    week_of               TEXT NOT NULL,
    narrative             TEXT NOT NULL,
    target_task_progress  TEXT NOT NULL CHECK(target_task_progress IN ('no_change','moved_forward','blocked','complete')),
    observed_direction    TEXT CHECK(observed_direction IN ('up','flat','down')),
    current_mode          TEXT,
    champion_facilitation TEXT,
    blockers              TEXT,
    next_step             TEXT,
    created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact (
    id             INTEGER PRIMARY KEY,
    entry_id       INTEGER NOT NULL REFERENCES weekly_entry(id),
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK(type IN ('skill','agent','hook','context_file','workflow','eval')),
    is_retired     BOOLEAN NOT NULL DEFAULT 0,
    reason_retired TEXT
);

CREATE TABLE IF NOT EXISTS failure (
    id                INTEGER PRIMARY KEY,
    entry_id          INTEGER NOT NULL REFERENCES weekly_entry(id),
    description       TEXT NOT NULL,
    remediation_plan  TEXT,
    owner             TEXT,
    due_date          TEXT
);

CREATE TABLE IF NOT EXISTS eval (
    id            INTEGER PRIMARY KEY,
    entry_id      INTEGER NOT NULL REFERENCES weekly_entry(id),
    artifact_name TEXT NOT NULL,
    passed        BOOLEAN NOT NULL,
    notes         TEXT
);

-- ============================================================
-- leaf  (7 rows)
-- ============================================================

INSERT INTO leaf (id, path, lead_email, champion_email, target_task, created_at) VALUES
(1, 'engineering/backend-services',   'priya.nair@company.com',      'tomas.reyes@company.com',     'Automate PR review checklist via Claude Code agent',                              '2026-04-28T09:00:00Z'),
(2, 'research/nlp-tooling',           'dr.wei.zhang@company.com',    'amara.osei@company.com',       'Replace manual annotation pipeline with Claude-assisted labeling workflow',       '2026-04-28T09:05:00Z'),
(3, 'infrastructure/platform-reliability', 'cassandra.mills@company.com', 'ravi.krishnamurthy@company.com', 'Generate runbook drafts from incident postmortems using Claude Code',       '2026-04-28T09:10:00Z'),
(4, 'engineering/mobile-ios',         'darius.okonkwo@company.com',  'lena.petrov@company.com',      'Use Claude Code to produce SwiftUI component stubs from design specs',           '2026-04-28T09:15:00Z'),
(5, 'qa/test-automation',             'sofia.hernandez@company.com', 'james.wu@company.com',         'Generate E2E Playwright test suites for each release sprint',                    '2026-04-28T09:20:00Z'),
(6, 'research/data-science',          'dr.wei.zhang@company.com',    'fatima.ali@company.com',       'Build Claude-assisted EDA notebook template reused across projects',             '2026-04-28T09:25:00Z'),
(7, 'infrastructure/security',        'rashida.banks@company.com',   'oliver.strand@company.com',    'Automate CVE triage summaries using Claude Code skill',                          '2026-04-28T09:30:00Z');

-- ============================================================
-- weekly_entry  (30 rows)
-- ============================================================

-- Leaf 1: engineering/backend-services (ACCELERATING / On Track → Complete)
INSERT INTO weekly_entry (id, leaf_id, week_of, narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step, created_at) VALUES
(1,  1, '2026-05-04',
 'Tomas ran a kickoff session with four backend engineers showing Claude Code''s slash-command workflow. Team picked up the PR-review agent stub from the shared SKILL.md in under an hour. Two engineers submitted their first AI-assisted PRs by end of day Friday.',
 'moved_forward', 'up', 'adoption-ramp, pair-programming',
 'Ran 60-min live demo; wrote CLAUDE.md for repo; set up shared slash-command library',
 NULL, 'Expand to remaining 6 engineers; draft first version of reviewer-agent prompt',
 '2026-05-08T16:00:00Z'),

(2,  1, '2026-05-11',
 'All 10 engineers on the team have now used Claude Code at least once in their PR flow. Tomas shipped v0.1 of the reviewer-agent; it catches missing test coverage notes and style drift. A few engineers are already requesting scope expansion to include security linting.',
 'moved_forward', 'up', 'active-use, agent-iteration',
 'Published reviewer-agent v0.1 to shared repo; held office hours twice',
 NULL, 'Cut v0.2 of agent with security lint hook; track adoption metric weekly',
 '2026-05-15T16:00:00Z'),

(3,  1, '2026-05-18',
 'Reviewer-agent v0.2 shipped with a security-linting hook. Adoption is at 100% of active PRs this week (12 of 12). Tomas is now being asked by the mobile team to share the pattern — classic champion-enabling-peers signal.',
 'moved_forward', 'up', 'active-use, scaling, peer-enablement',
 'Presented at cross-team sync; shared repo template with mobile; code-reviewed agent PRs',
 NULL, 'Document agent pattern in engineering wiki; target 100% PR coverage sustained 3 weeks',
 '2026-05-22T16:00:00Z'),

(4,  1, '2026-05-25',
 'Third consecutive week at full PR adoption. Wiki documentation merged. Two junior engineers reported the agent catches issues they used to miss entirely. Tomas is now exploring a commit-message hook as a logical next step beyond the original target task.',
 'complete', 'up', 'sustained-use, expanding-scope',
 'Merged wiki doc; mentored two junior engineers on prompt tuning; scoped commit-message hook',
 NULL, 'Officially mark target task complete; scope commit-message hook as next leaf target',
 '2026-05-29T16:00:00Z'),

(5,  1, '2026-06-01',
 'Commit-message hook scoped and approved by lead. Tomas ran a retrospective — engineers estimate 20 minutes saved per PR cycle. New target task formalized after target-task completion last week.',
 'moved_forward', 'up', 'sustained-use, new-target-task-started',
 'Ran retro session; quantified time savings; documented lessons for future domain onboarding',
 NULL, 'Ship commit-message hook v0.1 by June 17',
 '2026-06-05T14:00:00Z');

-- Leaf 2: research/nlp-tooling (BLOCKED by recurring model failures → resolving)
INSERT INTO weekly_entry (id, leaf_id, week_of, narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step, created_at) VALUES
(6,  2, '2026-05-04',
 'Amara set up Claude Code in the research environment and tested it against 50 held-out annotation examples. Results looked promising but the model occasionally hallucinated span boundaries on long sentences. Logged as first known failure.',
 'moved_forward', 'up', 'pilot, evaluation',
 'Configured Claude Code environment; ran baseline evaluation; documented failure mode',
 'Span-boundary hallucination on inputs > 512 tokens — needs prompt mitigation',
 'Test chunking strategy and window-overlap prompt; rerun eval',
 '2026-05-08T16:00:00Z'),

(7,  2, '2026-05-11',
 'Chunking strategy cut the hallucination rate from 14% to 3% on the held-out set. However, a second failure surfaced: Claude consistently misclassifies the ''causal-link'' label on implicit causality sentences. Amara logged this as failure-2 and is designing a targeted eval for it.',
 'blocked', 'flat', 'blocked, eval-iteration',
 'Tested chunking fix; designed targeted eval for causal-link label; filed issue with prompt team',
 'Causal-link misclassification rate at 18% — unacceptable for production annotation',
 'Run few-shot prompting experiment for causal-link; evaluate with 3-annotator gold set',
 '2026-05-15T16:00:00Z'),

(8,  2, '2026-05-18',
 'Few-shot prompting brought causal-link error rate to 9% — improved but still above the 5% threshold. A third failure emerged: the agent intermittently drops annotations on the last chunk of a document. Remediation ownership assigned to Amara with June 1 deadline. The team is running out of headroom to reach the target task on schedule.',
 'blocked', 'flat', 'blocked, multi-failure',
 'Ran few-shot experiment; escalated to lead; wrote remediation plans for both open failures',
 'Causal-link error still above threshold (9% vs 5% target); last-chunk drop rate ~4%',
 'Test chain-of-thought prompting for causal-link; patch chunk-boundary logic; re-eval by Jun 1',
 '2026-05-22T16:00:00Z'),

(9,  2, '2026-05-25',
 'Chain-of-thought prompting reduced causal-link error to 6% — still just above threshold. Last-chunk drop is still unresolved; owner requested a one-week extension to June 8. Target task pipeline remains blocked pending these two failures clearing.',
 'blocked', 'flat', 'blocked, remediation-pending',
 'Coordinated failure remediation; presented status to research lead; documented workarounds',
 'Causal-link error at 6% (threshold 5%); last-chunk drop unresolved; due-date slipped',
 'Final CoT + constraint prompt attempt; re-eval against gold set; escalate if still blocked',
 '2026-05-29T16:00:00Z'),

(10, 2, '2026-06-01',
 'Causal-link error finally below threshold at 4.8% after adding an explicit constraint in the system prompt. Last-chunk drop patched and confirmed fixed in staging. Amara is cautiously optimistic the pipeline can go to limited production next week.',
 'moved_forward', 'up', 'remediation-complete, pre-production',
 'Verified all fixes; briefed lead on production readiness; scheduled limited prod run for Jun 10',
 NULL, 'Run limited production batch (500 docs) Jun 10; monitor error rates live',
 '2026-06-05T14:00:00Z');

-- Leaf 3: infrastructure/platform-reliability (CHAMPION ROTATION mid-journey → full recovery)
INSERT INTO weekly_entry (id, leaf_id, week_of, narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step, created_at) VALUES
(11, 3, '2026-05-04',
 'Noah introduced Claude Code to the SRE rotation during a Monday standup. The team identified runbook generation from postmortems as a high-value target. Noah drafted the first CLAUDE.md template and tested it against two recent incidents — output quality was strong.',
 'moved_forward', 'up', 'pilot, champion-onboarding',
 'Introduced tool to SRE rotation; drafted CLAUDE.md template; tested against 2 live incidents',
 NULL, 'Roll out to full SRE on-call rotation; log 5 runbook generations as baseline',
 '2026-05-08T16:00:00Z'),

(12, 3, '2026-05-11',
 'Noah departed for a new team mid-week following a surprise internal transfer. Cassandra (lead) stepped in as interim champion and ran Friday''s on-call handoff. The CLAUDE.md template is still in use but no one has pushed the runbook workflow forward this week.',
 'no_change', 'flat', 'champion-rotation, interim-coverage',
 'Cassandra: ran on-call handoff; preserved CLAUDE.md; introduced incoming champion Ravi',
 'Champion rotation mid-week; Noah''s institutional knowledge partially undocumented',
 'Onboard Ravi Krishnamurthy as new champion; schedule knowledge-transfer session',
 '2026-05-15T16:00:00Z'),

(13, 3, '2026-05-18',
 'Ravi Krishnamurthy completed champion onboarding and ran his first solo runbook-generation session on a P2 incident from Tuesday. Output quality matched Noah''s baseline. The team logged 3 more runbooks — momentum is rebuilding steadily.',
 'moved_forward', 'up', 'new-champion-active, momentum-rebuilding',
 'Ravi: led runbook session; updated CLAUDE.md with new incident taxonomy; held async Q&A',
 NULL, 'Reach 10 total runbook generations; assess quality with lead before expanding',
 '2026-05-22T16:00:00Z'),

(14, 3, '2026-05-25',
 '10th runbook generated and reviewed by Cassandra — lead approved quality as production-grade. Ravi published a How-To guide in Confluence. Target task is effectively complete; team is now discussing whether to extend scope to alert-annotation.',
 'complete', 'up', 'sustained-use, scope-discussion',
 'Ravi: published Confluence guide; presented in SRE all-hands; scoped alert-annotation extension',
 NULL, 'Confirm scope extension with Cassandra; draft alert-annotation CLAUDE.md by Jun 10',
 '2026-05-29T16:00:00Z'),

(15, 3, '2026-06-01',
 'Alert-annotation scope confirmed. Ravi began prototyping; first results are noisy but directionally correct. Team is energized — this leaf is now a reference case that other infra teams are asking about.',
 'moved_forward', 'up', 'new-target-task, reference-leaf',
 'Ravi: demo''d alert-annotation prototype to 2 other infra teams; collected feedback for iteration',
 NULL, 'Iterate on alert-annotation prompt; set quality bar by Jun 17',
 '2026-06-05T14:00:00Z');

-- Leaf 4: engineering/mobile-ios (AT RISK — scope creep + stalled adoption)
INSERT INTO weekly_entry (id, leaf_id, week_of, narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step, created_at) VALUES
(16, 4, '2026-05-04',
 'Lena introduced Claude Code to the iOS team with the goal of generating SwiftUI component stubs from Figma-exported specs. Early tests produced reasonable skeletons but the team quickly requested adding animation handling, network state, and dark-mode variants to the stubs — scope is already inflating.',
 'moved_forward', 'up', 'pilot, scope-creep-emerging',
 'Ran initial demo; tested against 3 design specs; collected team wish-list',
 NULL, 'Lock scope to basic stub generation only; push animation/network scope to phase 2',
 '2026-05-08T16:00:00Z'),

(17, 4, '2026-05-11',
 'Despite Lena''s attempt to lock scope, two senior engineers started extending the CLAUDE.md to handle animation hooks this week. The stub generator is now inconsistently generating both minimal and full-featured stubs depending on who runs it. Target task definition is blurring.',
 'no_change', 'flat', 'scope-creep-active, inconsistent-output',
 'Attempted scope re-lock in team sync; documented two competing CLAUDE.md versions',
 'Two competing CLAUDE.md configs causing inconsistent stub output quality',
 'Force single canonical CLAUDE.md; require PR review for any config change',
 '2026-05-15T16:00:00Z'),

(18, 4, '2026-05-18',
 'Single canonical CLAUDE.md enforced via repo lock — a step forward. However, the team has now formally requested that the target task be expanded to include accessibility annotations, which Darius (lead) verbally approved without consulting the adoption tracker. Target task definition is actively contested.',
 'no_change', 'flat', 'scope-creep-formal, at-risk',
 'Enforced single config; escalated scope change to Darius; documented formal scope-change request',
 'Lead approved scope expansion informally; target task definition unclear without official update',
 'Get written target-task revision from Darius; re-baseline expectations with team',
 '2026-05-22T16:00:00Z'),

(19, 4, '2026-05-25',
 'Target task formally re-scoped to include accessibility annotations after a lead/champion alignment meeting. But adoption has stalled at 40% of the team — several engineers are waiting for the ''final'' version before committing to the workflow. Lena is frustrated with the stop-start cycle.',
 'no_change', 'flat', 'at-risk, adoption-stalled',
 'Aligned with lead; re-documented target task; surveyed engineers on blockers to adoption',
 '40% adoption ceiling; engineers waiting for stable workflow before committing',
 'Publish stable v1.0 workflow doc; set a 2-week adoption milestone with team',
 '2026-05-29T16:00:00Z'),

(20, 4, '2026-06-01',
 'v1.0 workflow doc published but adoption ticked up only marginally to 50% — still below the 70% threshold Darius set. Lena ran a lunch-and-learn but attendance was low. This leaf is at risk of missing its Q2 adoption target with two weeks left in the quarter.',
 'no_change', 'flat', 'at-risk, adoption-below-threshold',
 'Published v1.0 doc; ran lunch-and-learn (6 of 12 attendees); followed up individually with non-adopters',
 'Adoption at 50%; Q2 target is 70% by Jun 30; low urgency from engineers amid competing sprint priorities',
 'Escalate to Darius for top-down nudge; identify two influential engineers to act as peer champions',
 '2026-06-05T14:00:00Z');

-- Leaf 5: qa/test-automation (STALE — last entry week of 2026-05-18, no update in 3 weeks)
INSERT INTO weekly_entry (id, leaf_id, week_of, narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step, created_at) VALUES
(21, 5, '2026-05-04',
 'James and Sofia kicked off the Playwright test-generation effort. James configured Claude Code with the existing test framework context and ran it against three sprint features — output was syntactically correct and caught two real gaps in test coverage.',
 'moved_forward', 'up', 'pilot, positive-signal',
 'Configured framework context; ran against 3 features; documented coverage delta',
 NULL, 'Scale to all features in sprint-6; measure coverage uplift vs baseline',
 '2026-05-08T16:00:00Z'),

(22, 5, '2026-05-11',
 'Sprint-6 test suite generated in full. Coverage increased from 62% to 78% with AI-assisted tests. James published a workflow guide and the QA team adopted it unanimously for sprint-7. No blockers reported.',
 'moved_forward', 'up', 'active-use, coverage-improving',
 'Published workflow guide; ran sprint-6 full generation; briefed QA team on methodology',
 NULL, 'Run sprint-7; target 80% coverage; evaluate whether eval artifacts needed',
 '2026-05-15T16:00:00Z'),

(23, 5, '2026-05-18',
 'Sprint-7 coverage hit 81%. James is now the de facto expert for test generation across three teams asking for help. The target task feels essentially complete — full E2E Playwright coverage is being generated consistently each sprint.',
 'moved_forward', 'up', 'sustained-use, cross-team-requests',
 'Assisted two other teams with test generation setup; ran sprint-7; documented edge cases',
 NULL, 'Mark target task complete; assess if mutation testing expansion is worthwhile',
 '2026-05-22T16:00:00Z');
-- NOTE: No entries after 2026-05-18 — this leaf is STALE (3 weeks without update as of 2026-06-10)

-- Leaf 6: research/data-science (NET-NEGATIVE / flat-down → pivot initiated)
INSERT INTO weekly_entry (id, leaf_id, week_of, narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step, created_at) VALUES
(24, 6, '2026-05-04',
 'Fatima began building the EDA notebook template. Initial Claude Code output for a standard dataset summary cell was verbose and inconsistently structured. The team ran it on two real datasets and found the output useful but too long for quick reviews.',
 'moved_forward', 'up', 'pilot, output-quality-tuning',
 'Drafted initial template; ran against 2 datasets; documented verbosity issue',
 'Output too verbose — engineers skim-read and miss key stats',
 'Add conciseness instruction and structured-output constraint to prompt',
 '2026-05-08T16:00:00Z'),

(25, 6, '2026-05-11',
 'Structured-output constraint helped but the template still drifts significantly between datasets — different output structure depending on column types. Fatima spent most of the week debugging prompt variants rather than building. Observed direction is flat despite champion effort.',
 'no_change', 'flat', 'prompt-debugging, flat-progress',
 'Tested 4 prompt variants; documented drift patterns; consulted research peers',
 'Template output structure not stable across dataset types — reusability goal is undermined',
 'Try schema-anchored output (JSON schema constraint); test across 5 varied datasets',
 '2026-05-15T16:00:00Z'),

(26, 6, '2026-05-18',
 'JSON schema constraint produced more stable output but introduced a new failure: Claude sometimes refuses to populate optional fields marked as nullable, leaving gaps in the notebook that confuse downstream scripts. Fatima is questioning whether the template approach is the right design.',
 'no_change', 'down', 'design-doubt, new-failure',
 'Investigated null-field refusal; posted question to internal Claude Code channel; consulted Wei',
 'Nullable field refusal breaks downstream script compatibility; fundamental design question unresolved',
 'Spike: compare template approach vs fine-tuned context_file approach; decide by May 25',
 '2026-05-22T16:00:00Z'),

(27, 6, '2026-05-25',
 'Spike completed: context_file approach shows more consistent output than the template approach. Fatima is recommending a pivot but needs Wei''s sign-off. Despite best efforts, two weeks of flat/down direction suggest this domain needs a design reset before it can move forward.',
 'no_change', 'down', 'design-pivot-pending, at-risk',
 'Completed spike; drafted design-pivot proposal; briefed Wei on tradeoffs',
 'Awaiting Wei sign-off on design pivot; no forward progress until approach is confirmed',
 'Wei to review pivot proposal by Jun 3; if approved, rebuild template as context_file approach',
 '2026-05-29T16:00:00Z'),

(28, 6, '2026-06-01',
 'Wei approved the design pivot to context_file. Fatima rebuilt the EDA template as a context_file approach over the weekend and early tests are already more consistent. Direction is cautiously up but the leaf has been net-negative for three weeks — trust needs rebuilding with the team.',
 'moved_forward', 'up', 'design-pivot-active, rebuilding',
 'Rebuilt template as context_file; re-tested against 5 datasets; scheduled team re-intro session',
 NULL, 'Run team re-intro session Jun 10; collect feedback; publish v1.0 of context_file template',
 '2026-06-05T14:00:00Z');

-- Leaf 7: infrastructure/security (BLOCKED by critical model failure — last entry 2026-05-11, ~4 weeks stale)
INSERT INTO weekly_entry (id, leaf_id, week_of, narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step, created_at) VALUES
(29, 7, '2026-05-04',
 'Oliver set up Claude Code for CVE triage and ran first tests on 10 real CVEs from last quarter. The skill correctly summarized 8 of 10 and proposed accurate CVSS severity buckets. Team was optimistic about replacing the manual triage step.',
 'moved_forward', 'up', 'pilot, positive-signal',
 'Configured CVE triage skill; tested against 10 historical CVEs; documented accuracy',
 NULL, 'Run against live CVE feed for 2 weeks; compare to analyst outputs',
 '2026-05-08T16:00:00Z'),

(30, 7, '2026-05-11',
 'Live feed test completed. Accuracy on standard CVEs remains high (85%) but the tool struggled on two zero-day CVEs from NVD with sparse descriptions — it hallucinated affected package versions. Oliver logged this as a critical failure.',
 'blocked', 'flat', 'blocked, critical-failure',
 'Ran live feed test; documented hallucination failure; escalated to Rashida; wrote remediation plan',
 'Hallucinated affected package versions on sparse NVD entries — safety risk if used in triage',
 'Add explicit uncertainty instruction; test on 20 more sparse CVEs; hold production use until resolved',
 '2026-05-15T16:00:00Z');
-- NOTE: No entries after 2026-05-11 — blocked + stale (~4 weeks without update as of 2026-06-10)

-- ============================================================
-- artifact  (24 rows)
-- ============================================================

-- Leaf 1: engineering/backend-services
INSERT INTO artifact (id, entry_id, name, type, is_retired, reason_retired) VALUES
(1,  1,  'pr-reviewer-agent-v0.1',        'agent',        1, 'Superseded by v0.2 with security lint hook; v0.1 archived after full team migration'),
(2,  2,  'pr-reviewer-agent-v0.2',        'agent',        0, NULL),
(3,  2,  'backend-services/CLAUDE.md',    'context_file', 0, NULL),
(4,  3,  'security-lint-hook',            'hook',         0, NULL),
(5,  4,  'pr-review-workflow',            'workflow',     0, NULL),
(6,  5,  'commit-message-hook-v0.1',      'hook',         0, NULL);

-- Leaf 2: research/nlp-tooling
INSERT INTO artifact (id, entry_id, name, type, is_retired, reason_retired) VALUES
(7,  6,  'annotation-labeling-agent-v0.1', 'agent',  1, 'Hallucinated span boundaries on inputs >512 tokens at 14% rate — retired after chunking redesign'),
(8,  7,  'annotation-labeling-agent-v0.2', 'agent',  0, NULL),
(9,  7,  'nlp-annotation-eval',            'eval',   0, NULL),
(10, 10, 'causal-link-constraint-skill',   'skill',  0, NULL);

-- Leaf 3: infrastructure/platform-reliability
INSERT INTO artifact (id, entry_id, name, type, is_retired, reason_retired) VALUES
(11, 11, 'runbook-generator-skill-v0.1',   'skill',        0, NULL),
(12, 11, 'infra-platform/CLAUDE.md',        'context_file', 0, NULL),
(13, 13, 'runbook-generation-workflow',     'workflow',     0, NULL),
(14, 15, 'alert-annotation-agent-v0.1',     'agent',        0, NULL);

-- Leaf 4: engineering/mobile-ios
INSERT INTO artifact (id, entry_id, name, type, is_retired, reason_retired) VALUES
(15, 16, 'swiftui-stub-generator-skill-v0.1', 'skill',        1, 'Inconsistent output quality due to competing CLAUDE.md configs; replaced by canonical v1.0'),
(16, 18, 'mobile-ios/CLAUDE.md-canonical',    'context_file', 0, NULL),
(17, 20, 'swiftui-stub-workflow-v1.0',         'workflow',     0, NULL);

-- Leaf 5: qa/test-automation
INSERT INTO artifact (id, entry_id, name, type, is_retired, reason_retired) VALUES
(18, 21, 'playwright-test-generator-skill',  'skill',        0, NULL),
(19, 21, 'qa-test-framework-context',         'context_file', 0, NULL),
(20, 22, 'playwright-generation-workflow',    'workflow',     0, NULL);

-- Leaf 6: research/data-science
INSERT INTO artifact (id, entry_id, name, type, is_retired, reason_retired) VALUES
(21, 24, 'eda-notebook-template-v0.1', 'skill',        1, 'Template approach abandoned: unstable output across dataset types and nullable field refusal bug; replaced by context_file approach'),
(22, 28, 'eda-context-file-v1.0',      'context_file', 0, NULL);

-- Leaf 7: infrastructure/security
INSERT INTO artifact (id, entry_id, name, type, is_retired, reason_retired) VALUES
(23, 29, 'cve-triage-skill-v0.1',               'skill', 1, 'Hallucinated affected package versions on sparse NVD entries — production use halted pending redesign'),
(24, 30, 'cve-triage-uncertainty-skill-v0.2',   'skill', 0, NULL);

-- ============================================================
-- failure  (5 rows)
-- ============================================================

INSERT INTO failure (id, entry_id, description, remediation_plan, owner, due_date) VALUES
(1, 6,
 'Span-boundary hallucination: Claude Code misidentifies entity span boundaries on inputs exceeding 512 tokens, producing off-by-one annotation errors at a 14% rate on held-out evaluation set.',
 'Implement overlapping-window chunking strategy (256-token windows, 64-token overlap). Re-evaluate on same held-out set before proceeding.',
 'amara.osei@company.com', '2026-05-15'),

(2, 7,
 'Causal-link misclassification: model consistently misidentifies implicit causality sentences, labeling them as correlative. Error rate 18% against 3-annotator gold standard.',
 'Test few-shot prompting with 6 canonical causal-link examples in system prompt. If error rate still above 5% threshold after 2 iterations, escalate to model team.',
 'amara.osei@company.com', '2026-06-01'),

(3, 8,
 'Last-chunk annotation drop: agent silently skips annotations on the final chunk of documents longer than ~3000 tokens. Affects approximately 4% of production-length documents.',
 'Audit chunk-boundary logic in the annotation workflow script. Add explicit ''do not skip final chunk'' instruction and append a sentinel token to verify last-chunk completion.',
 'amara.osei@company.com', '2026-06-08'),

(4, 26,
 'Nullable field refusal: Claude refuses to populate optional EDA fields marked as nullable in the JSON schema, returning absent keys instead of null values. Breaks downstream processing scripts that expect all schema keys present.',
 'Test explicit instruction: ''Always include all schema keys; use null for missing values.'' Compare output stability across 5 dataset types before re-enabling template.',
 'fatima.ali@company.com', '2026-05-30'),

(5, 30,
 'Package version hallucination on sparse CVEs: when NVD entry has minimal description text, Claude fabricates specific affected package version numbers (e.g. libssl 3.0.2) that are not in the source. Critical safety risk for triage decisions.',
 'Add explicit instruction to express uncertainty when source text is sparse: ''If affected versions cannot be confirmed from source text, state UNKNOWN — do not infer.'' Test on 20 sparse CVEs before re-enabling live triage.',
 'oliver.strand@company.com', '2026-05-22');

-- ============================================================
-- eval  (3 rows)
-- ============================================================

INSERT INTO eval (id, entry_id, artifact_name, passed, notes) VALUES
(1, 9,  'annotation-labeling-agent-v0.2',
 0,
 'Causal-link error rate at 6% against gold standard — above the 5% production threshold. Chain-of-thought prompting improved from 18% but insufficient. Candidate for further iteration before passing eval.'),

(2, 10, 'annotation-labeling-agent-v0.2',
 1,
 'After adding explicit constraint in system prompt, causal-link error rate dropped to 4.8% — below 5% threshold. Last-chunk drop confirmed fixed in staging. Agent cleared for limited production run.'),

(3, 30, 'cve-triage-skill-v0.1',
 0,
 'Hallucinated package versions on 2 of 5 sparse NVD test CVEs. Failure is non-deterministic — same input produced hallucinated output on 3 of 5 runs. Artifact retired. v0.2 with uncertainty instruction queued for re-eval.');
