/**
 * Unit tests for src/modules/community/knowledge-distiller.ts
 */

import { describe, it, expect } from 'vitest';
import { distillPost } from '../../../src/modules/community/knowledge-distiller.js';
import type { ICommunityPost, PostType } from '../../../src/shared/interfaces/community.interface.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<ICommunityPost> = {}): ICommunityPost {
  return {
    id: 'post-001',
    authorNodeId: 'node-abc12345',
    authorUserId: null,
    channelId: 'channel-general',
    postType: 'solution',
    title: 'How to automate deployment with CI',
    contextData: {},
    score: 10,
    replyCount: 3,
    isDistilled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Ineligible post types ─────────────────────────────────────────────────────

describe('distillPost — ineligible post types return null', () => {
  const ineligibleTypes: PostType[] = ['problem', 'experience', 'alert', 'discussion'];

  for (const postType of ineligibleTypes) {
    it(`returns null for postType="${postType}"`, () => {
      const post = makePost({ postType });
      const result = distillPost(post);
      expect(result).toBeNull();
    });
  }
});

// ── Already distilled posts ───────────────────────────────────────────────────

describe('distillPost — already distilled posts return null', () => {
  it('returns null for a solution post that is already distilled', () => {
    const post = makePost({ postType: 'solution', isDistilled: true });
    const result = distillPost(post);
    expect(result).toBeNull();
  });

  it('returns null for an evolution post that is already distilled', () => {
    const post = makePost({ postType: 'evolution', isDistilled: true });
    const result = distillPost(post);
    expect(result).toBeNull();
  });
});

// ── No signals extracted → null ───────────────────────────────────────────────

describe('distillPost — returns null when no signals can be extracted', () => {
  it('returns null when title has only short words (< 4 chars) and no tags', () => {
    const post = makePost({
      postType: 'solution',
      title: 'How to do it',    // words: "How"(3), "to"(2), "do"(2), "it"(2) — all < 4 chars
      contextData: {},
    });
    const result = distillPost(post);
    expect(result).toBeNull();
  });
});

// ── Successful distillation — solution posts ──────────────────────────────────

describe('distillPost — successful distillation for solution posts', () => {
  it('returns a DistillationResult (not null) for a valid solution post', () => {
    const post = makePost({ postType: 'solution' });
    const result = distillPost(post);
    expect(result).not.toBeNull();
  });

  it('sets category to "solution" for a solution post', () => {
    const post = makePost({ postType: 'solution' });
    const result = distillPost(post);
    expect(result!.category).toBe('solution');
  });

  it('includes signalsMatch array with extracted keywords', () => {
    const post = makePost({
      postType: 'solution',
      title: 'Automate deployment with GitHub Actions',
    });
    const result = distillPost(post);
    expect(Array.isArray(result!.signalsMatch)).toBe(true);
    expect(result!.signalsMatch.length).toBeGreaterThan(0);
  });

  it('includes strategy object with required fields', () => {
    const post = makePost({ postType: 'solution' });
    const result = distillPost(post);
    expect(result!.strategy).toBeDefined();
    expect(result!.strategy.source).toBe('community-distillation');
    expect(result!.strategy.sourcePostId).toBe(post.id);
    expect(result!.strategy.postType).toBe('solution');
    expect(result!.strategy.title).toBe(post.title);
    expect(result!.strategy.score).toBe(post.score);
  });

  it('strategy includes distilledAt as an ISO date string', () => {
    const post = makePost({ postType: 'solution' });
    const result = distillPost(post);
    const distilledAt = result!.strategy.distilledAt as string;
    expect(typeof distilledAt).toBe('string');
    expect(() => new Date(distilledAt)).not.toThrow();
  });
});

// ── Successful distillation — evolution posts ─────────────────────────────────

describe('distillPost — successful distillation for evolution posts', () => {
  it('returns a DistillationResult (not null) for a valid evolution post', () => {
    const post = makePost({
      postType: 'evolution',
      title: 'Improving agent performance with feedback loops',
    });
    const result = distillPost(post);
    expect(result).not.toBeNull();
  });

  it('sets category to "strategy" for an evolution post', () => {
    const post = makePost({
      postType: 'evolution',
      title: 'Building resilient agent pipelines',
    });
    const result = distillPost(post);
    expect(result!.category).toBe('strategy');
  });
});

// ── Signal extraction from tags ───────────────────────────────────────────────

describe('distillPost — signal extraction from contextData.tags', () => {
  it('includes tags from contextData in signalsMatch', () => {
    const post = makePost({
      postType: 'solution',
      title: 'Test title with enough words',
      contextData: { tags: ['automation', 'devops', 'cicd'] },
    });
    const result = distillPost(post);
    expect(result).not.toBeNull();
    expect(result!.signalsMatch).toContain('automation');
    expect(result!.signalsMatch).toContain('devops');
    expect(result!.signalsMatch).toContain('cicd');
  });

  it('deduplicates signals that appear in both tags and title', () => {
    const post = makePost({
      postType: 'solution',
      title: 'automation best practices guide',
      contextData: { tags: ['automation', 'guide'] },
    });
    const result = distillPost(post);
    expect(result).not.toBeNull();
    // "automation" appears in tags and title, should only appear once
    const automationCount = result!.signalsMatch.filter((s) => s === 'automation').length;
    expect(automationCount).toBe(1);
  });

  it('ignores non-string values in contextData.tags', () => {
    const post = makePost({
      postType: 'solution',
      title: 'Deploying microservices with automation tools',
      contextData: { tags: ['valid-tag', 42, null, 'another-tag'] },
    });
    const result = distillPost(post);
    expect(result).not.toBeNull();
    // Non-string tags should not cause errors
    expect(result!.signalsMatch).toContain('valid-tag');
    expect(result!.signalsMatch).toContain('another-tag');
  });

  it('handles missing contextData gracefully (no tags)', () => {
    const post = makePost({
      postType: 'solution',
      title: 'Reliable deployment pipeline with caching',
      contextData: {},
    });
    const result = distillPost(post);
    // Title has 4-char words so should still produce signals
    expect(result).not.toBeNull();
    expect(result!.signalsMatch.length).toBeGreaterThan(0);
  });
});

// ── Signal extraction from title ──────────────────────────────────────────────

describe('distillPost — signal extraction from title words', () => {
  it('only includes title words with 4 or more characters', () => {
    const post = makePost({
      postType: 'solution',
      title: 'A big test for long deployment automation',
      contextData: {},
    });
    const result = distillPost(post);
    expect(result).not.toBeNull();
    // "A"(1), "big"(3) should be excluded; "test"(4), "long"(4), "deployment"(10), "automation"(10) included
    expect(result!.signalsMatch).not.toContain('a');
    expect(result!.signalsMatch).not.toContain('big');
    expect(result!.signalsMatch).toContain('test');
  });

  it('lowercases and normalises title words', () => {
    const post = makePost({
      postType: 'solution',
      title: 'DEPLOY Pipeline AUTOMATION',
      contextData: {},
    });
    const result = distillPost(post);
    expect(result).not.toBeNull();
    // All normalised to lowercase
    expect(result!.signalsMatch).toContain('deploy');
    expect(result!.signalsMatch).toContain('pipeline');
    expect(result!.signalsMatch).toContain('automation');
  });
});

// ── Strategy fields from contextData ─────────────────────────────────────────

describe('distillPost — strategy fields from contextData', () => {
  it('includes codeSnippets from contextData in strategy', () => {
    const post = makePost({
      postType: 'solution',
      title: 'Automated testing with mocking libraries',
      contextData: { codeSnippets: ['console.log("hello")'] },
    });
    const result = distillPost(post);
    expect(result!.strategy.codeSnippets).toEqual(['console.log("hello")']);
  });

  it('includes relatedAssets from contextData in strategy', () => {
    const post = makePost({
      postType: 'solution',
      title: 'Build pipeline with integration tests',
      contextData: { relatedAssets: ['asset-001', 'asset-002'] },
    });
    const result = distillPost(post);
    expect(result!.strategy.relatedAssets).toEqual(['asset-001', 'asset-002']);
  });

  it('sets codeSnippets to null when not in contextData', () => {
    const post = makePost({
      postType: 'solution',
      contextData: {},
    });
    const result = distillPost(post);
    expect(result!.strategy.codeSnippets).toBeNull();
  });

  it('sets relatedAssets to null when not in contextData', () => {
    const post = makePost({
      postType: 'solution',
      contextData: {},
    });
    const result = distillPost(post);
    expect(result!.strategy.relatedAssets).toBeNull();
  });
});
