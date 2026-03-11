-- Credits (Ts) system migration
-- Run this in Supabase SQL Editor

-- Add credits column to profiles, default 3 for all users
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS credits integer NOT NULL DEFAULT 3;

-- Attestation table — guests confirm the round went well
CREATE TABLE IF NOT EXISTS pool_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES pool_listings(id) ON DELETE CASCADE,
  attester_id uuid NOT NULL REFERENCES auth.users(id),
  host_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(listing_id, attester_id)
);

ALTER TABLE pool_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view attestations" ON pool_attestations
  FOR SELECT USING (true);

CREATE POLICY "Users can create attestations" ON pool_attestations
  FOR INSERT WITH CHECK (attester_id = auth.uid());

CREATE INDEX idx_pool_attestations_listing ON pool_attestations(listing_id);
CREATE INDEX idx_pool_attestations_host ON pool_attestations(host_id);
