SELECT 'CREATE DATABASE sentinel_delivery'
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = 'sentinel_delivery'
)\gexec
