ALTER TABLE nodes
  ADD COLUMN api_key_id CHAR(36) NULL AFTER key_config_json,
  ADD COLUMN api_key_authorized TINYINT(1) NOT NULL DEFAULT 0 AFTER api_key_id,
  ADD INDEX idx_api_key_id (api_key_id);
