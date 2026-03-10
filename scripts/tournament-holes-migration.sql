-- Tournament hole-by-hole scoring migration
-- Run this in your Supabase SQL Editor

-- 1. Add completed flag and make gross_score nullable for draft rounds
ALTER TABLE tournament_rounds
  ALTER COLUMN gross_score DROP NOT NULL,
  ALTER COLUMN differential DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT true;

-- Mark all existing rounds as completed (they were submitted with total scores)
UPDATE tournament_rounds SET completed = true WHERE completed IS NULL;

-- 2. Tournament holes — individual hole scores for tournament rounds
CREATE TABLE IF NOT EXISTS tournament_holes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_round_id uuid NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
  hole_no integer NOT NULL CHECK (hole_no >= 1 AND hole_no <= 18),
  strokes integer CHECK (strokes >= 1 AND strokes <= 20),
  UNIQUE(tournament_round_id, hole_no)
);

ALTER TABLE tournament_holes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view tournament holes" ON tournament_holes
  FOR SELECT USING (
    tournament_round_id IN (
      SELECT tr.id FROM tournament_rounds tr
      WHERE tr.tournament_id IN (
        SELECT tournament_id FROM tournament_participants WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert own tournament holes" ON tournament_holes
  FOR INSERT WITH CHECK (
    tournament_round_id IN (
      SELECT id FROM tournament_rounds WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own tournament holes" ON tournament_holes
  FOR UPDATE USING (
    tournament_round_id IN (
      SELECT id FROM tournament_rounds WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own tournament holes" ON tournament_holes
  FOR DELETE USING (
    tournament_round_id IN (
      SELECT id FROM tournament_rounds WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_tournament_holes_round ON tournament_holes(tournament_round_id);
