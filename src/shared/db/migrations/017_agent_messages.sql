-- 017: Agent Direct Messages table for A2A inter-agent communication
CREATE TABLE IF NOT EXISTS agent_messages (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  from_node_id VARCHAR(255) NOT NULL,
  to_node_id VARCHAR(255) NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  subject VARCHAR(500),
  payload JSON,
  `read` TINYINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent_msg_to (to_node_id),
  INDEX idx_agent_msg_from (from_node_id),
  INDEX idx_agent_msg_created (created_at)
);
