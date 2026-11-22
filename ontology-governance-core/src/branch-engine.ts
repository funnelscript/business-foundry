import { createHash } from 'node:crypto';
import type {
  OperationalBranch,
  StagedMutation,
  SimulationReport,
  RiskClassification,
  AuditLedgerEntry,
  OntologyAction
} from './types.ts';
import { GovernanceCircuitBreaker } from './circuit-breaker.ts';

export class OperationalBranchEngine {
  private branches: Map<string, OperationalBranch> = new Map();
  private actions: Map<string, OntologyAction> = new Map();
  private auditLedger: AuditLedgerEntry[] = [];
  private circuitBreaker: GovernanceCircuitBreaker;

  // Mock operational database state of record
  private stateOfRecord: Map<string, Record<string, any>> = new Map();

  constructor(circuitBreaker: GovernanceCircuitBreaker) {
    this.circuitBreaker = circuitBreaker;
    this.seedDefaultStateAndActions();
  }

  public registerAction(action: OntologyAction): void {
    this.actions.set(action.name.toLowerCase(), action);
  }

  public createBranch(name: string, justification: string, agentId: string): OperationalBranch {
    const safety = this.circuitBreaker.checkSafety();
    if (!safety.allowed) {
      throw new Error(`Cannot create branch: Circuit Breaker is ${safety.status} (${safety.reason})`);
    }

    const branchId = `branch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const branch: OperationalBranch = {
      id: branchId,
      orgId: 'org-demo',
      agentId,
      name,
      justification,
      status: 'DRAFT',
      mutations: [],
      createdAt: new Date().toISOString()
    };

    this.branches.set(branchId, branch);
    return branch;
  }

  public stageAction(
    branchId: string,
    actionName: string,
    targetEntityId: string,
    payload: Record<string, any>
  ): StagedMutation {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    if (branch.status !== 'DRAFT' && branch.status !== 'STAGED') {
      throw new Error(`Cannot stage actions in branch '${branchId}' with status '${branch.status}'.`);
    }

    const action = this.actions.get(actionName.toLowerCase());
    if (!action) {
      throw new Error(`Registered action '${actionName}' not found in ontology verbs.`);
    }

    // Evaluate precondition logic
    const currentEntityState = this.stateOfRecord.get(targetEntityId) ?? {};
    const precondition = action.preconditionLogic(payload, currentEntityState);

    const estimatedFinancialCents = payload.amount_cents ?? payload.refund_cents ?? 0;

    const mutation: StagedMutation = {
      id: `mut-${Date.now()}-${branch.mutations.length + 1}`,
      actionId: action.id,
      targetEntityId,
      actionPayload: payload,
      estimatedFinancialCents,
      preconditionStatus: precondition.passed ? 'PASSED' : 'FAILED',
      preconditionReason: precondition.reason,
      createdAt: new Date().toISOString()
    };

    branch.mutations.push(mutation);
    branch.status = 'STAGED';

    // Record mutation into circuit breaker velocity tracker
    this.circuitBreaker.recordUsage({
      financialMutationCents: estimatedFinancialCents,
      isFailure: !precondition.passed
    });

    return mutation;
  }

  public simulateBranch(branchId: string): SimulationReport {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    const totalMutations = branch.mutations.length;
    let totalFinancialLiabilityCents = 0;
    const affectedEntities = new Set<string>();
    const invariantChecks: { name: string; passed: boolean; message: string }[] = [];

    for (const mut of branch.mutations) {
      totalFinancialLiabilityCents += mut.estimatedFinancialCents;
      affectedEntities.add(mut.targetEntityId);

      if (mut.preconditionStatus === 'FAILED') {
        invariantChecks.push({
          name: `Precondition Check (${mut.actionId})`,
          passed: false,
          message: mut.preconditionReason ?? 'Precondition failed'
        });
      }
    }

    // Risk classification rules
    let riskClassification: RiskClassification = 'TIER_1_LOW';
    let recommendedApprovalMode: 'AUTO_POLICY' | 'HITL_REVIEW' = 'AUTO_POLICY';

    if (totalFinancialLiabilityCents > 50000 || totalMutations > 10) { // > $500 or > 10 mutations
      riskClassification = 'TIER_3_HIGH';
      recommendedApprovalMode = 'HITL_REVIEW';
    } else if (totalFinancialLiabilityCents > 5000 || totalMutations > 3) { // > $50 or > 3 mutations
      riskClassification = 'TIER_2_MEDIUM';
      recommendedApprovalMode = 'HITL_REVIEW';
    }

    invariantChecks.push({
      name: 'Financial Liability Cap Check',
      passed: totalFinancialLiabilityCents <= 100000,
      message: totalFinancialLiabilityCents <= 100000 ? 'Within safety threshold' : 'Exceeds $1000 threshold'
    });

    const report: SimulationReport = {
      branchId,
      totalMutations,
      totalFinancialLiabilityCents,
      affectedEntityCount: affectedEntities.size,
      riskClassification,
      recommendedApprovalMode,
      invariantChecks,
      simulatedAt: new Date().toISOString()
    };

    branch.simulationReport = report;
    branch.status = 'SIMULATED';
    return report;
  }

  public submitForReview(branchId: string): { status: string; approvalMode: string } {
    const branch = this.branches.get(branchId);
    if (!branch || !branch.simulationReport) {
      throw new Error(`Branch '${branchId}' must be simulated before submitting for review.`);
    }

    if (branch.simulationReport.recommendedApprovalMode === 'AUTO_POLICY') {
      branch.status = 'APPROVED';
      return { status: 'APPROVED', approvalMode: 'AUTO_POLICY' };
    } else {
      branch.status = 'PENDING_APPROVAL';
      return { status: 'PENDING_APPROVAL', approvalMode: 'HITL_REVIEW' };
    }
  }

  public approveBranch(branchId: string, reviewerIdentity: string, reason: string): OperationalBranch {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    if (branch.status !== 'PENDING_APPROVAL') {
      throw new Error(`Cannot approve branch '${branchId}' with status '${branch.status}'.`);
    }

    branch.status = 'APPROVED';
    return branch;
  }

  public mergeBranch(branchId: string, committedBy: string): { commitHash: string; auditId: string } {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch '${branchId}' not found.`);
    }

    if (branch.status !== 'APPROVED') {
      throw new Error(`Cannot merge branch '${branchId}' without prior approval. Current status: '${branch.status}'`);
    }

    // Execute atomic write-backs to state of record
    for (const mut of branch.mutations) {
      const existing = this.stateOfRecord.get(mut.targetEntityId) ?? {};
      const updated = { ...existing, ...mut.actionPayload, _lastUpdatedByBranch: branchId };
      this.stateOfRecord.set(mut.targetEntityId, updated);
    }

    // Cryptographic hash chaining for audit ledger
    const previousEntry = this.auditLedger[this.auditLedger.length - 1];
    const previousHash = previousEntry ? previousEntry.currentHash : '0000000000000000000000000000000000000000000000000000000000000000';

    const entryPayload = {
      branchId,
      agentId: branch.agentId,
      mutations: branch.mutations,
      committedBy,
      timestamp: new Date().toISOString()
    };

    const currentHash = createHash('sha256')
      .update(previousHash + JSON.stringify(entryPayload))
      .digest('hex');

    const auditEntry: AuditLedgerEntry = {
      id: `audit-${Date.now()}`,
      branchId,
      sequenceNumber: this.auditLedger.length + 1,
      previousHash,
      entryPayload,
      currentHash,
      committedBy,
      committedAt: new Date().toISOString()
    };

    this.auditLedger.push(auditEntry);

    branch.status = 'MERGED';
    branch.mergeCommitHash = currentHash;
    branch.mergedAt = auditEntry.committedAt;
    branch.mergedBy = committedBy;

    return { commitHash: currentHash, auditId: auditEntry.id };
  }

  public getBranch(branchId: string): OperationalBranch | undefined {
    return this.branches.get(branchId);
  }

  public getEntityState(entityId: string): Record<string, any> | undefined {
    return this.stateOfRecord.get(entityId);
  }

  public getAuditTrail(): AuditLedgerEntry[] {
    return [...this.auditLedger];
  }

  private seedDefaultStateAndActions(): void {
    // Seed initial operational state
    this.stateOfRecord.set('order-101', {
      id: 'order-101',
      status: 'DELIVERED',
      amount_cents: 12500, // $125.00
      customer_id: 'cust-900',
      can_refund: true
    });

    this.stateOfRecord.set('cust-900', {
      id: 'cust-900',
      tier: 'standard',
      credit_limit_cents: 50000
    });

    // Register IssueRefund action (Verb)
    this.registerAction({
      id: 'act-refund-01',
      name: 'issue_refund',
      displayTitle: 'Issue Customer Refund',
      targetObjectTypeId: 'obj-order',
      riskLevel: 'medium',
      requiresHumanApproval: false,
      financialImpactType: 'debit',
      maxFinancialLimitCents: 20000,
      description: 'Issues a monetary refund against an existing order',
      parametersSchema: {
        order_id: 'string',
        refund_cents: 'integer',
        reason: 'string'
      },
      preconditionLogic: (payload, currentOrder) => {
        if (!currentOrder || !currentOrder.id) {
          return { passed: false, reason: 'Target order does not exist' };
        }
        if (payload.refund_cents <= 0) {
          return { passed: false, reason: 'Refund amount must be strictly positive' };
        }
        if (payload.refund_cents > (currentOrder.amount_cents ?? 0)) {
          return { passed: false, reason: `Refund ($${payload.refund_cents / 100}) exceeds order total ($${currentOrder.amount_cents / 100})` };
        }
        return { passed: true };
      }
    });

    // Register CancelSubscription action (Verb)
    this.registerAction({
      id: 'act-cancel-sub',
      name: 'cancel_subscription',
      displayTitle: 'Cancel Subscription',
      targetObjectTypeId: 'obj-subscription',
      riskLevel: 'high',
      requiresHumanApproval: true,
      financialImpactType: 'liability',
      maxFinancialLimitCents: 0,
      description: 'Cancels an active subscription contract',
      parametersSchema: {
        subscription_id: 'string',
        immediate: 'boolean'
      },
      preconditionLogic: (payload, currentSub) => {
        return { passed: true };
      }
    });
  }
}
