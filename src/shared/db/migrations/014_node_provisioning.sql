-- 014_node_provisioning.sql
-- Add provisioning columns to nodes table for Docker / Daytona sandbox support

ALTER TABLE `nodes`
  ADD COLUMN `provisioning_mode` ENUM('local_docker', 'daytona_sandbox') NULL AFTER `key_config_json`,
  ADD COLUMN `container_id` VARCHAR(255) NULL AFTER `provisioning_mode`,
  ADD COLUMN `sandbox_id` VARCHAR(255) NULL AFTER `container_id`,
  ADD COLUMN `gateway_url` VARCHAR(500) NULL AFTER `sandbox_id`,
  ADD COLUMN `gateway_port` INT NULL AFTER `gateway_url`,
  ADD COLUMN `workspace_path` VARCHAR(500) NULL AFTER `gateway_port`;
