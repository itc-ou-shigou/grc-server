-- 009_meetings.sql
-- Meeting system tables: sessions, participants, transcript, auto triggers

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- Meeting Sessions
CREATE TABLE IF NOT EXISTS `meeting_sessions` (
  `id` CHAR(36) NOT NULL,
  `title` VARCHAR(500) NOT NULL,
  `type` ENUM('discussion','review','brainstorm','decision') NOT NULL DEFAULT 'discussion',
  `status` ENUM('scheduled','active','paused','concluded','cancelled') NOT NULL DEFAULT 'scheduled',
  `initiator_type` ENUM('human','agent') NOT NULL DEFAULT 'human',
  `initiation_reason` TEXT DEFAULT NULL COMMENT 'Reason when initiated by agent',
  `facilitator_node_id` VARCHAR(255) NOT NULL,
  `context_id` CHAR(36) NOT NULL COMMENT 'A2A contextId for this meeting',
  `shared_context` TEXT DEFAULT NULL COMMENT 'Shared context for all participants',
  `turn_policy` VARCHAR(50) NOT NULL DEFAULT 'facilitator-directed',
  `max_duration_minutes` INT NOT NULL DEFAULT 60,
  `agenda` JSON DEFAULT NULL COMMENT 'AgendaItem[]',
  `decisions` JSON DEFAULT NULL COMMENT 'Decision[] (set when meeting concludes)',
  `action_items` JSON DEFAULT NULL COMMENT 'ActionItem[] (set when meeting concludes)',
  `summary` TEXT DEFAULT NULL COMMENT 'AI-generated meeting summary',
  `scheduled_at` DATETIME DEFAULT NULL,
  `started_at` DATETIME DEFAULT NULL,
  `ended_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_scheduled` (`scheduled_at`),
  INDEX `idx_initiator_type` (`initiator_type`),
  INDEX `idx_context_id` (`context_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Meeting Participants
CREATE TABLE IF NOT EXISTS `meeting_participants` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `node_id` VARCHAR(255) NOT NULL,
  `role_id` VARCHAR(100) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `status` ENUM('invited','joined','speaking','left') NOT NULL DEFAULT 'invited',
  `invited_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `joined_at` DATETIME DEFAULT NULL,
  `left_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_session_node` (`session_id`, `node_id`),
  INDEX `idx_session` (`session_id`),
  INDEX `idx_node` (`node_id`),
  CONSTRAINT `fk_mp_session` FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Meeting Transcript (speech log)
CREATE TABLE IF NOT EXISTS `meeting_transcript` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `speaker_node_id` VARCHAR(255) NOT NULL,
  `speaker_role` VARCHAR(100) NOT NULL,
  `content` TEXT NOT NULL,
  `type` ENUM('statement','question','answer','proposal','objection','agreement','system') NOT NULL DEFAULT 'statement',
  `reply_to_id` BIGINT DEFAULT NULL COMMENT 'ID of the message being replied to',
  `agenda_item_index` INT DEFAULT NULL COMMENT 'Current agenda item index',
  `metadata` JSON DEFAULT NULL COMMENT 'Additional metadata',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_session_time` (`session_id`, `created_at`),
  INDEX `idx_speaker` (`speaker_node_id`),
  CONSTRAINT `fk_mt_session` FOREIGN KEY (`session_id`) REFERENCES `meeting_sessions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Meeting Auto Triggers
CREATE TABLE IF NOT EXISTS `meeting_auto_triggers` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `event` VARCHAR(255) NOT NULL COMMENT 'Event pattern: strategy.deployed, security.critical, cron:...',
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `facilitator_role` VARCHAR(100) NOT NULL COMMENT 'Role ID of the facilitator',
  `meeting_template` JSON NOT NULL COMMENT 'MeetingSession template (JSON)',
  `last_triggered_at` DATETIME DEFAULT NULL,
  `trigger_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_event` (`event`),
  INDEX `idx_enabled` (`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
