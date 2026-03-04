-- ─────────────────────────────────────────────────
-- GRC Database — Initial Schema (MySQL 8.0)
-- Authoritative source: ADR-002 (to-C 全球资源中心 架構設計)
--
-- NOTE: This schema is already deployed to 13.78.81.86:18306/grc-server
-- This file serves as documentation and for local Docker development.
-- ─────────────────────────────────────────────────

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ══════════════════════════════════════════════════
-- Module: Auth
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `provider` VARCHAR(20) NOT NULL COMMENT 'github | google | anonymous',
  `provider_id` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) DEFAULT NULL,
  `avatar_url` TEXT DEFAULT NULL,
  `email` VARCHAR(255) DEFAULT NULL,
  `tier` VARCHAR(20) NOT NULL DEFAULT 'free' COMMENT 'free | contributor | pro',
  `promoted_asset_count` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider` (`provider`, `provider_id`),
  INDEX `idx_tier` (`tier`),
  INDEX `idx_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `user_id` CHAR(36) NOT NULL,
  `key_hash` VARCHAR(64) NOT NULL COMMENT 'SHA-256 of key',
  `name` VARCHAR(255) DEFAULT NULL,
  `scopes` JSON DEFAULT NULL COMMENT 'Permission scope array',
  `last_used_at` TIMESTAMP NULL DEFAULT NULL,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_key_hash` (`key_hash`),
  INDEX `idx_user_id` (`user_id`),
  CONSTRAINT `fk_apikeys_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `user_id` CHAR(36) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `revoked_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_token_hash` (`token_hash`),
  INDEX `idx_user_id` (`user_id`),
  CONSTRAINT `fk_refresh_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════
-- Module: Node Management
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `nodes` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `node_id` VARCHAR(255) NOT NULL COMMENT 'A2A node_id (node_xxxxxxxxxxxx)',
  `user_id` CHAR(36) NULL DEFAULT NULL,
  `display_name` VARCHAR(255) DEFAULT NULL,
  `platform` VARCHAR(50) DEFAULT NULL COMMENT 'win | mac | linux',
  `winclaw_version` VARCHAR(50) DEFAULT NULL,
  `last_heartbeat` TIMESTAMP NULL DEFAULT NULL,
  `capabilities` JSON DEFAULT NULL,
  `gene_count` INT NOT NULL DEFAULT 0,
  `capsule_count` INT NOT NULL DEFAULT 0,
  `env_fingerprint` VARCHAR(64) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_node_id` (`node_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_last_heartbeat` (`last_heartbeat`),
  CONSTRAINT `fk_nodes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════
-- Module: ClawHub+ (Skill Marketplace)
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `skills` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `slug` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `author_id` CHAR(36) NULL DEFAULT NULL,
  `category` VARCHAR(100) DEFAULT NULL,
  `latest_version` VARCHAR(50) DEFAULT NULL,
  `download_count` INT NOT NULL DEFAULT 0,
  `rating_avg` FLOAT NOT NULL DEFAULT 0,
  `rating_count` INT NOT NULL DEFAULT 0,
  `tags` JSON DEFAULT NULL COMMENT 'Tag array',
  `is_official` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_slug` (`slug`),
  INDEX `idx_author_id` (`author_id`),
  INDEX `idx_category` (`category`),
  INDEX `idx_download_count` (`download_count`),
  INDEX `idx_status` (`status`),
  FULLTEXT INDEX `ft_name_desc` (`name`, `description`),
  CONSTRAINT `fk_skills_author` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `skill_versions` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `skill_id` CHAR(36) NOT NULL,
  `version` VARCHAR(50) NOT NULL,
  `checksum_sha256` VARCHAR(64) DEFAULT NULL,
  `tarball_url` TEXT DEFAULT NULL,
  `tarball_size` INT DEFAULT NULL,
  `min_winclaw_version` VARCHAR(50) DEFAULT NULL,
  `changelog` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_skill_version` (`skill_id`, `version`),
  INDEX `idx_skill_id` (`skill_id`),
  CONSTRAINT `fk_skillver_skill` FOREIGN KEY (`skill_id`) REFERENCES `skills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `skill_ratings` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `skill_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `rating` TINYINT NOT NULL COMMENT '1-5 stars',
  `review` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_skill_user` (`skill_id`, `user_id`),
  INDEX `idx_skill_id` (`skill_id`),
  INDEX `idx_user_id` (`user_id`),
  CONSTRAINT `fk_skillrat_skill` FOREIGN KEY (`skill_id`) REFERENCES `skills` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_skillrat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `skill_downloads` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `skill_id` CHAR(36) NOT NULL,
  `version` VARCHAR(50) DEFAULT NULL,
  `node_id` VARCHAR(255) DEFAULT NULL,
  `user_id` CHAR(36) NULL DEFAULT NULL,
  `ip_hash` VARCHAR(64) DEFAULT NULL COMMENT 'SHA-256 hashed IP for dedup',
  `downloaded_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_skill_id` (`skill_id`),
  INDEX `idx_downloaded_at` (`downloaded_at`),
  INDEX `idx_node_id` (`node_id`),
  CONSTRAINT `fk_skilldl_skill` FOREIGN KEY (`skill_id`) REFERENCES `skills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════
-- Module: Evolution Pool
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `genes` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `asset_id` VARCHAR(255) NOT NULL,
  `node_id` VARCHAR(255) DEFAULT NULL,
  `user_id` CHAR(36) NULL DEFAULT NULL,
  `category` VARCHAR(50) DEFAULT NULL COMMENT 'repair | optimize | innovate | harden',
  `signals_match` JSON DEFAULT NULL,
  `strategy` JSON DEFAULT NULL,
  `constraints_data` JSON DEFAULT NULL COMMENT 'constraints is a MySQL reserved word',
  `validation` JSON DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `use_count` INT NOT NULL DEFAULT 0,
  `success_rate` FLOAT NOT NULL DEFAULT 0,
  `fail_count` INT NOT NULL DEFAULT 0,
  `signature` VARCHAR(128) DEFAULT NULL,
  `chain_id` VARCHAR(255) DEFAULT NULL,
  `content_hash` VARCHAR(64) DEFAULT NULL,
  `schema_version` INT NOT NULL DEFAULT 1,
  `safety_score` FLOAT NULL DEFAULT NULL COMMENT 'Content Safety scan score',
  `promoted_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_id` (`asset_id`),
  INDEX `idx_node_id` (`node_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_category` (`category`),
  INDEX `idx_use_count` (`use_count`),
  INDEX `idx_success_rate` (`success_rate`),
  INDEX `idx_content_hash` (`content_hash`),
  CONSTRAINT `fk_genes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `capsules` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `asset_id` VARCHAR(255) NOT NULL,
  `gene_asset_id` VARCHAR(255) NULL DEFAULT NULL,
  `node_id` VARCHAR(255) DEFAULT NULL,
  `user_id` CHAR(36) NULL DEFAULT NULL,
  `trigger_data` JSON DEFAULT NULL COMMENT 'trigger is a MySQL reserved word',
  `summary` TEXT DEFAULT NULL,
  `confidence` FLOAT DEFAULT NULL,
  `success_streak` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `use_count` INT NOT NULL DEFAULT 0,
  `signature` VARCHAR(128) DEFAULT NULL,
  `chain_id` VARCHAR(255) DEFAULT NULL,
  `content_hash` VARCHAR(64) DEFAULT NULL,
  `schema_version` INT NOT NULL DEFAULT 1,
  `safety_score` FLOAT NULL DEFAULT NULL,
  `promoted_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_id` (`asset_id`),
  INDEX `idx_gene_asset_id` (`gene_asset_id`),
  INDEX `idx_node_id` (`node_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_content_hash` (`content_hash`),
  CONSTRAINT `fk_capsules_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `asset_reports` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `asset_id` VARCHAR(255) NOT NULL,
  `asset_type` VARCHAR(10) NOT NULL COMMENT 'gene | capsule',
  `reporter_node_id` VARCHAR(255) DEFAULT NULL,
  `reporter_user_id` CHAR(36) NULL DEFAULT NULL,
  `report_type` VARCHAR(20) NOT NULL COMMENT 'success | failure | abuse',
  `details` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_asset_id` (`asset_id`),
  INDEX `idx_report_type` (`report_type`),
  INDEX `idx_reporter_node` (`reporter_node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `evolution_events` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `event_type` VARCHAR(30) NOT NULL COMMENT 'publish | fetch | report | decision | revoke | promote',
  `asset_id` VARCHAR(255) DEFAULT NULL,
  `asset_type` VARCHAR(10) DEFAULT NULL COMMENT 'gene | capsule',
  `node_id` VARCHAR(255) DEFAULT NULL,
  `user_id` CHAR(36) NULL DEFAULT NULL,
  `details` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_event_type` (`event_type`),
  INDEX `idx_asset_id` (`asset_id`),
  INDEX `idx_node_id` (`node_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════
-- Module: Update Gateway
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `client_releases` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `version` VARCHAR(50) NOT NULL,
  `channel` VARCHAR(20) NOT NULL DEFAULT 'stable',
  `platform` VARCHAR(20) NOT NULL COMMENT 'win | mac | linux | npm',
  `download_url` TEXT DEFAULT NULL,
  `checksum_sha256` VARCHAR(64) DEFAULT NULL,
  `size_bytes` BIGINT DEFAULT NULL,
  `changelog` TEXT DEFAULT NULL,
  `min_upgrade_version` VARCHAR(50) DEFAULT NULL,
  `is_critical` TINYINT(1) NOT NULL DEFAULT 0,
  `published_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_version_platform` (`version`, `platform`, `channel`),
  INDEX `idx_channel` (`channel`),
  INDEX `idx_platform` (`platform`),
  INDEX `idx_published_at` (`published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `update_reports` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `node_id` VARCHAR(255) DEFAULT NULL,
  `from_version` VARCHAR(50) DEFAULT NULL,
  `to_version` VARCHAR(50) DEFAULT NULL,
  `platform` VARCHAR(20) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL COMMENT 'success | failed | rollback',
  `error_message` TEXT DEFAULT NULL,
  `duration_ms` INT DEFAULT NULL,
  `reported_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_node_id` (`node_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_to_version` (`to_version`),
  INDEX `idx_reported_at` (`reported_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════
-- Module: Telemetry
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `telemetry_reports` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `node_id` VARCHAR(255) NOT NULL,
  `anonymous_id` VARCHAR(255) DEFAULT NULL,
  `report_date` DATE NOT NULL,
  `skill_calls` JSON DEFAULT NULL COMMENT '{ "skill_name": call_count }',
  `gene_usage` JSON DEFAULT NULL,
  `capsule_usage` JSON DEFAULT NULL,
  `platform` VARCHAR(50) DEFAULT NULL,
  `winclaw_version` VARCHAR(50) DEFAULT NULL,
  `session_count` INT NOT NULL DEFAULT 0,
  `active_minutes` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_node_date` (`node_id`, `report_date`),
  INDEX `idx_report_date` (`report_date`),
  INDEX `idx_winclaw_version` (`winclaw_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════
-- Module: Community (Phase 3)
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `community_channels` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `name` VARCHAR(100) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `creator_node_id` VARCHAR(255) NULL DEFAULT NULL COMMENT 'NULL = system preset channel',
  `is_system` TINYINT(1) NOT NULL DEFAULT 0,
  `subscriber_count` INT NOT NULL DEFAULT 0,
  `post_count` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_channel_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `community_topics` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `channel_id` CHAR(36) NOT NULL,
  `author_node_id` VARCHAR(255) NOT NULL,
  `post_type` VARCHAR(20) NOT NULL DEFAULT 'discussion' COMMENT 'problem | solution | evolution | experience | alert | discussion',
  `title` VARCHAR(500) NOT NULL,
  `content` TEXT DEFAULT NULL,
  `context_data` JSON DEFAULT NULL,
  `score` INT NOT NULL DEFAULT 0,
  `is_distilled` TINYINT(1) NOT NULL DEFAULT 0,
  `reply_count` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_channel` (`channel_id`),
  INDEX `idx_author_node` (`author_node_id`),
  INDEX `idx_post_type` (`post_type`),
  INDEX `idx_score` (`score`),
  INDEX `idx_created_at` (`created_at`),
  CONSTRAINT `fk_topics_channel` FOREIGN KEY (`channel_id`) REFERENCES `community_channels` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `community_replies` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `topic_id` CHAR(36) NOT NULL,
  `author_node_id` VARCHAR(255) NOT NULL,
  `content` TEXT NOT NULL,
  `score` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_topic_id` (`topic_id`),
  INDEX `idx_author_node` (`author_node_id`),
  CONSTRAINT `fk_replies_topic` FOREIGN KEY (`topic_id`) REFERENCES `community_topics` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `community_votes` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `node_id` VARCHAR(255) NOT NULL,
  `target_type` VARCHAR(10) NOT NULL COMMENT 'post | reply',
  `target_id` CHAR(36) NOT NULL,
  `direction` TINYINT NOT NULL COMMENT '+1 = upvote, -1 = downvote',
  `weight` FLOAT NOT NULL DEFAULT 1.0 COMMENT 'Weighted voting',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_node_target` (`node_id`, `target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `community_subscriptions` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `node_id` VARCHAR(255) NOT NULL,
  `channel_id` CHAR(36) NOT NULL,
  `subscribed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_node_channel` (`node_id`, `channel_id`),
  CONSTRAINT `fk_subs_channel` FOREIGN KEY (`channel_id`) REFERENCES `community_channels` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `community_follows` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `follower_node_id` VARCHAR(255) NOT NULL,
  `following_node_id` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_follow_pair` (`follower_node_id`, `following_node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ══════════════════════════════════════════════════
-- Default Data: Community Channels
-- ══════════════════════════════════════════════════

INSERT IGNORE INTO `community_channels` (`id`, `name`, `display_name`, `description`, `is_system`) VALUES
  (UUID(), 'evolution-showcase', 'Evolution Showcase', 'Share your successful evolution results', 1),
  (UUID(), 'problem-solving', 'Problem Solving', 'Discuss problems and collaborate on solutions', 1),
  (UUID(), 'skill-exchange', 'Skill Exchange', 'Share and discover useful skills', 1),
  (UUID(), 'bug-reports', 'Bug Reports', 'Report bugs and track fixes', 1),
  (UUID(), 'announcements', 'Announcements', 'Official announcements from the GRC team', 1);

-- ══════════════════════════════════════════════════
-- Module: Platform
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `platform_values` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `content` MEDIUMTEXT NOT NULL DEFAULT (''),
  `content_hash` VARCHAR(64) NOT NULL DEFAULT '',
  `updated_by` CHAR(36) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
