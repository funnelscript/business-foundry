import type { OntologyMetric, MetricResolution } from './types.ts';

export interface ResolveMetricResult {
  status: 'RESOLVED' | 'AMBIGUOUS';
  metricName: string;
  department?: string;
  sql?: string;
  certifiedFormula?: string;
  certifiedBy?: string;
  availableDepartments?: string[];
  message: string;
}

export class MetricHarmonizer {
  private metrics: Map<string, OntologyMetric> = new Map();

  constructor() {
    this.seedDefaultHarmonizedMetrics();
  }

  public registerMetric(metric: OntologyMetric): void {
    this.metrics.set(metric.name.toLowerCase(), metric);
  }

  public resolveMetric(metricName: string, departmentContext?: string): ResolveMetricResult {
    const key = metricName.trim().toLowerCase();
    const metric = this.metrics.get(key);

    if (!metric) {
      return {
        status: 'AMBIGUOUS',
        metricName,
        message: `Unknown metric '${metricName}'. Registered metrics: ${Array.from(this.metrics.keys()).join(', ')}`
      };
    }

    const availableDepts = Object.keys(metric.resolutions);

    // If department context is not provided and multiple exist
    if (!departmentContext) {
      if (availableDepts.length === 1) {
        departmentContext = availableDepts[0];
      } else {
        return {
          status: 'AMBIGUOUS',
          metricName: metric.name,
          availableDepartments: availableDepts,
          message: `Metric '${metric.name}' has conflicting definitions across departments: [${availableDepts.join(', ')}]. You MUST specify 'department_context' to ensure GAAP/operational safety.`
        };
      }
    }

    const resolution = metric.resolutions[departmentContext.toLowerCase()];
    if (!resolution) {
      return {
        status: 'AMBIGUOUS',
        metricName: metric.name,
        availableDepartments: availableDepts,
        message: `No certified resolution for metric '${metric.name}' under department '${departmentContext}'. Available: [${availableDepts.join(', ')}]`
      };
    }

    const generatedSql = `SELECT ${resolution.aggregationFunction.toUpperCase()}(${resolution.targetProperty}) AS ${metric.name}_${departmentContext.toLowerCase()} FROM ${metric.name}_table WHERE ${resolution.whereFilterSql};`;

    return {
      status: 'RESOLVED',
      metricName: metric.name,
      department: resolution.department,
      sql: generatedSql,
      certifiedFormula: resolution.description,
      certifiedBy: `${resolution.certifiedBy} (${resolution.certifiedAt})`,
      message: `Certified metric resolved for department '${resolution.department}'.`
    };
  }

  private seedDefaultHarmonizedMetrics(): void {
    const revenueMetric: OntologyMetric = {
      id: 'metric-rev-01',
      name: 'revenue',
      displayTitle: 'Enterprise Revenue',
      baseObjectTypeId: 'obj-invoice',
      resolutions: {
        finance: {
          department: 'finance',
          aggregationFunction: 'sum',
          targetProperty: 'net_amount_cents',
          whereFilterSql: "status = 'paid' AND recognized_at <= now() AND is_refunded = false",
          certifiedBy: 'VP of Finance / GAAP Compliance',
          certifiedAt: '2026-01-15',
          description: 'GAAP Recognized Net Revenue (excluding taxes, refunds, and deferred income)'
        },
        sales: {
          department: 'sales',
          aggregationFunction: 'sum',
          targetProperty: 'contract_value_cents',
          whereFilterSql: "stage = 'closed_won' AND contract_signed_at IS NOT NULL",
          certifiedBy: 'Chief Revenue Officer',
          certifiedAt: '2026-02-01',
          description: 'Annual Contract Value (ACV) / Bookings (Gross committed contract volume)'
        },
        growth: {
          department: 'growth',
          aggregationFunction: 'sum',
          targetProperty: 'gmv_cents',
          whereFilterSql: "transaction_status in ('settled', 'authorized')",
          certifiedBy: 'VP of Growth & Marketing',
          certifiedAt: '2026-02-10',
          description: 'Gross Merchandise Value (GMV) across platform transactions'
        }
      }
    };

    const activeUsersMetric: OntologyMetric = {
      id: 'metric-user-01',
      name: 'active_users',
      displayTitle: 'Active Users Count',
      baseObjectTypeId: 'obj-customer',
      resolutions: {
        product: {
          department: 'product',
          aggregationFunction: 'count',
          targetProperty: 'user_id',
          whereFilterSql: "last_active_at >= (now() - interval '30 days') AND is_bot = false",
          certifiedBy: 'Head of Analytics',
          certifiedAt: '2026-03-01',
          description: 'MAU: Unique humans with at least one authenticated session in 30 days'
        },
        finance: {
          department: 'finance',
          aggregationFunction: 'count',
          targetProperty: 'user_id',
          whereFilterSql: "subscription_status = 'active' AND billing_delinquent = false",
          certifiedBy: 'Billing Director',
          certifiedAt: '2026-03-05',
          description: 'Paying active subscription accounts'
        }
      }
    };

    this.registerMetric(revenueMetric);
    this.registerMetric(activeUsersMetric);
  }
}
