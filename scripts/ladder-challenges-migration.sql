-- Ladder challenges migration
-- Separates ladder matches from regular matches.
-- Each challenge has two independent rounds (one per player, any course/tee).
-- Winner determined by handicap differential: (113 / slope) * (gross - course_rating).

-- 1. Ladder challenges
CREATE TABLE IF NOT EXISTS ladder_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id uuid NOT NULL REFERENCES auth.users(id),
  opponent_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'expired')),
  deadline date NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Result fields (set on completion)
  winner_id uuid REFERENCES auth.users(id),
  challenger_differential numeric(5,1),
  opponent_differential numeric(5,1)
);

ALTER TABLE ladder_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view own challenges" ON ladder_challenges
  FOR SELECT USING (challenger_id = auth.uid() OR opponent_id = auth.uid());

CREATE POLICY "Users can create challenges" ON ladder_challenges
  FOR INSERT WITH CHECK (challenger_id = auth.uid());

CREATE INDEX idx_ladder_challenges_challenger ON ladder_challenges(challenger_id);
CREATE INDEX idx_ladder_challenges_opponent ON ladder_challenges(opponent_id);
CREATE INDEX idx_ladder_challenges_status ON ladder_challenges(status);

-- 2. Ladder rounds (one per player per challenge)
CREATE TABLE IF NOT EXISTS ladder_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES ladder_challenges(id) ON DELETE CASCADE,
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
  created_at timestamptz DEFAULT now(),
  UNIQUE(challenge_id, user_id)
);

ALTER TABLE ladder_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Challenge participants can view rounds" ON ladder_rounds
  FOR SELECT USING (
    challenge_id IN (
      SELECT id FROM ladder_challenges
      WHERE challenger_id = auth.uid() OR opponent_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own rounds" ON ladder_rounds
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_ladder_rounds_challenge ON ladder_rounds(challenge_id);

-- 3. Ladder holes (hole-by-hole scoring per round)
CREATE TABLE IF NOT EXISTS ladder_holes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ladder_round_id uuid NOT NULL REFERENCES ladder_rounds(id) ON DELETE CASCADE,
  hole_no integer NOT NULL CHECK (hole_no >= 1 AND hole_no <= 18),
  strokes integer CHECK (strokes >= 1 AND strokes <= 20),
  UNIQUE(ladder_round_id, hole_no)
);

ALTER TABLE ladder_holes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Challenge participants can view holes" ON ladder_holes
  FOR SELECT USING (
    ladder_round_id IN (
      SELECT lr.id FROM ladder_rounds lr
      WHERE lr.challenge_id IN (
        SELECT lc.id FROM ladder_challenges lc
        WHERE lc.challenger_id = auth.uid() OR lc.opponent_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert own holes" ON ladder_holes
  FOR INSERT WITH CHECK (
    ladder_round_id IN (SELECT id FROM ladder_rounds WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own holes" ON ladder_holes
  FOR UPDATE USING (
    ladder_round_id IN (SELECT id FROM ladder_rounds WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own holes" ON ladder_holes
  FOR DELETE USING (
    ladder_round_id IN (SELECT id FROM ladder_rounds WHERE user_id = auth.uid())
  );

CREATE INDEX idx_ladder_holes_round ON ladder_holes(ladder_round_id);
