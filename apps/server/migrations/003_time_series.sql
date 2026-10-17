-- Ordinary PostgreSQL remains supported for development; Tiger Data enables
-- time partitioning. All unique keys include the captured_at partition key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('sword_samples'::regclass, by_range('captured_at'), if_not_exists => TRUE);
    PERFORM create_hypertable('camera_samples'::regclass, by_range('captured_at'), if_not_exists => TRUE);
  END IF;
END $$;
