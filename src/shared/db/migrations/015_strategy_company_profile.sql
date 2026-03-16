-- Migration 015: Add company profile fields to company_strategy
ALTER TABLE `company_strategy`
  ADD COLUMN `company_name` VARCHAR(255) DEFAULT NULL AFTER `id`,
  ADD COLUMN `industry` VARCHAR(255) DEFAULT NULL AFTER `company_name`,
  ADD COLUMN `employee_count` INT DEFAULT NULL AFTER `industry`,
  ADD COLUMN `annual_revenue_target` VARCHAR(100) DEFAULT NULL AFTER `employee_count`,
  ADD COLUMN `fiscal_year_start` VARCHAR(50) DEFAULT NULL AFTER `annual_revenue_target`,
  ADD COLUMN `fiscal_year_end` VARCHAR(50) DEFAULT NULL AFTER `fiscal_year_start`,
  ADD COLUMN `currency` VARCHAR(10) DEFAULT 'JPY' AFTER `fiscal_year_end`,
  ADD COLUMN `language` VARCHAR(50) DEFAULT 'ja' AFTER `currency`,
  ADD COLUMN `timezone` VARCHAR(50) DEFAULT 'Asia/Tokyo' AFTER `language`;
