import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  displayName: string;
  email: string;
  provider: string;
  providerId: string;
  tier: string;
  role: string;
  promotedAssetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  userId: string;
  keyPrefix: string;
  name: string;
  scopes: unknown;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  userDisplayName: string | null;
  userEmail: string | null;
}

export interface AuthStats {
  stats: {
    totalUsers: number;
    tierDistribution: Record<string, number>;
    providerDistribution: Record<string, number>;
    newUsersLast7Days: number;
  };
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  authorId: string;
  category: string | null;
  tags: unknown;
  latestVersion: string;
  downloadCount: number;
  ratingAvg: number;
  ratingCount: number;
  isOfficial: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  authorDisplayName: string | null;
  authorEmail: string | null;
}

export interface SkillDownloadStats {
  stats: {
    totalDownloads: number;
    bySkill: Array<{ skillId: string; skillName: string; count: number }>;
    byDay: Array<{ date: string; count: number }>;
  };
}

export interface Asset {
  id: string;
  assetId: string;
  assetType: 'gene' | 'capsule';
  nodeId: string;
  userId: string | null;
  category: string | null;
  status: string;
  useCount: number;
  successRate: number;
  failCount: number;
  safetyScore: number | null;
  contentHash: string;
  signature: string | null;
  signalsMatch: string[] | null;
  strategy: Record<string, unknown> | null;
  constraintsData: Record<string, unknown> | null;
  validation: string[] | null;
  triggerData: Record<string, unknown> | null;
  summary: string | null;
  confidence: number | null;
  successStreak: number | null;
  geneAssetId: string | null;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetReport {
  id: string;
  assetId: string;
  assetType: string;
  reporterNodeId: string;
  reporterUserId: string | null;
  reportType: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  reporterName: string | null;
  reporterRole: string | null;
}

export interface AssetUsageCapsule {
  id: string;
  assetId: string;
  nodeId: string | null;
  nodeName: string | null;
  role: string | null;
  status: string;
}

export interface AssetUsageReporter {
  nodeId: string;
  nodeName: string;
  role: string | null;
  reportCount: number;
  lastUsed: string;
}

export interface AssetUsageResponse {
  ok: boolean;
  capsules: AssetUsageCapsule[];
  reporters: AssetUsageReporter[];
  totalUses: number;
}

export interface AssetDetailResponse {
  data: Asset & { reports: AssetReport[] };
}

export interface Node {
  id: string;
  nodeId: string;
  userId: string | null;
  displayName: string | null;
  platform: string | null;
  winclawVersion: string | null;
  geneCount: number;
  capsuleCount: number;
  lastHeartbeat: string | null;
  capabilities: unknown;
  employeeId: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  githubToken: string | null;
  primaryKeyId: string | null;
  auxiliaryKeyId: string | null;
  createdAt: string;
  updatedAt: string;
  provisioningMode: 'local_docker' | 'daytona_sandbox' | null;
  containerId: string | null;
  sandboxId: string | null;
  gatewayUrl: string | null;
  gatewayPort: number | null;
  workspacePath: string | null;
  apiKeyId: string | null;
  apiKeyAuthorized: boolean;
}

export interface EvolutionStats {
  stats: {
    totalGenes: number;
    totalCapsules: number;
    genesByStatus: Record<string, number>;
    capsulesByStatus: Record<string, number>;
    totalNodes: number;
    activeNodes: number;
    promotionRate: number;
  };
}

export interface Release {
  id: string;
  version: string;
  platform: string;
  channel: string;
  downloadUrl: string;
  sizeBytes: number;
  checksumSha256: string | null;
  changelog: string | null;
  minUpgradeVersion: string | null;
  isCritical: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface UpdateStats {
  stats: {
    totalReports: number;
    successRate: number;
    platformDistribution: Record<string, number>;
    avgDurationMs: number | null;
    versionAdoption: Array<{ version: string; count: number }>;
  };
}

export interface UpdateReport {
  id: string;
  nodeId: string;
  fromVersion: string;
  toVersion: string;
  platform: string;
  status: string;
  durationMs: number | null;
  errorMessage: string | null;
  reportedAt: string;
}

export interface TelemetryDashboard {
  stats: {
    totalReports: number;
    uniqueNodes: number;
    dailyReportCount: Array<{ date: string; count: number }>;
    platformDistribution: Record<string, number>;
    versionDistribution: Record<string, number>;
  };
}

export interface Channel {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: number;
  createdAt: string;
}

export interface Post {
  id: string;
  channelId: string;
  authorId: string;
  title: string;
  content: string;
  postType: string;
  score: number;
  upvotes: number;
  downvotes: number;
  replyCount: number;
  isLocked: number;
  isPinned: number;
  isDistilled: number;
  contextData: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Reply {
  id: string;
  topicId: string;
  authorId: string;
  body: string;
  isSolution: number;
  createdAt: string;
  updatedAt: string;
}

export interface PostDetailResponse {
  data: Post;
  replies: PaginatedResponse<Reply>;
}

export interface CommunityStats {
  stats: {
    totalChannels: number;
    totalPosts: number;
    totalReplies: number;
    activeAgents: number;
    dailyPosts: number;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Auth hooks
// ---------------------------------------------------------------------------

export function useUsers(params?: {
  page?: number;
  page_size?: number;
  provider?: string;
  tier?: string;
  search?: string;
}) {
  return useQuery<PaginatedResponse<User>>({
    queryKey: ['admin', 'users', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<User>>('/api/v1/admin/auth/users', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useAuthStats() {
  return useQuery<AuthStats>({
    queryKey: ['admin', 'auth', 'stats'],
    queryFn: () => apiClient.get<AuthStats>('/api/v1/admin/auth/stats'),
  });
}

export function useApiKeys(params?: { page?: number; page_size?: number; user_id?: string }) {
  return useQuery<PaginatedResponse<ApiKey>>({
    queryKey: ['admin', 'apikeys', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<ApiKey>>('/api/v1/admin/auth/apikeys', params as Record<string, string | number | boolean | undefined>),
  });
}

// ---------------------------------------------------------------------------
// Skills hooks
// ---------------------------------------------------------------------------

export function useAdminSkills(params?: {
  page?: number;
  page_size?: number;
  category?: string;
  status?: string;
  sort_by?: string;
  search?: string;
}) {
  return useQuery<PaginatedResponse<Skill>>({
    queryKey: ['admin', 'skills', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Skill>>('/api/v1/admin/skills', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useSkillDownloadStats() {
  return useQuery<SkillDownloadStats>({
    queryKey: ['admin', 'skills', 'download-stats'],
    queryFn: () => apiClient.get<SkillDownloadStats>('/api/v1/admin/skills/downloads/stats'),
  });
}

// ---------------------------------------------------------------------------
// Evolution hooks
// ---------------------------------------------------------------------------

export function useAdminAssets(params?: {
  page?: number;
  page_size?: number;
  asset_type?: string;
  status?: string;
  category?: string;
}) {
  // Backend expects 'type' not 'asset_type', and 'limit' not 'page_size'
  const apiParams: Record<string, string | number | boolean | undefined> = {
    page: params?.page,
    limit: params?.page_size,
    type: params?.asset_type,
    status: params?.status,
    category: params?.category,
  };
  return useQuery<PaginatedResponse<Asset>>({
    queryKey: ['admin', 'assets', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Asset>>('/api/v1/admin/evolution/assets', apiParams),
  });
}

export function useAdminNodes(params?: { page?: number; page_size?: number }) {
  return useQuery<PaginatedResponse<Node>>({
    queryKey: ['admin', 'nodes', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Node>>('/api/v1/admin/evolution/nodes', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useDeleteNode() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (nodeId: string) =>
      apiClient.del(`/api/v1/admin/evolution/nodes/${nodeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
    },
  });
}

export interface ProvisionNodeInput {
  mode: 'local_docker' | 'daytona_sandbox';
  gatewayPort?: number;
  workspacePath?: string;
  employeeName?: string;
  employeeCode?: string;
  employeeEmail?: string;
  githubToken?: string;
}

export function useProvisionNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ProvisionNodeInput) =>
      apiClient.post('/api/v1/admin/evolution/nodes/provision', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
}

export function useRestartNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      apiClient.post(`/api/v1/admin/evolution/nodes/${nodeId}/restart`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
}

export function useAuthorizeNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      apiClient.post(`/api/v1/admin/evolution/nodes/${nodeId}/authorize`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
}

export function useRevokeNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      apiClient.del(`/api/v1/admin/evolution/nodes/${nodeId}/authorize`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'nodes'] }),
  });
}

export function useEvolutionStats() {
  return useQuery<EvolutionStats>({
    queryKey: ['admin', 'evolution', 'stats'],
    queryFn: () => apiClient.get<EvolutionStats>('/api/v1/admin/evolution/stats'),
  });
}

export function useAdminAssetDetail(assetId: string) {
  return useQuery<AssetDetailResponse>({
    queryKey: ['admin', 'asset', assetId],
    queryFn: () =>
      apiClient.get<AssetDetailResponse>(`/api/v1/admin/evolution/assets/${assetId}`),
    enabled: !!assetId,
  });
}

export function useAssetUsage(assetId: string) {
  return useQuery<AssetUsageResponse>({
    queryKey: ['admin', 'evolution', 'asset-usage', assetId],
    queryFn: () => apiClient.get<AssetUsageResponse>(`/api/v1/admin/evolution/assets/${assetId}/usage`),
    enabled: !!assetId,
  });
}

// ---------------------------------------------------------------------------
// Update hooks
// ---------------------------------------------------------------------------

export function useReleases(params?: { page?: number; page_size?: number; platform?: string; channel?: string }) {
  return useQuery<PaginatedResponse<Release>>({
    queryKey: ['admin', 'releases', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Release>>('/api/v1/admin/update/releases', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useUpdateStats() {
  return useQuery<UpdateStats>({
    queryKey: ['admin', 'update', 'stats'],
    queryFn: () => apiClient.get<UpdateStats>('/api/v1/admin/update/stats'),
  });
}

export function useUpdateReports(params?: { page?: number; page_size?: number; status?: string }) {
  return useQuery<PaginatedResponse<UpdateReport>>({
    queryKey: ['admin', 'update', 'reports', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<UpdateReport>>('/api/v1/admin/update/reports', params as Record<string, string | number | boolean | undefined>),
  });
}

// ---------------------------------------------------------------------------
// Telemetry hooks
// ---------------------------------------------------------------------------

export function useTelemetryDashboard() {
  return useQuery<TelemetryDashboard>({
    queryKey: ['admin', 'telemetry', 'dashboard'],
    queryFn: () => apiClient.get<TelemetryDashboard>('/api/v1/admin/telemetry/dashboard'),
  });
}

// ---------------------------------------------------------------------------
// Community hooks
// ---------------------------------------------------------------------------

export function useAdminChannels(params?: { page?: number; page_size?: number }) {
  return useQuery<PaginatedResponse<Channel>>({
    queryKey: ['admin', 'channels', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Channel>>('/api/v1/admin/community/channels', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useAdminPosts(params?: {
  page?: number;
  page_size?: number;
  channel_id?: string;
  status?: string;
}) {
  return useQuery<PaginatedResponse<Post>>({
    queryKey: ['admin', 'posts', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Post>>('/api/v1/admin/community/posts', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useCommunityStats() {
  return useQuery<CommunityStats>({
    queryKey: ['admin', 'community', 'stats'],
    queryFn: () => apiClient.get<CommunityStats>('/api/v1/admin/community/stats'),
  });
}

export function useAdminPostDetail(postId: string, params?: { page?: number; page_size?: number }) {
  return useQuery<PostDetailResponse>({
    queryKey: ['admin', 'post', postId, params],
    queryFn: () =>
      apiClient.get<PostDetailResponse>(
        `/api/v1/admin/community/posts/${postId}`,
        params as Record<string, string | number | boolean | undefined>,
      ),
    enabled: !!postId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useChangeTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, tier }: { userId: string; tier: string }) =>
      apiClient.patch(`/api/v1/admin/auth/users/${userId}/tier`, { tier }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useBanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ban }: { userId: string; ban: boolean }) =>
      apiClient.patch(`/api/v1/admin/auth/users/${userId}/ban`, { banned: ban }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => apiClient.del(`/api/v1/admin/auth/apikeys/${keyId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'apikeys'] });
    },
  });
}

export function useChangeAssetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assetId, status }: { assetId: string; status: string }) =>
      apiClient.patch(`/api/v1/admin/evolution/assets/${assetId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'assets'] });
      qc.invalidateQueries({ queryKey: ['admin', 'asset'] });
      qc.invalidateQueries({ queryKey: ['admin', 'evolution', 'stats'] });
    },
  });
}

export function useChangeSkillStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, status }: { skillId: string; status: string }) =>
      apiClient.patch(`/api/v1/admin/skills/${skillId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'skills'] });
    },
  });
}

export interface PublishSkillInput {
  name: string;
  slug: string;
  description: string;
  version: string;
  category?: string;
  tags?: string[];
  changelog?: string;
  isOfficial?: boolean;
  tarball: File;
}

export function usePublishSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishSkillInput) => {
      const fd = new FormData();
      fd.append('name', input.name);
      fd.append('slug', input.slug);
      fd.append('description', input.description);
      fd.append('version', input.version);
      if (input.category) fd.append('category', input.category);
      fd.append('tags', JSON.stringify(input.tags ?? []));
      if (input.changelog) fd.append('changelog', input.changelog);
      fd.append('isOfficial', input.isOfficial ? '1' : '0');
      fd.append('tarball', input.tarball, input.tarball.name);
      return apiClient.postFormData('/api/v1/admin/skills', fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'skills'] });
    },
  });
}

export interface CreateReleaseInput {
  version: string;
  platform: string;
  channel: string;
  download_url: string;
  size_bytes: number;
  checksum_sha256?: string;
  changelog?: string;
  min_upgrade_version?: string;
  is_critical: boolean;
}

export function useCreateRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReleaseInput) =>
      apiClient.post('/api/v1/admin/update/releases', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'releases'] });
    },
  });
}

export function useDeleteRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (releaseId: string) => apiClient.del(`/api/v1/admin/update/releases/${releaseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'releases'] });
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      apiClient.del(`/api/v1/admin/community/posts/${postId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
      qc.invalidateQueries({ queryKey: ['admin', 'post'] });
      qc.invalidateQueries({ queryKey: ['admin', 'community', 'stats'] });
    },
  });
}

export function useDeleteReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, replyId }: { postId: string; replyId: string }) =>
      apiClient.del(`/api/v1/admin/community/posts/${postId}/replies/${replyId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'post'] });
      qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
      qc.invalidateQueries({ queryKey: ['admin', 'community', 'stats'] });
    },
  });
}

export function useModerateReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, replyId, action }: { postId: string; replyId: string; action: 'markSolution' | 'unmarkSolution' }) =>
      apiClient.patch(`/api/v1/admin/community/posts/${postId}/replies/${replyId}`, { action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'post'] });
    },
  });
}

export function useModeratePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, action, reason }: { postId: string; action: 'hide' | 'lock' | 'unlock' | 'delete' | 'pin' | 'unpin'; reason?: string }) =>
      apiClient.patch(`/api/v1/admin/community/posts/${postId}`, { action, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
      qc.invalidateQueries({ queryKey: ['admin', 'community', 'stats'] });
    },
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Channel>) =>
      apiClient.post('/api/v1/admin/community/channels', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'channels'] });
    },
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) =>
      apiClient.del(`/api/v1/admin/community/channels/${channelId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'channels'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Community — CEO participation (create post, reply, vote)
// ---------------------------------------------------------------------------

export function useCreateCommunityPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { channelId: string; postType: string; title: string; body: string; tags?: string[] }) =>
      apiClient.post('/api/v1/community/posts', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
      qc.invalidateQueries({ queryKey: ['admin', 'community', 'stats'] });
    },
  });
}

export function useCreateCommunityReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, content }: { postId: string; content: string }) =>
      apiClient.post(`/api/v1/community/posts/${postId}/replies`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'post'] });
      qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
    },
  });
}

export function useVoteCommunityPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, direction }: { postId: string; direction: 'upvote' | 'downvote' }) =>
      apiClient.post(`/api/v1/community/posts/${postId}/${direction}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'posts'] });
      qc.invalidateQueries({ queryKey: ['admin', 'post'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Community Feed (public API) — used by NotificationCenter & CommunityFeedPreview
// ---------------------------------------------------------------------------

export interface FeedPost {
  id: string;
  channelId: string;
  authorId: string;
  title: string;
  postType: string;
  score: number;
  upvotes: number;
  downvotes: number;
  replyCount: number;
  isPinned: number;
  isLocked: number;
  isDistilled: number;
  contextData: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface UnreadCountResponse {
  unreadCount: number;
  since: string;
}

const COMMUNITY_LAST_READ_KEY = 'grc_community_last_read';

function getCommunityLastRead(): string {
  const stored = localStorage.getItem(COMMUNITY_LAST_READ_KEY);
  if (stored) return stored;
  // Default: posts in the last 24 hours
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export function setCommunityLastRead(ts?: string): void {
  localStorage.setItem(COMMUNITY_LAST_READ_KEY, ts ?? new Date().toISOString());
}

/** Fetch the public community feed (hot/new/top/relevant). */
export function useCommunityFeed(params?: {
  sort?: 'hot' | 'new' | 'top' | 'relevant';
  limit?: number;
  page?: number;
}) {
  return useQuery<PaginatedResponse<FeedPost>>({
    queryKey: ['community', 'feed', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<FeedPost>>('/api/v1/community/feed', {
        sort: params?.sort ?? 'new',
        limit: params?.limit ?? 5,
        page: params?.page ?? 1,
      }),
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Fetch unread post count from the server, using the localStorage timestamp as
 * the `since` boundary.  The server simply counts topics newer than that date.
 */
export function useCommunityUnreadCount() {
  const since = getCommunityLastRead();
  return useQuery<UnreadCountResponse>({
    queryKey: ['community', 'unread-count'],
    queryFn: () =>
      apiClient.get<UnreadCountResponse>('/api/v1/community/unread-count', { since }),
    staleTime: 60_000, // 60 seconds
    refetchInterval: 120_000, // poll every 2 minutes instead of every render
    retry: false,
  });
}

/** Mark all community notifications as read by updating localStorage. */
export function useMarkCommunityRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString();
      setCommunityLastRead(now);
      return { markedAt: now };
    },
    onSuccess: () => {
      // Invalidate with a wildcard to clear all since-keyed variants
      qc.invalidateQueries({ queryKey: ['community', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['community', 'feed'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export interface PlatformValues {
  content: string;
  contentHash: string;
  updatedBy: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

export function usePlatformValues() {
  return useQuery<{ data: PlatformValues }>({
    queryKey: ['admin', 'platform', 'values'],
    queryFn: () => apiClient.get('/api/v1/admin/platform/values'),
  });
}

export function useUpdatePlatformValues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiClient.put('/api/v1/admin/platform/values', { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'platform', 'values'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Role Template types & hooks
// ---------------------------------------------------------------------------

export interface RoleTemplate {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  department: string | null;
  industry: string | null;
  mode: 'autonomous' | 'copilot';
  isBuiltin: boolean;
  agentsMd: string;
  soulMd: string;
  identityMd: string;
  userMd: string;
  toolsMd: string;
  heartbeatMd: string;
  bootstrapMd: string;
  tasksMd: string;
  createdAt: string;
  updatedAt: string;
}

export interface Employee extends Node {
  roleId: string | null;
  roleMode: 'autonomous' | 'copilot' | null;
  configRevision: number;
  configAppliedRevision: number;
  assignmentVariables: Record<string, string> | null;
  roleName?: string | null;
  roleEmoji?: string | null;
}

export function useRoleTemplates(params?: {
  page?: number;
  page_size?: number;
  industry?: string;
  department?: string;
  mode?: string;
}) {
  // Backend expects 'limit' not 'page_size'
  const apiParams: Record<string, string | number | boolean | undefined> = {
    page: params?.page,
    limit: params?.page_size,
    department: params?.department,
    mode: params?.mode,
    industry: params?.industry,
  };
  return useQuery<PaginatedResponse<RoleTemplate>>({
    queryKey: ['admin', 'roles', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<RoleTemplate>>('/api/v1/admin/roles', apiParams),
  });
}

export function useRoleTemplate(id: string) {
  return useQuery<{ data: RoleTemplate }>({
    queryKey: ['admin', 'role', id],
    queryFn: () => apiClient.get<{ data: RoleTemplate }>(`/api/v1/admin/roles/${id}`),
    enabled: !!id,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<RoleTemplate> & { id: string }) =>
      apiClient.post('/api/v1/admin/roles', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RoleTemplate> }) =>
      apiClient.put(`/api/v1/admin/roles/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
      qc.invalidateQueries({ queryKey: ['admin', 'role'] });
    },
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/admin/roles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}

export function useCloneRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newId, newName }: { id: string; newId: string; newName: string }) =>
      apiClient.post(`/api/v1/admin/roles/${id}/clone`, { new_id: newId, new_name: newName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}

export function useEmployees(params?: { page?: number; page_size?: number }) {
  return useQuery<PaginatedResponse<Employee>>({
    queryKey: ['admin', 'employees', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Employee>>('/api/v1/admin/employees', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, roleId, mode, variables, overrides }: {
      nodeId: string;
      roleId: string;
      mode?: 'autonomous' | 'copilot';
      variables?: Record<string, string>;
      overrides?: Record<string, string>;
    }) =>
      apiClient.post(`/api/v1/admin/nodes/${nodeId}/assign-role`, { role_id: roleId, mode, variables, overrides }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
      qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
    },
  });
}

export function useUnassignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      apiClient.post(`/api/v1/admin/nodes/${nodeId}/unassign-role`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
      qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Task types & hooks
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  taskCode: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'draft' | 'pending' | 'in_progress' | 'blocked' | 'review' | 'approved' | 'completed' | 'cancelled';
  assignedRoleId: string | null;
  assignedNodeId: string | null;
  assignedBy: string | null;
  deadline: string | null;
  dependsOn: string[] | null;
  collaborators: string[] | null;
  deliverables: string[] | null;
  notes: string | null;
  expenseAmount: string | null;
  expenseCurrency: string | null;
  expenseApproved: number | null;
  expenseApprovedBy: string | null;
  expenseApprovedAt: string | null;
  expensePaid: number | null;
  expensePaidBy: string | null;
  expensePaidAt: string | null;
  resultSummary: string | null;
  resultData: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface TaskProgressEntry {
  id: number;
  taskId: string;
  actor: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  details: unknown;
  createdAt: string;
}

export interface TaskStats {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  total: number;
  completionRate: number;
  avgCompletionDays: number;
  pendingExpenses: number;
}

export interface TaskDetailResponse {
  task: Task;
  progress: TaskProgressEntry[];
  comments: TaskComment[];
}

export function useAdminTasks(params?: {
  page?: number;
  page_size?: number;
  status?: string;
  priority?: string;
  category?: string;
  assigned_role_id?: string;
  assigned_by?: string;
}) {
  return useQuery<PaginatedResponse<Task>>({
    queryKey: ['admin', 'tasks', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Task>>('/api/v1/admin/tasks', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useGenerateRolePreview() {
  return useMutation({
    mutationFn: async (data: { company_info?: string; role_description: string; mode: string }) => {
      return apiClient.post<unknown>('/api/v1/admin/roles/generate-preview', data);
    },
  });
}

export function useGenerateStrategyPreview() {
  return useMutation({
    mutationFn: async (data: { industry: string; company_info: string; mode: 'new' | 'update'; update_instruction?: string }) => {
      return apiClient.post<unknown>('/api/v1/admin/strategy/generate-preview', data);
    },
  });
}

export function useTaskDetail(id: string) {
  return useQuery<TaskDetailResponse>({
    queryKey: ['admin', 'task', id],
    queryFn: () => apiClient.get<TaskDetailResponse>(`/api/v1/admin/tasks/${id}`),
    enabled: !!id,
  });
}

export function useTaskStats() {
  return useQuery<TaskStats>({
    queryKey: ['admin', 'tasks', 'stats'],
    queryFn: () => apiClient.get<TaskStats>('/api/v1/admin/tasks/stats'),
  });
}

export function useExpenseQueue(params?: { page?: number; page_size?: number }) {
  return useQuery<PaginatedResponse<Task>>({
    queryKey: ['admin', 'tasks', 'expenses', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Task>>('/api/v1/admin/tasks/expenses', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Task>) =>
      apiClient.post('/api/v1/admin/tasks', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Task> }) =>
      apiClient.put(`/api/v1/admin/tasks/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['admin', 'task'] });
    },
  });
}

export function useChangeTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, resultSummary }: { id: string; status: string; resultSummary?: string }) =>
      apiClient.put(`/api/v1/admin/tasks/${id}/status`, { status, result_summary: resultSummary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['admin', 'task'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tasks', 'stats'] });
    },
  });
}

export function useAddTaskComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, content }: { taskId: string; content: string }) =>
      apiClient.post(`/api/v1/admin/tasks/${taskId}/comment`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'task'] });
    },
  });
}

export function useApproveExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiClient.post(`/api/v1/admin/tasks/${taskId}/expense/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['admin', 'task'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tasks', 'expenses'] });
    },
  });
}

export function useRejectExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) =>
      apiClient.post(`/api/v1/admin/tasks/${taskId}/expense/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['admin', 'task'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tasks', 'expenses'] });
    },
  });
}

export function useMarkExpensePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiClient.post(`/api/v1/admin/tasks/${taskId}/expense/pay`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['admin', 'task'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tasks', 'expenses'] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/admin/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tasks', 'stats'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Strategy types & hooks
// ---------------------------------------------------------------------------

export interface CompanyStrategy {
  id: string;
  companyMission: string | null;
  companyVision: string | null;
  companyValues: string | null;
  shortTermObjectives: unknown;
  midTermObjectives: unknown;
  longTermObjectives: unknown;
  departmentBudgets: Record<string, unknown> | null;
  departmentKpis: Record<string, unknown> | null;
  strategicPriorities: unknown;
  revision: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  companyName: string | null;
  industry: string | null;
  employeeCount: number | null;
  annualRevenueTarget: string | null;
  fiscalYearStart: string | null;
  fiscalYearEnd: string | null;
  currency: string | null;
  language: string | null;
  timezone: string | null;
}

export interface StrategyHistoryEntry {
  id: number;
  strategyId: string;
  revision: number;
  snapshot: unknown;
  changedBy: string | null;
  changeSummary: string | null;
  changedFields: string[] | null;
  createdAt: string;
}

export function useStrategy() {
  return useQuery<{ data: CompanyStrategy }>({
    queryKey: ['admin', 'strategy'],
    queryFn: () => apiClient.get<{ data: CompanyStrategy }>('/api/v1/admin/strategy'),
  });
}

export function useStrategyHistory(params?: { page?: number; page_size?: number }) {
  return useQuery<PaginatedResponse<StrategyHistoryEntry>>({
    queryKey: ['admin', 'strategy', 'history', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<StrategyHistoryEntry>>('/api/v1/admin/strategy/history', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useStrategyDiff(rev1: number, rev2: number) {
  return useQuery<{ data: { rev1: number; rev2: number; snapshot1: unknown; snapshot2: unknown; changedFields: string[] } }>({
    queryKey: ['admin', 'strategy', 'diff', rev1, rev2],
    queryFn: () => apiClient.get(`/api/v1/admin/strategy/diff/${rev1}/${rev2}`),
    enabled: rev1 > 0 && rev2 > 0 && rev1 !== rev2,
  });
}

export function useUpdateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CompanyStrategy>) =>
      apiClient.put('/api/v1/admin/strategy', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'strategy'] });
    },
  });
}

export function useDeployStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post('/api/v1/admin/strategy/deploy', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'strategy'] });
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
      qc.invalidateQueries({ queryKey: ['admin', 'tasks'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Relay types & hooks
// ---------------------------------------------------------------------------

export interface RelayMessage {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  messageType: string;
  subject: string | null;
  payload: unknown;
  priority: string;
  status: string;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface RelayStats {
  stats: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };
}

export function useRelayMessages(params?: {
  page?: number;
  page_size?: number;
  status?: string;
  from_node_id?: string;
  to_node_id?: string;
}) {
  return useQuery<PaginatedResponse<RelayMessage>>({
    queryKey: ['admin', 'relay', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<RelayMessage>>('/api/v1/admin/relay', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useRelayStats() {
  return useQuery<RelayStats>({
    queryKey: ['admin', 'relay', 'stats'],
    queryFn: () => apiClient.get<RelayStats>('/api/v1/admin/relay/stats'),
  });
}

export function useDeleteRelayMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/admin/relay/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'relay'] });
    },
  });
}

export function useCleanupRelayMessages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { before?: string; status?: string }) =>
      apiClient.post('/api/v1/admin/relay/cleanup', params ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'relay'] });
    },
  });
}

// ---------------------------------------------------------------------------
// A2A Gateway types & hooks
// ---------------------------------------------------------------------------

export interface AgentCard {
  nodeId: string;
  agentCard: Record<string, unknown>;
  skills: unknown[];
  capabilities: Record<string, unknown> | null;
  status: 'online' | 'offline' | 'busy';
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCardStats {
  stats: {
    total: number;
    byStatus: Record<string, number>;
  };
}

export function useAgentCards(params?: {
  page?: number;
  page_size?: number;
  status?: string;
}) {
  return useQuery<PaginatedResponse<AgentCard>>({
    queryKey: ['admin', 'a2a', 'agents', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<AgentCard>>('/api/v1/admin/a2a/agents', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useAgentCardDetail(nodeId: string) {
  return useQuery<{ data: AgentCard }>({
    queryKey: ['admin', 'a2a', 'agent', nodeId],
    queryFn: () => apiClient.get<{ data: AgentCard }>(`/api/v1/admin/a2a/agents/${nodeId}`),
    enabled: !!nodeId,
  });
}

export function useAgentCardStats() {
  return useQuery<AgentCardStats>({
    queryKey: ['admin', 'a2a', 'agents', 'stats'],
    queryFn: () => apiClient.get<AgentCardStats>('/api/v1/admin/a2a/agents/stats'),
  });
}

export function useChangeAgentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, status }: { nodeId: string; status: string }) =>
      apiClient.put(`/api/v1/admin/a2a/agents/${nodeId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'a2a'] });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) => apiClient.del(`/api/v1/admin/a2a/agents/${nodeId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'a2a'] });
    },
  });
}

export function useCleanupAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params?: { stale_minutes?: number }) =>
      apiClient.post('/api/v1/admin/a2a/agents/cleanup', params ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'a2a'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Meetings types & hooks
// ---------------------------------------------------------------------------

export interface Meeting {
  id: string;
  title: string;
  type: 'discussion' | 'review' | 'brainstorm' | 'decision';
  status: 'scheduled' | 'active' | 'paused' | 'concluded' | 'cancelled';
  initiatorType: 'human' | 'agent';
  initiationReason: string | null;
  facilitatorNodeId: string;
  contextId: string;
  sharedContext: string | null;
  turnPolicy: string;
  maxDurationMinutes: number;
  agenda: unknown[] | null;
  decisions: unknown[] | null;
  actionItems: unknown[] | null;
  summary: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingParticipant {
  id: number;
  sessionId: string;
  nodeId: string;
  roleId: string;
  displayName: string;
  status: 'invited' | 'joined' | 'speaking' | 'left';
  invitedAt: string;
  joinedAt: string | null;
  leftAt: string | null;
}

export interface MeetingTranscriptEntry {
  id: number;
  sessionId: string;
  speakerNodeId: string;
  speakerRole: string;
  content: string;
  type: string;
  replyToId: number | null;
  agendaItemIndex: number | null;
  metadata: unknown;
  createdAt: string;
}

export interface MeetingDetailResponse {
  data: Meeting & {
    participants: MeetingParticipant[];
    transcript: MeetingTranscriptEntry[];
  };
}

export interface MeetingStats {
  stats: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byInitiatorType: Record<string, number>;
  };
}

export interface MeetingAutoTrigger {
  id: string;
  name: string;
  description: string | null;
  event: string;
  enabled: boolean;
  facilitatorRole: string;
  meetingTemplate: Record<string, unknown>;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
  updatedAt: string;
}

export function useMeetings(params?: {
  page?: number;
  page_size?: number;
  status?: string;
  type?: string;
  initiator_type?: string;
}) {
  return useQuery<PaginatedResponse<Meeting>>({
    queryKey: ['admin', 'meetings', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Meeting>>('/api/v1/admin/a2a/meetings', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useMeetingDetail(id: string) {
  return useQuery<MeetingDetailResponse>({
    queryKey: ['admin', 'meeting', id],
    queryFn: () => apiClient.get<MeetingDetailResponse>(`/api/v1/admin/a2a/meetings/${id}`),
    enabled: !!id,
  });
}

export function useMeetingStats() {
  return useQuery<MeetingStats>({
    queryKey: ['admin', 'meetings', 'stats'],
    queryFn: () => apiClient.get<MeetingStats>('/api/v1/admin/a2a/meetings/stats'),
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.post('/api/v1/admin/a2a/meetings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meetings'] });
    },
  });
}

export function useChangeMeetingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.put(`/api/v1/admin/a2a/meetings/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meetings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'meeting'] });
    },
  });
}

export function useSendMeetingMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiClient.post(`/api/v1/admin/a2a/meetings/${id}/message`, {
        content,
        speaker_role: 'admin',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meeting'] });
    },
  });
}

export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/admin/a2a/meetings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meetings'] });
    },
  });
}

export function useMeetingTriggers(params?: { page?: number; page_size?: number }) {
  return useQuery<PaginatedResponse<MeetingAutoTrigger>>({
    queryKey: ['admin', 'meetings', 'triggers', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<MeetingAutoTrigger>>('/api/v1/admin/a2a/triggers', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useCreateMeetingTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiClient.post('/api/v1/admin/a2a/triggers', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meetings', 'triggers'] });
    },
  });
}

export function useUpdateMeetingTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.put(`/api/v1/admin/a2a/triggers/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meetings', 'triggers'] });
    },
  });
}

export function useDeleteMeetingTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/admin/a2a/triggers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'meetings', 'triggers'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Personal Info (Node Profile)
// ---------------------------------------------------------------------------

export function useUpdateNodeProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, data }: {
      nodeId: string;
      data: { employee_id?: string; employee_name?: string; employee_email?: string };
    }) =>
      apiClient.patch(`/api/v1/admin/evolution/nodes/${nodeId}/profile`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'nodes'] });
    },
  });
}

// ---------------------------------------------------------------------------
// AI Model Keys
// ---------------------------------------------------------------------------

export interface ModelKey {
  id: string;
  category: 'primary' | 'auxiliary';
  name: string;
  provider: string;
  modelName: string;
  apiKeyPrefix: string;
  baseUrl: string | null;
  notes: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelKeyCreateInput {
  category: 'primary' | 'auxiliary';
  name: string;
  provider: string;
  model_name: string;
  api_key: string;
  base_url?: string;
  notes?: string;
}

export interface ModelKeyUpdateInput {
  name?: string;
  provider?: string;
  model_name?: string;
  api_key?: string;
  base_url?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface NodeKeyAssignment {
  nodeId: string;
  primaryKeyId: string | null;
  auxiliaryKeyId: string | null;
  primaryKey: { id: string; name: string; provider: string; modelName: string; isActive: boolean } | null;
  auxiliaryKey: { id: string; name: string; provider: string; modelName: string; isActive: boolean } | null;
}

export function useModelKeys(category?: string, provider?: string) {
  return useQuery<{ keys: ModelKey[]; total: number }>({
    queryKey: ['model-keys', category, provider],
    queryFn: () => apiClient.get('/api/v1/admin/model-keys', { category, provider }),
  });
}

export function useModelKey(id: string) {
  return useQuery<{ key: ModelKey }>({
    queryKey: ['model-keys', id],
    queryFn: () => apiClient.get(`/api/v1/admin/model-keys/${id}`),
    enabled: !!id,
  });
}

export function useCreateModelKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ModelKeyCreateInput) =>
      apiClient.post('/api/v1/admin/model-keys', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['model-keys'] }),
  });
}

export function useUpdateModelKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ModelKeyUpdateInput }) =>
      apiClient.put(`/api/v1/admin/model-keys/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['model-keys'] }),
  });
}

export function useDeleteModelKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.del(`/api/v1/admin/model-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['model-keys'] }),
  });
}

export function useAssignKeysToNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, primaryKeyId, auxiliaryKeyId }: {
      nodeId: string;
      primaryKeyId?: string | null;
      auxiliaryKeyId?: string | null;
    }) => apiClient.post(`/api/v1/admin/nodes/${nodeId}/assign-keys`, {
      primary_key_id: primaryKeyId,
      auxiliary_key_id: auxiliaryKeyId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
      qc.invalidateQueries({ queryKey: ['node-keys'] });
      qc.invalidateQueries({ queryKey: ['admin', 'model-keys'] });
    },
  });
}

export function useUnassignKeysFromNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      apiClient.post(`/api/v1/admin/nodes/${nodeId}/unassign-keys`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] });
      qc.invalidateQueries({ queryKey: ['node-keys'] });
      qc.invalidateQueries({ queryKey: ['admin', 'model-keys'] });
    },
  });
}

export function useNodeAssignedKeys(nodeId: string) {
  return useQuery<NodeKeyAssignment>({
    queryKey: ['node-keys', nodeId],
    queryFn: () => apiClient.get(`/api/v1/admin/nodes/${nodeId}/assigned-keys`),
    enabled: !!nodeId,
  });
}
