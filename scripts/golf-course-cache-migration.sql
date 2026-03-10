-- Cache for golf course API responses to reduce external API calls
CREATE TABLE IF NOT EXISTS golf_course_cache (
  cache_key text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

-- Index for cleanup of expired entries
CREATE INDEX IF NOT EXISTS idx_golf_course_cache_expires ON golf_course_cache (expires_at);

-- Allow service role full access (no RLS needed, server-only table)
ALTER TABLE golf_course_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on golf_course_cache"
  ON golf_course_cache FOR ALL
  USING (true)
  WITH CHECK (true);
