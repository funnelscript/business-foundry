/**
 * Operational Ontology & Governance Core Domain Types
 * Nouns (Entities/Relations) & Verbs (Actions/Functions)
 */

export type PropertyDataType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'timestamptz'
  | 'uuid'
  | 'jsonb'
  | 'currency_cents';

export interface OntologyProperty {
  id: string;
  name: string;
  dataType: PropertyDataType;
  isNullable: boolean;
  isImmutable: boolean;
  description: string;
  semanticRole?: 'identifier' | 'dimension' | 'metric' | 'timestamp' | 'status' | 'pii';
}

export interface OntologyObjectType {
  id: string;
  name: string;
  singularLabel: string;
  pluralLabel: string;
  description: string;
  storageTable: string;
  properties: OntologyProperty[];
}

export interface OntologyRelation {
  id: string;
  name: string;
  sourceObjectTypeId: string;
  targetObjectTypeId: string;
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_many';
  foreignKeyColumn?: string;
  description: string;
}

export interface MetricResolution {
  department: string;
  aggregationFunction: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'formula';
  targetProperty: string;
  whereFilterSql: string;
  certifiedBy: string;
  certifiedAt: string;
  description: string;
}

export interface OntologyMetric {
  id: string;
  name: string;
  displayTitle: string;
  baseObjectTypeId: string;
  resolutions: Record<string, MetricResolution>;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface OntologyAction {
  id: string;
  name: string;
  displayTitle: string;
  targetObjectTypeId: string;
  riskLevel: RiskLevel;
  requiresHumanApproval: boolean;
  financialImpactType: 'none' | 'credit' | 'debit' | 'liability';
  maxFinancialLimitCents: number;
  description: string;
  parametersSchema: Record<string, any>;
  preconditionLogic: (payload: any, baseState: any) => { passed: boolean; reason?: string };
}

export type BranchStatus =
  | 'DRAFT'
  | 'STAGED'
  | 'SIMULATED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'MERGED'
  | 'CANCELLED';

export interface StagedMutation {
  id: string;
  actionId: string;
  targetEntityId: string;
  actionPayload: Record<string, any>;
  estimatedFinancialCents: number;
  preconditionStatus: 'PASSED' | 'FAILED';
  preconditionReason?: string;
  createdAt: string;
}

export type RiskClassification = 'TIER_1_LOW' | 'TIER_2_MEDIUM' | 'TIER_3_HIGH';

export interface SimulationReport {
  branchId: string;
  totalMutations: number;
  totalFinancialLiabilityCents: number;
  affectedEntityCount: number;
  riskClassification: RiskClassification;
  recommendedApprovalMode: 'AUTO_POLICY' | 'HITL_REVIEW';
  invariantChecks: { name: string; passed: boolean; message: string }[];
  simulatedAt: string;
}

export interface OperationalBranch {
  id: string;
  orgId: string;
  agentId: string;
  name: string;
  justification: string;
  status: BranchStatus;
  mutations: StagedMutation[];
  simulationReport?: SimulationReport;
  mergeCommitHash?: string;
  mergedAt?: string;
  mergedBy?: string;
  createdAt: string;
}

export type CircuitBreakerStatus = 'ARMED' | 'TRIPPED' | 'BYPASSED';

export interface GovernanceBudgetPool {
  id: string;
  orgId: string;
  agentId?: string;
  maxTokenCostUsd: number;
  maxFinancialMutationCents: number;
  maxMutationsPerWindow: number;
  windowDurationSeconds: number;
  circuitBreakerStatus: CircuitBreakerStatus;
  trippedReason?: string;
  trippedAt?: string;
}

export interface AuditLedgerEntry {
  id: string;
  branchId: string;
  sequenceNumber: number;
  previousHash: string;
  entryPayload: Record<string, any>;
  currentHash: string;
  committedBy: string;
  committedAt: string;
}
