import type { CircuitBreakerStatus, GovernanceBudgetPool } from './types.ts';

export interface RecordUsageParams {
  tokensUsed?: number;
  tokenCostUsd?: number;
  financialMutationCents?: number;
  isFailure?: boolean;
}

export interface CircuitCheckResult {
  allowed: boolean;
  status: CircuitBreakerStatus;
  reason?: string;
  remainingTokenCostUsd: number;
  remainingFinancialCents: number;
  remainingMutations: number;
}

interface WindowBucket {
  timestamp: number;
  tokens: number;
  tokenCostUsd: number;
  financialMutationCents: number;
  mutationCount: number;
}

export class GovernanceCircuitBreaker {
  private pool: GovernanceBudgetPool;
  private buckets: WindowBucket[] = [];
  private failureStreak: number = 0;
  private readonly maxFailureStreak: number = 3;

  constructor(customConfig?: Partial<GovernanceBudgetPool>) {
    this.pool = {
      id: 'pool-default',
      orgId: 'org-demo',
      maxTokenCostUsd: 5.00, // $5.00 default cap
      maxFinancialMutationCents: 100000, // $1,000.00 financial liability cap
      maxMutationsPerWindow: 20, // max 20 mutations per window
      windowDurationSeconds: 3600, // 1 hour sliding window
      circuitBreakerStatus: 'ARMED',
      ...customConfig
    };
  }

  public getStatus(): CircuitBreakerStatus {
    return this.pool.circuitBreakerStatus;
  }

  public checkSafety(): CircuitCheckResult {
    this.pruneExpiredBuckets();

    const totals = this.calculateWindowTotals();
    const remainingTokenCost = Math.max(0, this.pool.maxTokenCostUsd - totals.tokenCostUsd);
    const remainingFinancial = Math.max(0, this.pool.maxFinancialMutationCents - totals.financialMutationCents);
    const remainingMutations = Math.max(0, this.pool.maxMutationsPerWindow - totals.mutationCount);

    if (this.pool.circuitBreakerStatus === 'TRIPPED') {
      return {
        allowed: false,
        status: 'TRIPPED',
        reason: `Circuit breaker is TRIPPED: ${this.pool.trippedReason}`,
        remainingTokenCostUsd: remainingTokenCost,
        remainingFinancialCents: remainingFinancial,
        remainingMutations: remainingMutations
      };
    }

    if (this.pool.circuitBreakerStatus === 'BYPASSED') {
      return {
        allowed: true,
        status: 'BYPASSED',
        remainingTokenCostUsd: remainingTokenCost,
        remainingFinancialCents: remainingFinancial,
        remainingMutations: remainingMutations
      };
    }

    // Fail-closed checks against current sliding window
    if (totals.tokenCostUsd >= this.pool.maxTokenCostUsd) {
      this.trip(`Token compute budget of $${this.pool.maxTokenCostUsd.toFixed(2)} exceeded (used: $${totals.tokenCostUsd.toFixed(2)})`);
      return {
        allowed: false,
        status: 'TRIPPED',
        reason: this.pool.trippedReason,
        remainingTokenCostUsd: 0,
        remainingFinancialCents: remainingFinancial,
        remainingMutations: remainingMutations
      };
    }

    if (totals.financialMutationCents >= this.pool.maxFinancialMutationCents) {
      this.trip(`Financial mutation ceiling of $${(this.pool.maxFinancialMutationCents / 100).toFixed(2)} exceeded`);
      return {
        allowed: false,
        status: 'TRIPPED',
        reason: this.pool.trippedReason,
        remainingTokenCostUsd: remainingTokenCost,
        remainingFinancialCents: 0,
        remainingMutations: remainingMutations
      };
    }

    if (totals.mutationCount >= this.pool.maxMutationsPerWindow) {
      this.trip(`Mutation rate limit exceeded (${this.pool.maxMutationsPerWindow} actions per ${this.pool.windowDurationSeconds}s window)`);
      return {
        allowed: false,
        status: 'TRIPPED',
        reason: this.pool.trippedReason,
        remainingTokenCostUsd: remainingTokenCost,
        remainingFinancialCents: remainingFinancial,
        remainingMutations: 0
      };
    }

    if (this.failureStreak >= this.maxFailureStreak) {
      this.trip(`Repeated failure threshold tripped (${this.failureStreak} consecutive errors)`);
      return {
        allowed: false,
        status: 'TRIPPED',
        reason: this.pool.trippedReason,
        remainingTokenCostUsd: remainingTokenCost,
        remainingFinancialCents: remainingFinancial,
        remainingMutations: remainingMutations
      };
    }

    return {
      allowed: true,
      status: 'ARMED',
      remainingTokenCostUsd: remainingTokenCost,
      remainingFinancialCents: remainingFinancial,
      remainingMutations: remainingMutations
    };
  }

  public recordUsage(params: RecordUsageParams): void {
    const safety = this.checkSafety();
    if (!safety.allowed && this.pool.circuitBreakerStatus === 'TRIPPED') {
      throw new Error(`Execution Blocked: Circuit Breaker is TRIPPED (${this.pool.trippedReason})`);
    }

    if (params.isFailure) {
      this.failureStreak += 1;
    } else {
      this.failureStreak = 0;
    }

    this.buckets.push({
      timestamp: Date.now(),
      tokens: params.tokensUsed ?? 0,
      tokenCostUsd: params.tokenCostUsd ?? 0,
      financialMutationCents: params.financialMutationCents ?? 0,
      mutationCount: (params.financialMutationCents !== undefined || params.tokensUsed !== undefined) ? 1 : 0
    });

    // Immediate post-usage check to trip if breached
    this.checkSafety();
  }

  public trip(reason: string): void {
    this.pool.circuitBreakerStatus = 'TRIPPED';
    this.pool.trippedReason = reason;
    this.pool.trippedAt = new Date().toISOString();
  }

  public reset(authorizedAdminKey: string): boolean {
    if (authorizedAdminKey !== 'MASTER_OVERRIDE_KEY') {
      return false;
    }
    this.pool.circuitBreakerStatus = 'ARMED';
    this.pool.trippedReason = undefined;
    this.pool.trippedAt = undefined;
    this.failureStreak = 0;
    this.buckets = [];
    return true;
  }

  private pruneExpiredBuckets(): void {
    const cutoff = Date.now() - (this.pool.windowDurationSeconds * 1000);
    this.buckets = this.buckets.filter(b => b.timestamp >= cutoff);
  }

  private calculateWindowTotals(): { tokens: number; tokenCostUsd: number; financialMutationCents: number; mutationCount: number } {
    return this.buckets.reduce((acc, b) => ({
      tokens: acc.tokens + b.tokens,
      tokenCostUsd: acc.tokenCostUsd + b.tokenCostUsd,
      financialMutationCents: acc.financialMutationCents + b.financialMutationCents,
      mutationCount: acc.mutationCount + b.mutationCount
    }), { tokens: 0, tokenCostUsd: 0, financialMutationCents: 0, mutationCount: 0 });
  }
}
