import pino from "pino";

const logger = pino({ name: "module:orchestrator:template-mapper" });

export interface TemplateSelection {
  template: string;
  agentCount: number;
  reason: string;
}

interface TaskContext {
  title: string;
  description: string | null;
  category: string | null;
  deliverables: unknown;
}

const TEMPLATE_KEYWORDS: Record<string, { keywords: string[]; template: string; agents: number }> = {
  "code-review": {
    keywords: ["review", "pr", "code", "audit", "refactor", "pull request"],
    template: "code-review",
    agents: 4,
  },
  "strategy-room": {
    keywords: ["strategy", "plan", "roadmap", "decision", "proposal", "design"],
    template: "strategy-room",
    agents: 5,
  },
  "research-paper": {
    keywords: ["research", "paper", "literature", "analysis", "study", "report"],
    template: "research-paper",
    agents: 4,
  },
  "hedge-fund": {
    keywords: ["invest", "stock", "portfolio", "market", "trading", "financial analysis"],
    template: "hedge-fund",
    agents: 7,
  },
};

// Templates eligible per category (per design doc)
const CATEGORY_TEMPLATE_MAP: Record<string, string[]> = {
  strategic: ["strategy-room", "research-paper"],
  operational: ["code-review", "hedge-fund"],
};

export function selectTemplate(task: TaskContext): TemplateSelection {
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  const category = (task.category ?? "").toLowerCase();

  // Category-constrained matching (per design doc)
  const eligibleTemplates = CATEGORY_TEMPLATE_MAP[category];
  if (eligibleTemplates) {
    for (const templateKey of eligibleTemplates) {
      const config = TEMPLATE_KEYWORDS[templateKey];
      if (config && config.keywords.some((kw) => text.includes(kw))) {
        logger.debug({ template: config.template, category }, "Template matched by category+keyword");
        return { template: config.template, agentCount: config.agents, reason: `Category: ${category}, keyword match` };
      }
    }
    // Category-specific defaults
    if (category === "strategic") {
      return { template: "strategy-room", agentCount: 5, reason: "Default for strategic category" };
    }
  }

  // Keyword-only matching
  let bestMatch: TemplateSelection | null = null;
  let bestScore = 0;

  for (const [, config] of Object.entries(TEMPLATE_KEYWORDS)) {
    const score = config.keywords.filter((kw) => text.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { template: config.template, agentCount: config.agents, reason: `Keyword match (score: ${score})` };
    }
  }

  if (bestMatch && bestScore >= 2) {
    return bestMatch;
  }

  // Dynamic composition from deliverables
  const delivs = Array.isArray(task.deliverables) ? task.deliverables : [];
  if (delivs.length >= 2) {
    const dynamicAgents = Math.min(delivs.length + 1, 7); // 1 leader + N workers, max 7
    return { template: "strategy-room", agentCount: dynamicAgents, reason: `Dynamic from ${delivs.length} deliverables` };
  }

  // Default fallback
  return { template: "strategy-room", agentCount: 5, reason: "Default template" };
}

// Map GRC roleId to ClawTeam agent type
export function mapRoleToAgentType(roleId: string): string {
  const mapping: Record<string, string> = {
    ceo: "strategy-lead",
    cto: "systems-analyst",
    cfo: "risk-manager",
    engineering: "arch-reviewer",
    "engineering-lead": "systems-analyst",
    marketing: "sentiment-analyst",
    finance: "fundamentals-analyst",
    legal: "risk-mapper",
    sales: "growth-analyst",
    support: "data-analyst",
    hr: "delivery-planner",
  };
  return mapping[roleId] ?? "general-purpose";
}
