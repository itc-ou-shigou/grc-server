/**
 * Weekly Digest — Generates a weekly summary post every Friday.
 *
 * Aggregates: completed tasks by role, top community posts, active agents.
 * Posts to evolution-showcase channel.
 */

import { sql, eq, gte, desc } from "drizzle-orm";
import pino from "pino";
import { getDb } from "../../shared/db/connection.js";
import { communityTopicsTable, communityChannelsTable } from "./schema.js";
import { getCommunityService } from "./service.js";
import { nodeConfigSSE } from "../evolution/node-config-sse.js";
import type { PostType } from "../../shared/interfaces/community.interface.js";

const logger = pino({ name: "community:weekly-digest" });

export async function generateWeeklyDigest(): Promise<void> {
  const db = getDb();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. Count completed tasks this week by role
  let taskSummary = "No task data available.";
  try {
    const [taskRows] = await (db as any).execute(
      sql`SELECT assigned_role_id as role, COUNT(*) as cnt
          FROM tasks
          WHERE status = 'completed' AND completed_at >= ${oneWeekAgo}
          GROUP BY assigned_role_id
          ORDER BY cnt DESC`,
    );
    if (taskRows && taskRows.length > 0) {
      const lines = taskRows.map(
        (r: any) => `| ${r.role ?? "unassigned"} | ${r.cnt} |`,
      );
      taskSummary = `| Role | Completed |\n|------|----------|\n${lines.join("\n")}`;
    } else {
      taskSummary = "No tasks completed this week.";
    }
  } catch {
    taskSummary = "Task data unavailable.";
  }

  // 2. Top community posts this week (by score)
  let topPostsSummary = "No posts this week.";
  try {
    const topPosts = await db
      .select({
        title: communityTopicsTable.title,
        score: communityTopicsTable.score,
        replyCount: communityTopicsTable.replyCount,
        authorId: communityTopicsTable.authorId,
      })
      .from(communityTopicsTable)
      .where(gte(communityTopicsTable.createdAt, oneWeekAgo))
      .orderBy(desc(communityTopicsTable.score))
      .limit(5);

    if (topPosts.length > 0) {
      const lines = topPosts.map(
        (p, i) =>
          `${i + 1}. **${p.title}** — score: ${p.score}, replies: ${p.replyCount}`,
      );
      topPostsSummary = lines.join("\n");
    }
  } catch {
    topPostsSummary = "Post data unavailable.";
  }

  // 3. Active agents count
  const connectedNodes = nodeConfigSSE.getConnectedNodeIds().length;

  // 4. Total posts this week
  let weeklyPostCount = 0;
  try {
    const [countResult] = await (db as any).execute(
      sql`SELECT COUNT(*) as cnt FROM community_topics WHERE created_at >= ${oneWeekAgo}`,
    );
    weeklyPostCount = countResult?.[0]?.cnt ?? 0;
  } catch { /* ignore */ }

  // 5. Build digest body
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dateRange = `${weekStart.toISOString().slice(0, 10)} — ${now.toISOString().slice(0, 10)}`;

  const body = [
    `## Weekly Company Digest`,
    `**Period**: ${dateRange}`,
    `**Active Agents**: ${connectedNodes} online`,
    `**Community Posts This Week**: ${weeklyPostCount}`,
    "",
    `### Task Completion Summary`,
    taskSummary,
    "",
    `### Top Community Posts`,
    topPostsSummary,
    "",
    "---",
    "*This digest is auto-generated every Friday. Keep up the great work!*",
  ].join("\n");

  // 6. Post to evolution-showcase
  const [channel] = await db
    .select({ id: communityChannelsTable.id })
    .from(communityChannelsTable)
    .where(eq(communityChannelsTable.name, "evolution-showcase"))
    .limit(1);

  if (!channel) {
    logger.warn("evolution-showcase channel not found — skipping weekly digest");
    return;
  }

  const service = getCommunityService();
  const post = await service.createPost({
    authorNodeId: "system",
    channelId: channel.id,
    postType: "experience" as PostType,
    title: `[Weekly Digest] Company Activity Summary — ${now.toISOString().slice(0, 10)}`,
    contextData: {
      body,
      tags: ["weekly-digest", "auto-generated"],
      auto_generated: true,
    },
  });

  // 7. Broadcast to all nodes
  nodeConfigSSE.broadcastCommunityEvent({
    event_type: "community_new_post",
    post_id: post.id,
    title: post.title,
    channel: "evolution-showcase",
    author_node_id: "system",
    post_type: "experience",
    body_preview: body.slice(0, 200),
    created_at: new Date().toISOString(),
  });

  logger.info({ postId: post.id }, "Weekly digest posted to community");
}
