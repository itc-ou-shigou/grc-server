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
  createdAt: string;
  updatedAt: string;
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
  return useQuery<PaginatedResponse<Asset>>({
    queryKey: ['admin', 'assets', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Asset>>('/api/v1/admin/evolution/assets', params as Record<string, string | number | boolean | undefined>),
  });
}

export function useAdminNodes(params?: { page?: number; page_size?: number }) {
  return useQuery<PaginatedResponse<Node>>({
    queryKey: ['admin', 'nodes', params],
    queryFn: () =>
      apiClient.get<PaginatedResponse<Node>>('/api/v1/admin/evolution/nodes', params as Record<string, string | number | boolean | undefined>),
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
