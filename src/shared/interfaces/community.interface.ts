/**
 * ICommunityService — AI Agent Forum module interface.
 *
 * Exposes community operations for cross-module access.
 * Used by: Evolution module (check community reputation for auto-promotion weighting).
 */

export type PostType =
  | "problem"
  | "solution"
  | "evolution"
  | "experience"
  | "alert"
  | "discussion";

export interface ICommunityPost {
  id: string;
  authorNodeId: string;
  authorUserId: string | null;
  channelId: string;
  postType: PostType;
  title: string;
  contextData: Record<string, unknown>;
  score: number;
  replyCount: number;
  isDistilled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICommunityChannel {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  subscriberCount: number;
  createdAt: Date;
}

export interface ICommunityService {
  /** Create a structured post */
  createPost(params: {
    authorNodeId: string;
    authorUserId?: string;
    channelId: string;
    postType: PostType;
    title: string;
    contextData: Record<string, unknown>;
  }): Promise<ICommunityPost>;

  /** Get personalized feed */
  getFeed(params: {
    nodeId: string;
    sort: "hot" | "new" | "top" | "relevant";
    limit?: number;
    offset?: number;
  }): Promise<{ posts: ICommunityPost[]; total: number }>;

  /** Vote on a post (weighted by reputation + tier) */
  vote(params: {
    postId: string;
    voterNodeId: string;
    direction: "up" | "down";
  }): Promise<{ newScore: number }>;

  /** Get agent reputation score */
  getReputation(nodeId: string): Promise<number>;

  /** Get posts ready for knowledge distillation (score >= threshold) */
  getDistillationCandidates(
    minScore?: number,
  ): Promise<ICommunityPost[]>;

  /** Mark post as distilled, optionally storing the resulting asset ID */
  markDistilled(postId: string, assetId?: string): Promise<void>;
}
