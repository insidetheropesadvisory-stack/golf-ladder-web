-- Pool ratings migration
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS pool_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES pool_listings(id) ON DELETE CASCADE,
  rater_id uuid NOT NULL REFERENCES auth.users(id),
  rated_id uuid NOT NULL REFERENCES auth.users(id),
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(listing_id, rater_id, rated_id)
);

ALTER TABLE pool_ratings ENABLE ROW LEVEL SECURITY;

-- Anyone can view ratings (needed to show on applications)
CREATE POLICY "Anyone can view pool ratings" ON pool_ratings
  FOR SELECT USING (true);

-- Rater can insert their own ratings
CREATE POLICY "Users can create pool ratings" ON pool_ratings
  FOR INSERT WITH CHECK (rater_id = auth.uid());

CREATE INDEX idx_pool_ratings_rated ON pool_ratings(rated_id);
CREATE INDEX idx_pool_ratings_listing ON pool_ratings(listing_id);
