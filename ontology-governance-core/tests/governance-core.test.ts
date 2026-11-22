import { describe, expect, it } from 'bun:test';
import {
  MetricHarmonizer,
  GovernanceCircuitBreaker,
  OperationalBranchEngine,
  FastMCPOntologyServer
} from '../src/index.ts';

describe('1. Metric Harmonizer (NVIDIA Auto-Ontology Integration)', () => {
  const harmonizer = new MetricHarmonizer();

  it('rejects ambiguous metric requests without department context', () => {
    const result = harmonizer.resolveMetric('revenue');
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.availableDepartments).toContain('finance');
    expect(result.availableDepartments).toContain('sales');
    expect(result.message).toContain('conflicting definitions');
  });

  it('resolves certified GAAP definition for finance department', () => {
    const result = harmonizer.resolveMetric('revenue', 'finance');
    expect(result.status).toBe('RESOLVED');
    expect(result.department).toBe('finance');
    expect(result.sql).toContain('SUM(net_amount_cents)');
    expect(result.sql).toContain("status = 'paid'");
    expect(result.certifiedBy).toContain('VP of Finance');
  });

  it('resolves certified ACV Bookings definition for sales department', () => {
    const result = harmonizer.resolveMetric('revenue', 'sales');
    expect(result.status).toBe('RESOLVED');
    expect(result.department).toBe('sales');
    expect(result.sql).toContain('contract_value_cents');
    expect(result.sql).toContain("stage = 'closed_won'");
    expect(result.certifiedBy).toContain('Chief Revenue Officer');
  });
});

describe('2. Budget Circuit Breaker & Runaway Limiter', () => {
  it('starts in ARMED state with clean budget limits', () => {
    const cb = new GovernanceCircuitBreaker({
      maxTokenCostUsd: 1.00,
      maxFinancialMutationCents: 5000, // $50.00
      maxMutationsPerWindow: 5
    });

    const status = cb.checkSafety();
    expect(status.allowed).toBe(true);
    expect(status.status).toBe('ARMED');
    expect(status.remainingFinancialCents).toBe(5000);
  });

  it('trips immediately when financial ceiling is breached (Fail-Closed)', () => {
    const cb = new GovernanceCircuitBreaker({
      maxFinancialMutationCents: 10000 // $100.00
    });

    // Record $150.00 mutation attempt
    cb.recordUsage({ financialMutationCents: 15000 });

    const status = cb.checkSafety();
    expect(status.allowed).toBe(false);
    expect(status.status).toBe('TRIPPED');
    expect(status.reason).toContain('Financial mutation ceiling');

    // Subsequent actions are strictly blocked
    expect(() => {
      cb.recordUsage({ financialMutationCents: 100 });
    }).toThrow(/Execution Blocked: Circuit Breaker is TRIPPED/);
  });

  it('trips on consecutive failure streak threshold', () => {
    const cb = new GovernanceCircuitBreaker();

    cb.recordUsage({ isFailure: true });
    cb.recordUsage({ isFailure: true });
    cb.recordUsage({ isFailure: true }); // 3rd failure

    const status = cb.checkSafety();
    expect(status.allowed).toBe(false);
    expect(status.status).toBe('TRIPPED');
    expect(status.reason).toContain('Repeated failure threshold');
  });

  it('allows authorized administrative reset with master override key', () => {
    const cb = new GovernanceCircuitBreaker({ maxFinancialMutationCents: 500 });
    cb.recordUsage({ financialMutationCents: 600 });
    expect(cb.getStatus()).toBe('TRIPPED');

    const unauthorizedReset = cb.reset('wrong-key');
    expect(unauthorizedReset).toBe(false);
    expect(cb.getStatus()).toBe('TRIPPED');

    const authorizedReset = cb.reset('MASTER_OVERRIDE_KEY');
    expect(authorizedReset).toBe(true);
    expect(cb.getStatus()).toBe('ARMED');
  });
});

describe('3. Operational Git: Branching, Staging, Simulation & Review', () => {
  it('executes full safe lifecycle from proposal to atomic write-back with audit hash', () => {
    const cb = new GovernanceCircuitBreaker();
    const engine = new OperationalBranchEngine(cb);

    // Initial state check
    const initialOrder = engine.getEntityState('order-101');
    expect(initialOrder?.amount_cents).toBe(12500); // $125.00

    // Step 1: Create isolated operational branch
    const branch = engine.createBranch(
      'customer-appeasement-branch',
      'Customer complained about shipping delay; issuing $25 courtesy partial refund',
      'agent-support-007'
    );
    expect(branch.status).toBe('DRAFT');

    // Step 2: Stage action with valid precondition
    const mutation = engine.stageAction(branch.id, 'issue_refund', 'order-101', {
      order_id: 'order-101',
      refund_cents: 2500, // $25.00
      reason: 'Shipping delay compensation',
      status: 'PARTIALLY_REFUNDED'
    });
    expect(mutation.preconditionStatus).toBe('PASSED');
    expect(branch.status).toBe('STAGED');

    // Step 3: Run pre-commit simulation
    const simulation = engine.simulateBranch(branch.id);
    expect(simulation.totalMutations).toBe(1);
    expect(simulation.totalFinancialLiabilityCents).toBe(2500);
    expect(simulation.riskClassification).toBe('TIER_1_LOW');
    expect(simulation.recommendedApprovalMode).toBe('AUTO_POLICY');

    // Step 4: Submit for review (Tier 1 triggers auto-policy approval)
    const reviewResult = engine.submitForReview(branch.id);
    expect(reviewResult.status).toBe('APPROVED');

    // Step 5: Execute atomic merge and write-back
    const mergeResult = engine.mergeBranch(branch.id, 'policy-engine');
    expect(mergeResult.commitHash).toBeDefined();
    expect(mergeResult.commitHash.length).toBe(64); // SHA-256 hash length

    // Step 6: Verify operational state was updated in system of record
    const updatedOrder = engine.getEntityState('order-101');
    expect(updatedOrder?.status).toBe('PARTIALLY_REFUNDED');
    expect(updatedOrder?._lastUpdatedByBranch).toBe(branch.id);

    // Step 7: Verify tamper-evident audit ledger
    const auditTrail = engine.getAuditTrail();
    expect(auditTrail.length).toBe(1);
    expect(auditTrail[0].branchId).toBe(branch.id);
    expect(auditTrail[0].currentHash).toBe(mergeResult.commitHash);
    expect(auditTrail[0].previousHash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
  });

  it('rejects action when precondition fails (e.g. refund exceeds order value)', () => {
    const cb = new GovernanceCircuitBreaker();
    const engine = new OperationalBranchEngine(cb);

    const branch = engine.createBranch('invalid-refund-branch', 'Testing invalid refund', 'agent-test');

    // Attempt to refund $200 on a $125 order
    const mutation = engine.stageAction(branch.id, 'issue_refund', 'order-101', {
      order_id: 'order-101',
      refund_cents: 20000,
      reason: 'Excessive refund'
    });

    expect(mutation.preconditionStatus).toBe('FAILED');
    expect(mutation.preconditionReason).toContain('exceeds order total');

    const simulation = engine.simulateBranch(branch.id);
    const failedCheck = simulation.invariantChecks.find(c => !c.passed);
    expect(failedCheck).toBeDefined();
  });

  it('enforces Human-in-the-Loop review for high liability actions', () => {
    const cb = new GovernanceCircuitBreaker();
    const engine = new OperationalBranchEngine(cb);

    const branch = engine.createBranch('high-risk-branch', 'Bulk compensation', 'agent-bulk');

    // Stage high financial liability action
    engine.stageAction(branch.id, 'issue_refund', 'order-101', {
      order_id: 'order-101',
      refund_cents: 60000, // $600.00 -> Tier 3
      reason: 'VIP contract resolution'
    });

    const simulation = engine.simulateBranch(branch.id);
    expect(simulation.riskClassification).toBe('TIER_3_HIGH');
    expect(simulation.recommendedApprovalMode).toBe('HITL_REVIEW');

    const review = engine.submitForReview(branch.id);
    expect(review.status).toBe('PENDING_APPROVAL');
    expect(review.approvalMode).toBe('HITL_REVIEW');

    // Merging without approval MUST fail
    expect(() => {
      engine.mergeBranch(branch.id, 'agent-bulk');
    }).toThrow(/Cannot merge branch .* without prior approval/);

    // Operations manager approves
    engine.approveBranch(branch.id, 'ops-director@company.com', 'Approved under escalation policy 4A');
    expect(branch.status).toBe('APPROVED');

    // Now merge succeeds
    const merge = engine.mergeBranch(branch.id, 'ops-director@company.com');
    expect(merge.commitHash).toBeDefined();
  });
});

describe('4. FastMCP Protocol Gateway Interface', () => {
  it('exposes all tools via FastMCP JSON-RPC protocol', async () => {
    const server = new FastMCPOntologyServer();

    // 1. List tools
    const listResp = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    });
    expect(listResp.result.tools.length).toBeGreaterThanOrEqual(6);

    // 2. Resolve metric via FastMCP
    const resolveResp = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'resolve_metric',
        arguments: { metric_name: 'revenue', department_context: 'finance' }
      }
    });
    const parsedResolve = JSON.parse(resolveResp.result.content[0].text);
    expect(parsedResolve.status).toBe('RESOLVED');
    expect(parsedResolve.department).toBe('finance');

    // 3. Create branch via FastMCP
    const branchResp = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'create_operational_branch',
        arguments: {
          branch_name: 'mcp-agent-branch',
          justification: 'Automated adjustment',
          agent_id: 'mcp-agent-1'
        }
      }
    });
    const parsedBranch = JSON.parse(branchResp.result.content[0].text);
    expect(parsedBranch.id).toBeDefined();
    expect(parsedBranch.status).toBe('DRAFT');

    // 4. Check circuit breaker safety status via FastMCP
    const cbResp = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_circuit_breaker_status'
      }
    });
    const parsedCb = JSON.parse(cbResp.result.content[0].text);
    expect(parsedCb.status).toBe('ARMED');
    expect(parsedCb.allowed).toBe(true);
  });
});
