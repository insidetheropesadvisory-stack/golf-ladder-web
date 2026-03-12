-- Badge system: user_badges table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS user_badges (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_slug TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge_slug)
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);

-- Index for querying which users have a specific badge
CREATE INDEX IF NOT EXISTS idx_user_badges_slug ON user_badges(badge_slug);

-- Enable RLS (service role bypasses, so API routes work fine)
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own badges (and others' for match cards)
CREATE POLICY "Anyone can read badges"
  ON user_badges FOR SELECT
  USING (true);

-- Only service role can insert/update/delete (via API routes)
CREATE POLICY "Service role manages badges"
  ON user_badges FOR ALL
  USING (auth.role() = 'service_role');
