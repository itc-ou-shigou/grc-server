-- 032_expense_details.sql
-- Add expense detail columns for vendor info, bank details, invoice, and business justification.

ALTER TABLE tasks
  ADD COLUMN vendor_name         VARCHAR(255) DEFAULT NULL AFTER expense_paid_at,
  ADD COLUMN vendor_type         VARCHAR(50)  DEFAULT NULL AFTER vendor_name,
  ADD COLUMN product_service     VARCHAR(500) DEFAULT NULL AFTER vendor_type,
  ADD COLUMN expense_description TEXT         DEFAULT NULL AFTER product_service,
  ADD COLUMN payment_method      VARCHAR(50)  DEFAULT NULL AFTER expense_description,
  ADD COLUMN bank_name           VARCHAR(255) DEFAULT NULL AFTER payment_method,
  ADD COLUMN bank_branch         VARCHAR(255) DEFAULT NULL AFTER bank_name,
  ADD COLUMN bank_account_type   VARCHAR(50)  DEFAULT NULL AFTER bank_branch,
  ADD COLUMN bank_account_number VARCHAR(100) DEFAULT NULL AFTER bank_account_type,
  ADD COLUMN bank_account_name   VARCHAR(255) DEFAULT NULL AFTER bank_account_number,
  ADD COLUMN invoice_number      VARCHAR(100) DEFAULT NULL AFTER bank_account_name,
  ADD COLUMN invoice_date        TIMESTAMP    DEFAULT NULL AFTER invoice_number,
  ADD COLUMN due_date            TIMESTAMP    DEFAULT NULL AFTER invoice_date,
  ADD COLUMN business_purpose    TEXT         DEFAULT NULL AFTER due_date,
  ADD COLUMN expected_roi        TEXT         DEFAULT NULL AFTER business_purpose;
