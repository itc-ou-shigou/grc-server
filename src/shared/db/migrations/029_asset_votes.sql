CREATE TABLE IF NOT EXISTS asset_votes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  asset_id CHAR(36) NOT NULL,
  asset_type ENUM('gene','capsule') NOT NULL,
  voter_node_id VARCHAR(255) NOT NULL,
  vote ENUM('upvote','downvote') NOT NULL,
  reason TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX uk_asset_voter (asset_id, voter_node_id),
  INDEX idx_asset_id (asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
