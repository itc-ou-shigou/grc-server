-- 016: Role Job Descriptions table for A2A collaboration
-- Stores structured JD data per role: summary, responsibilities, expertise, reporting lines

CREATE TABLE IF NOT EXISTS role_job_descriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  summary TEXT NOT NULL,
  responsibilities TEXT NOT NULL,
  expertise JSON DEFAULT NULL,
  reports_to VARCHAR(50) DEFAULT NULL,
  collaboration JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (role_id) REFERENCES role_templates(id) ON DELETE CASCADE
);
