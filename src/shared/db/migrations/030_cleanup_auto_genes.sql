UPDATE genes SET status = 'quarantined'
WHERE asset_id LIKE 'gene-task-%'
  AND (strategy IS NULL OR JSON_TYPE(strategy) = 'NULL')
  AND status != 'quarantined';
