-- Add hole_count to matches and pool_listings (9 or 18 holes)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS hole_count smallint NOT NULL DEFAULT 18;
ALTER TABLE matches ADD CONSTRAINT matches_hole_count_check CHECK (hole_count IN (9, 18));

-- Add nine_side for 9-hole rounds on 18-hole courses (front or back)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS nine_side text;
ALTER TABLE matches ADD CONSTRAINT matches_nine_side_check CHECK (nine_side IS NULL OR nine_side IN ('front', 'back'));

ALTER TABLE pool_listings ADD COLUMN IF NOT EXISTS hole_count smallint NOT NULL DEFAULT 18;
ALTER TABLE pool_listings ADD CONSTRAINT pool_listings_hole_count_check CHECK (hole_count IN (9, 18));

-- Match attestations for tee credit system on regular matches
CREATE TABLE IF NOT EXISTS match_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  attester_id uuid NOT NULL REFERENCES profiles(id),
  host_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, attester_id)
);

-- RLS for match_attestations
ALTER TABLE match_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own attestations"
  ON match_attestations FOR SELECT
  USING (attester_id = auth.uid() OR host_id = auth.uid());

CREATE POLICY "Users can insert own attestations"
  ON match_attestations FOR INSERT
  WITH CHECK (attester_id = auth.uid());
