-- 008_a2a_gateway.sql
-- Agent Card Registry for A2A Protocol peer discovery

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS `agent_cards` (
  `node_id` CHAR(36) NOT NULL,
  `agent_card` JSON NOT NULL COMMENT 'Complete Agent Card JSON (A2A Protocol spec)',
  `skills` JSON DEFAULT NULL COMMENT 'Skill list (extracted for searchability)',
  `capabilities` JSON DEFAULT NULL COMMENT 'Capability flags (streaming, meetings, etc.)',
  `last_seen_at` DATETIME DEFAULT NULL COMMENT 'Last communication timestamp',
  `status` ENUM('online','offline','busy') NOT NULL DEFAULT 'offline',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`node_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_last_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
