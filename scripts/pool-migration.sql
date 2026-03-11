-- Pool feature migration
-- Run this in Supabase SQL Editor

-- 1. Add city, state, latitude, longitude to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longitude double precision;

-- 2. Pool listings table
CREATE TABLE IF NOT EXISTS pool_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id),
  course_name text NOT NULL,
  golf_course_api_id text,
  round_time timestamptz NOT NULL,
  total_slots integer NOT NULL CHECK (total_slots >= 1 AND total_slots <= 3),
  guest_fee numeric(8,2),
  selected_tee text,
  notes text,
  auto_accept boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'expired', 'cancelled')),
  latitude double precision,
  longitude double precision,
  city text,
  state text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pool_listings ENABLE ROW LEVEL SECURITY;

-- Everyone can view open listings
CREATE POLICY "Anyone can view open pool listings" ON pool_listings
  FOR SELECT USING (true);

-- Creator can insert
CREATE POLICY "Users can create pool listings" ON pool_listings
  FOR INSERT WITH CHECK (creator_id = auth.uid());

-- Creator can update their own
CREATE POLICY "Users can update own pool listings" ON pool_listings
  FOR UPDATE USING (creator_id = auth.uid());

-- Creator can delete their own
CREATE POLICY "Users can delete own pool listings" ON pool_listings
  FOR DELETE USING (creator_id = auth.uid());

CREATE INDEX idx_pool_listings_status ON pool_listings(status);
CREATE INDEX idx_pool_listings_creator ON pool_listings(creator_id);
CREATE INDEX idx_pool_listings_round_time ON pool_listings(round_time);

-- 3. Committed players (pre-added by creator, not applying)
CREATE TABLE IF NOT EXISTS pool_committed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES pool_listings(id) ON DELETE CASCADE,
  player_id uuid REFERENCES auth.users(id),
  player_name text,
  added_at timestamptz DEFAULT now(),
  UNIQUE(listing_id, player_id)
);

ALTER TABLE pool_committed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view committed players" ON pool_committed
  FOR SELECT USING (true);

CREATE POLICY "Listing creator can manage committed" ON pool_committed
  FOR ALL USING (
    listing_id IN (SELECT id FROM pool_listings WHERE creator_id = auth.uid())
  );

-- 4. Pool applications (players requesting to join)
CREATE TABLE IF NOT EXISTS pool_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES pool_listings(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES auth.users(id),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'denied')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(listing_id, applicant_id)
);

ALTER TABLE pool_applications ENABLE ROW LEVEL SECURITY;

-- Applicants can see their own applications; listing creator can see all for their listings
CREATE POLICY "Users can view relevant applications" ON pool_applications
  FOR SELECT USING (
    applicant_id = auth.uid()
    OR listing_id IN (SELECT id FROM pool_listings WHERE creator_id = auth.uid())
  );

-- Users can apply
CREATE POLICY "Users can apply to pool listings" ON pool_applications
  FOR INSERT WITH CHECK (applicant_id = auth.uid());

-- Listing creator can update (accept/deny)
CREATE POLICY "Listing creator can manage applications" ON pool_applications
  FOR UPDATE USING (
    listing_id IN (SELECT id FROM pool_listings WHERE creator_id = auth.uid())
  );

CREATE INDEX idx_pool_applications_listing ON pool_applications(listing_id);
CREATE INDEX idx_pool_applications_applicant ON pool_applications(applicant_id);
