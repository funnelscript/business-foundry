-- ============================================================================
-- Operational Ontology & Governance Core: Production PostgreSQL Schema (v1.0)
-- Conforms to: D+L+A Architecture, Palantir Branching & Review, NVIDIA FastMCP
-- ============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. NOUNS LAYER (Ontology Objects, Properties, & Relations)
-- ============================================================================

-- Registry of enterprise entity types (e.g. Customer, Order, Shipment, Account)
create table ontology_object_types (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    name text not null,
    singular_label text not null,
    plural_label text not null,
    description text not null,
    primary_key_field text not null default 'id',
    storage_table text not null,
    is_active boolean not null default true,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uk_object_type_org_name unique (org_id, name)
);

create index idx_ontology_object_types_org on ontology_object_types(org_id);

-- Typed properties belonging to an object type
create table ontology_properties (
    id uuid primary key default gen_random_uuid(),
    object_type_id uuid not null references ontology_object_types(id) on delete cascade,
    name text not null,
    data_type text not null check (data_type in (
        'string', 'integer', 'decimal', 'boolean', 'timestamptz', 'uuid', 'jsonb', 'currency_cents'
    )),
    is_nullable boolean not null default false,
    is_immutable boolean not null default false,
    default_expression text,
    validation_regex text,
    description text not null,
    semantic_role text check (semantic_role in ('identifier', 'dimension', 'metric', 'timestamp', 'status', 'pii')),
    created_at timestamptz not null default now(),
    constraint uk_property_object_name unique (object_type_id, name)
);

create index idx_ontology_properties_obj on ontology_properties(object_type_id);

-- Graph relations / edges connecting object types
create table ontology_relations (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    name text not null,
    source_object_type_id uuid not null references ontology_object_types(id) on delete cascade,
    target_object_type_id uuid not null references ontology_object_types(id) on delete cascade,
    cardinality text not null check (cardinality in ('one_to_one', 'one_to_many', 'many_to_many')),
    foreign_key_column text,
    inverse_relation_name text,
    is_required boolean not null default false,
    description text not null,
    created_at timestamptz not null default now(),
    constraint uk_relation_org_name unique (org_id, name)
);

create index idx_ontology_relations_src on ontology_relations(source_object_type_id);
create index idx_ontology_relations_tgt on ontology_relations(target_object_type_id);

-- ============================================================================
-- 2. METRIC HARMONIZATION LAYER (NVIDIA Auto-Ontology Integration)
-- ============================================================================

-- Canonical business metrics with contextual department resolvers
create table ontology_metrics (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    name text not null,
    display_title text not null,
    base_object_type_id uuid not null references ontology_object_types(id) on delete cascade,
    default_department text not null default 'general',
    description text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uk_metrics_org_name unique (org_id, name)
);

-- Department-specific disambiguation formulas (Finance vs Sales vs Ops)
create table metric_resolutions (
    id uuid primary key default gen_random_uuid(),
    metric_id uuid not null references ontology_metrics(id) on delete cascade,
    department text not null, -- e.g. 'finance', 'sales', 'growth', 'operations'
    aggregation_function text not null check (aggregation_function in ('sum', 'count', 'avg', 'min', 'max', 'formula')),
    target_property_name text not null,
    where_filter_sql text not null,
    join_clause_sql text,
    formula_expression text,
    certified_by text not null,
    certification_timestamp timestamptz not null default now(),
    is_active boolean not null default true,
    constraint uk_metric_dept unique (metric_id, department)
);

create index idx_metric_resolutions_metric on metric_resolutions(metric_id);

-- ============================================================================
-- 3. VERBS LAYER (Actions, Preconditions, & Functions)
-- ============================================================================

-- Executable business actions registered in the ontology
create table ontology_actions (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    name text not null,
    display_title text not null,
    target_object_type_id uuid not null references ontology_object_types(id) on delete cascade,
    risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
    requires_human_approval boolean not null default false,
    financial_impact_type text not null default 'none' check (financial_impact_type in ('none', 'credit', 'debit', 'liability')),
    max_financial_limit_cents integer not null default 0,
    description text not null,
    parameters_schema jsonb not null default '{}',
    precondition_logic text not null, -- Evaluated prior to staging
    execution_function_name text not null, -- Database RPC or external handler
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    constraint uk_actions_org_name unique (org_id, name)
);

create index idx_ontology_actions_org on ontology_actions(org_id);
create index idx_ontology_actions_target on ontology_actions(target_object_type_id);

-- ============================================================================
-- 4. GOVERNANCE & BUDGET CIRCUIT-BREAKER LAYER
-- ============================================================================

-- Organization & agent session spending / mutation ceilings
create table governance_budget_pools (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    agent_id text, -- NULL represents organization-wide ceiling
    name text not null,
    max_token_cost_usd numeric(10, 4) not null default 5.0000,
    max_financial_mutation_cents integer not null default 100000, -- $1,000.00
    max_mutations_per_window integer not null default 50,
    window_duration_seconds integer not null default 3600, -- 1 Hour
    circuit_breaker_status text not null default 'ARMED' check (circuit_breaker_status in ('ARMED', 'TRIPPED', 'BYPASSED')),
    tripped_reason text,
    tripped_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uk_budget_pool_org_agent unique (org_id, agent_id)
);

-- Sliding-window consumption log for real-time rate & cost checking
create table budget_usage_windows (
    id uuid primary key default gen_random_uuid(),
    budget_pool_id uuid not null references governance_budget_pools(id) on delete cascade,
    window_start_at timestamptz not null default now(),
    consumed_tokens integer not null default 0,
    consumed_token_cost_usd numeric(10, 4) not null default 0.0000,
    consumed_financial_cents integer not null default 0,
    mutation_count integer not null default 0,
    failure_streak integer not null default 0,
    created_at timestamptz not null default now()
);

create index idx_budget_usage_pool_window on budget_usage_windows(budget_pool_id, window_start_at);

-- ============================================================================
-- 5. OPERATIONAL GIT: BRANCHING, SIMULATION & REVIEW
-- ============================================================================

-- Sandboxed operational branches for agent proposals
create table operational_branches (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    agent_id text not null,
    name text not null,
    justification text not null,
    base_snapshot_timestamp timestamptz not null default now(),
    status text not null default 'DRAFT' check (status in (
        'DRAFT', 'STAGED', 'SIMULATED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'MERGED', 'CANCELLED'
    )),
    simulation_score numeric(5, 2),
    merge_commit_hash text,
    merged_at timestamptz,
    merged_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_operational_branches_org on operational_branches(org_id);
create index idx_operational_branches_status on operational_branches(status);

-- Staged actions within a branch (Copy-on-Write mutations)
create table branch_mutations (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references operational_branches(id) on delete cascade,
    action_id uuid not null references ontology_actions(id) on delete restrict,
    target_entity_id uuid not null,
    action_payload jsonb not null,
    execution_order integer not null default 1,
    estimated_financial_cents integer not null default 0,
    precondition_evaluation text not null default 'PENDING' check (precondition_evaluation in ('PENDING', 'PASSED', 'FAILED')),
    failure_reason text,
    created_at timestamptz not null default now()
);

create index idx_branch_mutations_branch on branch_mutations(branch_id);

-- Pre-commit simulation results evaluating blast radius & financial risk
create table branch_simulation_reports (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references operational_branches(id) on delete cascade,
    total_mutations integer not null,
    total_financial_liability_cents integer not null,
    affected_entity_count integer not null,
    downstream_dependency_count integer not null,
    risk_classification text not null check (risk_classification in ('TIER_1_LOW', 'TIER_2_MEDIUM', 'TIER_3_HIGH')),
    recommended_approval_mode text not null check (recommended_approval_mode in ('AUTO_POLICY', 'HITL_REVIEW')),
    simulation_diagnostics jsonb not null default '{}',
    simulated_at timestamptz not null default now()
);

create index idx_simulation_branch on branch_simulation_reports(branch_id);

-- Human-in-the-Loop review queue for high-risk branches
create table governance_review_tasks (
    id uuid primary key default gen_random_uuid(),
    branch_id uuid not null references operational_branches(id) on delete cascade,
    org_id uuid not null,
    assigned_role text not null default 'operations_manager',
    status text not null default 'OPEN' check (status in ('OPEN', 'CLAIMED', 'APPROVED', 'REJECTED')),
    decision_reason text,
    reviewer_identity text,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
);

create index idx_review_tasks_org_status on governance_review_tasks(org_id, status);

-- ============================================================================
-- 6. CRYPTOGRAPHIC AUDIT LEDGER (SHA-256 Hash Chaining)
-- ============================================================================

-- Immutable, append-only transaction ledger
create table action_audit_ledger (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null,
    branch_id uuid not null references operational_branches(id) on delete restrict,
    sequence_number bigserial not null,
    previous_hash text not null,
    entry_payload jsonb not null,
    current_hash text not null,
    committed_by text not null,
    committed_at timestamptz not null default now(),
    constraint uk_ledger_seq unique (sequence_number)
);

create index idx_audit_ledger_org on action_audit_ledger(org_id);
create index idx_audit_ledger_branch on action_audit_ledger(branch_id);

-- ============================================================================
-- 7. ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

alter table ontology_object_types enable row level security;
alter table ontology_properties enable row level security;
alter table ontology_relations enable row level security;
alter table ontology_metrics enable row level security;
alter table metric_resolutions enable row level security;
alter table ontology_actions enable row level security;
alter table governance_budget_pools enable row level security;
alter table operational_branches enable row level security;
alter table branch_mutations enable row level security;
alter table action_audit_ledger enable row level security;

-- Tenant Isolation Policies
create policy rls_object_types_tenant on ontology_object_types
    for all using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

create policy rls_branches_tenant on operational_branches
    for all using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

create policy rls_budget_tenant on governance_budget_pools
    for all using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

create policy rls_audit_ledger_tenant on action_audit_ledger
    for select using (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
