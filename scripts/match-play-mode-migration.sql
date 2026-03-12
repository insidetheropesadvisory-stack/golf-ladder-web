-- Match play mode migration
-- Adds support for "different courses" mode where each player plays at their own course/tee.

-- 1. Add play_mode to matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS play_mode text NOT NULL DEFAULT 'same_course'
  CHECK (play_mode IN ('same_course', 'different_courses'));

-- 2. Match rounds — one per player per match (different_courses mode only)
CREATE TABLE IF NOT EXISTS match_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  course_name text NOT NULL,
  tee_name text,
  gross_score integer CHECK (gross_score > 0),
  course_rating numeric(4,1) NOT NULL,
  slope_rating integer NOT NULL CHECK (slope_rating > 0),
  par integer,
  differential numeric(5,1),
  played_at date NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  golf_course_api_id integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(match_id, user_id)
);

ALTER TABLE match_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Match participants can view rounds" ON match_rounds
  FOR SELECT USING (
    match_id IN (
      SELECT id FROM matches
      WHERE creator_id = auth.uid() OR opponent_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own rounds" ON match_rounds
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_match_rounds_match ON match_rounds(match_id);

-- 3. Match holes — hole-by-hole scoring per round (different_courses mode)
CREATE TABLE IF NOT EXISTS match_holes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_round_id uuid NOT NULL REFERENCES match_rounds(id) ON DELETE CASCADE,
  hole_no integer NOT NULL CHECK (hole_no >= 1 AND hole_no <= 18),
  strokes integer CHECK (strokes >= 1 AND strokes <= 20),
  UNIQUE(match_round_id, hole_no)
);

ALTER TABLE match_holes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Match participants can view holes" ON match_holes
  FOR SELECT USING (
    match_round_id IN (
      SELECT mr.id FROM match_rounds mr
      WHERE mr.match_id IN (
        SELECT m.id FROM matches m
        WHERE m.creator_id = auth.uid() OR m.opponent_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert own holes" ON match_holes
  FOR INSERT WITH CHECK (
    match_round_id IN (SELECT id FROM match_rounds WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own holes" ON match_holes
  FOR UPDATE USING (
    match_round_id IN (SELECT id FROM match_rounds WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own holes" ON match_holes
  FOR DELETE USING (
    match_round_id IN (SELECT id FROM match_rounds WHERE user_id = auth.uid())
  );

CREATE INDEX idx_match_holes_round ON match_holes(match_round_id);
