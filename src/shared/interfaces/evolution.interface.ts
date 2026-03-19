/**
 * IEvolutionService — Evolution Pool module interface.
 *
 * Exposes Gene/Capsule operations for cross-module access.
 * Used by: Community module (knowledge distillation → publish gene candidate).
 */

export type AssetStatus = "pending" | "approved" | "promoted" | "quarantined";
export type AssetType = "gene" | "capsule";

export interface IEvolutionAsset {
  id: string;
  assetId: string;
  type: AssetType;
  nodeId: string;
  userId?: string;
  category?: string;
  status: AssetStatus;
  signalsMatch: string[];
  contentHash: string;
  signature?: string;
  useCount: number;
  failCount: number;
  successRate: number;
  safetyScore?: number;
  chainId?: string;
  schemaVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEvolutionSearchParams {
  signals?: string[];
  status?: AssetStatus;
  type?: AssetType;
  geneAssetId?: string;
  limit?: number;
  offset?: number;
}

export interface IEvolutionService {
  /** Publish a new gene or capsule */
  publishAsset(params: {
    nodeId: string;
    userId?: string;
    assetType: AssetType;
    assetId: string;
    category?: string;
    contentHash: string;
    signalsMatch?: unknown;
    constraintsData?: unknown;
    strategy?: unknown;
    validation?: unknown;
    schemaVersion?: string;
    signature?: string;
  }): Promise<IEvolutionAsset>;

  /** Fetch asset by ID or content hash */
  fetchAsset(
    assetIdOrHash: string,
  ): Promise<IEvolutionAsset | null>;

  /** Search assets with filters */
  searchAssets(
    params: IEvolutionSearchParams,
  ): Promise<{ assets: IEvolutionAsset[]; total: number }>;

  /** Record usage and update success rate */
  reportUsage(
    assetId: string,
    success: boolean,
  ): Promise<void>;

  /** Get trending assets (most used in last 7 days) */
  getTrending(limit?: number): Promise<IEvolutionAsset[]>;

  /** Update asset status (admin or auto-promotion) */
  updateStatus(
    assetId: string,
    status: AssetStatus,
    reason?: string,
  ): Promise<void>;
}
