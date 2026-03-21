import pino from "pino";

const logger = pino({ name: "module:orchestrator:complexity-scorer" });

interface TaskInput {
  title: string;
  description: string | null;
  category: string | null;
  priority: string;
  dependsOn: unknown;
  deliverables: unknown;
  notes: string | null;
}

interface ScoreBreakdown {
  descriptionLength: number;
  deliverablesCount: number;
  priority: number;
  category: number;
  dependencies: number;
  crossDomain: number;
  annotation: number;
  total: number;
}

const KEYWORD_DOMAINS: Record<string, string[]> = {
  engineering: ["implement", "build", "refactor", "architecture", "api", "database", "deploy", "code", "test", "develop", "migrate", "optimize"],
  analysis: ["analyze", "research", "evaluate", "compare", "benchmark", "data", "metrics", "investigate", "assess", "measure"],
  review: ["review", "audit", "security", "compliance", "risk", "quality", "inspect", "verify", "validate"],
  creative: ["design", "write", "content", "marketing", "strategy", "plan", "roadmap", "proposal", "draft"],
  finance: ["budget", "expense", "forecast", "revenue", "cost", "pricing", "financial", "payment", "invoice"],
};

export function computeComplexityScore(task: TaskInput): ScoreBreakdown {
  const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
  const notes = (task.notes ?? "").toLowerCase();

  // 1. Description length (10 pts)
  const descLen = (task.description ?? "").length;
  const descriptionLength = descLen > 500 ? 10 : descLen >= 200 ? 5 : 0;

  // 2. Deliverables count (15 pts)
  const delivs = Array.isArray(task.deliverables) ? task.deliverables.length : 0;
  const deliverablesCount = delivs >= 4 ? 15 : delivs >= 2 ? 8 : 0;

  // 3. Priority (10 pts)
  const priorityMap: Record<string, number> = { critical: 10, high: 7, medium: 3, low: 0 };
  const priority = priorityMap[task.priority] ?? 0;

  // 4. Category (20 pts)
  const categoryMap: Record<string, number> = { strategic: 20, operational: 10, administrative: 0, expense: 0 };
  const category = categoryMap[task.category ?? ""] ?? 0;

  // 5. Dependencies (15 pts)
  const deps = Array.isArray(task.dependsOn) ? task.dependsOn.length : 0;
  const dependencies = deps >= 2 ? 15 : deps === 1 ? 7 : 0;

  // 6. Cross-domain keywords (20 pts)
  let domainsHit = 0;
  for (const [, keywords] of Object.entries(KEYWORD_DOMAINS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      domainsHit++;
    }
  }
  const crossDomain = domainsHit >= 3 ? 20 : domainsHit === 2 ? 12 : 0;

  // 7. Explicit annotation (10 pts)
  const annotation =
    notes.includes("[multi-agent]") || notes.includes("[team]") ? 10 : 0;

  const total =
    descriptionLength + deliverablesCount + priority + category +
    dependencies + crossDomain + annotation;

  logger.debug({ total, descriptionLength, deliverablesCount, priority, category, dependencies, crossDomain, annotation }, "Complexity score computed");

  return {
    descriptionLength,
    deliverablesCount,
    priority,
    category,
    dependencies,
    crossDomain,
    annotation,
    total,
  };
}

export function shouldForceMode(notes: string | null): "single" | "multi" | null {
  const n = (notes ?? "").toLowerCase();
  if (n.includes("[single-agent]")) return "single";
  if (n.includes("[multi-agent]") || n.includes("[team]")) return "multi";
  return null;
}
