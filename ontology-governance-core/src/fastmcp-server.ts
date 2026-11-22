import { MetricHarmonizer } from './metric-harmonizer.ts';
import { GovernanceCircuitBreaker } from './circuit-breaker.ts';
import { OperationalBranchEngine } from './branch-engine.ts';

export interface FastMCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, any>;
}

export interface FastMCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class FastMCPOntologyServer {
  private harmonizer: MetricHarmonizer;
  private circuitBreaker: GovernanceCircuitBreaker;
  private branchEngine: OperationalBranchEngine;

  constructor() {
    this.harmonizer = new MetricHarmonizer();
    this.circuitBreaker = new GovernanceCircuitBreaker();
    this.branchEngine = new OperationalBranchEngine(this.circuitBreaker);
  }

  public getCircuitBreaker(): GovernanceCircuitBreaker {
    return this.circuitBreaker;
  }

  public getBranchEngine(): OperationalBranchEngine {
    return this.branchEngine;
  }

  public getHarmonizer(): MetricHarmonizer {
    return this.harmonizer;
  }

  public async handleRequest(req: FastMCPRequest): Promise<FastMCPResponse> {
    const { id, method, params = {} } = req;

    try {
      switch (method) {
        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: this.getToolDefinitions()
            }
          };

        case 'tools/call': {
          const toolName = params.name;
          const args = params.arguments ?? {};
          const toolResult = await this.executeTool(toolName, args);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(toolResult, null, 2)
                }
              ]
            }
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method '${method}' not found.`
            }
          };
      }
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: err.message ?? 'Internal MCP Server Error'
        }
      };
    }
  }

  public async executeTool(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'get_certified_ontology_schema': {
        return {
          system: 'Enterprise Operational Ontology & Governance Core',
          nouns: [
            {
              name: 'Order',
              table: 'orders',
              properties: ['id', 'status', 'amount_cents', 'customer_id', 'created_at']
            },
            {
              name: 'Customer',
              table: 'customers',
              properties: ['id', 'tier', 'credit_limit_cents', 'last_active_at']
            },
            {
              name: 'Invoice',
              table: 'invoices',
              properties: ['id', 'net_amount_cents', 'status', 'recognized_at']
            }
          ],
          verbs: [
            {
              name: 'issue_refund',
              target: 'Order',
              riskLevel: 'medium',
              description: 'Refund payment to customer with balance check'
            },
            {
              name: 'cancel_subscription',
              target: 'Subscription',
              riskLevel: 'high',
              description: 'Terminate recurring contract'
            }
          ]
        };
      }

      case 'resolve_metric': {
        const { metric_name, department_context } = args;
        if (!metric_name) {
          throw new Error("Missing required argument 'metric_name'.");
        }
        return this.harmonizer.resolveMetric(metric_name, department_context);
      }

      case 'create_operational_branch': {
        const { branch_name, justification, agent_id } = args;
        if (!branch_name || !justification || !agent_id) {
          throw new Error("Missing required fields: 'branch_name', 'justification', 'agent_id'.");
        }
        return this.branchEngine.createBranch(branch_name, justification, agent_id);
      }

      case 'stage_operational_action': {
        const { branch_id, action_name, target_entity_id, payload } = args;
        if (!branch_id || !action_name || !target_entity_id || !payload) {
          throw new Error("Missing required fields for staging action.");
        }
        return this.branchEngine.stageAction(branch_id, action_name, target_entity_id, payload);
      }

      case 'simulate_and_review_branch': {
        const { branch_id } = args;
        if (!branch_id) {
          throw new Error("Missing required field 'branch_id'.");
        }
        const report = this.branchEngine.simulateBranch(branch_id);
        const review = this.branchEngine.submitForReview(branch_id);
        return { simulationReport: report, reviewStatus: review };
      }

      case 'commit_operational_branch': {
        const { branch_id, committed_by } = args;
        if (!branch_id || !committed_by) {
          throw new Error("Missing required fields: 'branch_id', 'committed_by'.");
        }
        return this.branchEngine.mergeBranch(branch_id, committed_by);
      }

      case 'get_circuit_breaker_status': {
        return this.circuitBreaker.checkSafety();
      }

      default:
        throw new Error(`Tool '${toolName}' not supported by FastMCPOntologyServer.`);
    }
  }

  private getToolDefinitions(): any[] {
    return [
      {
        name: 'get_certified_ontology_schema',
        description: 'Returns certified definitions of Nouns (Object Types) and Verbs (Actions) in the ontology.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'resolve_metric',
        description: 'Disambiguates and resolves conflicting business metrics (e.g. Finance vs Sales revenue) using the NVIDIA Auto-Ontology pattern.',
        inputSchema: {
          type: 'object',
          properties: {
            metric_name: { type: 'string', description: 'Name of the metric (e.g. revenue, active_users)' },
            department_context: { type: 'string', description: 'Optional department context (finance, sales, growth)' }
          },
          required: ['metric_name']
        }
      },
      {
        name: 'create_operational_branch',
        description: 'Spawns an isolated operational branch to stage actions safely without touching production.',
        inputSchema: {
          type: 'object',
          properties: {
            branch_name: { type: 'string' },
            justification: { type: 'string' },
            agent_id: { type: 'string' }
          },
          required: ['branch_name', 'justification', 'agent_id']
        }
      },
      {
        name: 'stage_operational_action',
        description: 'Stages a business action (Verb) inside an operational branch with precondition validation.',
        inputSchema: {
          type: 'object',
          properties: {
            branch_id: { type: 'string' },
            action_name: { type: 'string' },
            target_entity_id: { type: 'string' },
            payload: { type: 'object' }
          },
          required: ['branch_id', 'action_name', 'target_entity_id', 'payload']
        }
      },
      {
        name: 'simulate_and_review_branch',
        description: 'Evaluates blast radius, total financial exposure, and routes branch to approval queue.',
        inputSchema: {
          type: 'object',
          properties: {
            branch_id: { type: 'string' }
          },
          required: ['branch_id']
        }
      },
      {
        name: 'commit_operational_branch',
        description: 'Performs atomic two-phase write-back to production system of record with cryptographic audit logging.',
        inputSchema: {
          type: 'object',
          properties: {
            branch_id: { type: 'string' },
            committed_by: { type: 'string' }
          },
          required: ['branch_id', 'committed_by']
        }
      },
      {
        name: 'get_circuit_breaker_status',
        description: 'Checks real-time sliding-window budget limits, mutation velocities, and fail-closed circuit health.',
        inputSchema: { type: 'object', properties: {} }
      }
    ];
  }
}
