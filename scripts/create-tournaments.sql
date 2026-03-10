-- Tournaments feature tables
-- Run this in your Supabase SQL Editor

-- 1. Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  creator_id uuid NOT NULL REFERENCES auth.users(id),
  period_type text NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  period_count integer NOT NULL CHECK (period_count >= 1 AND period_count <= 52),
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view tournaments" ON tournaments
  FOR SELECT USING (
    id IN (SELECT tournament_id FROM tournament_participants WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create tournaments" ON tournaments
  FOR INSERT WITH CHECK (creator_id = auth.uid());

CREATE POLICY "Creator can update tournament" ON tournaments
  FOR UPDATE USING (creator_id = auth.uid());

-- 2. Tournament participants
CREATE TABLE IF NOT EXISTS tournament_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined')),
  invited_at timestamptz DEFAULT now(),
  joined_at timestamptz,
  UNIQUE(tournament_id, user_id)
);

ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view participants" ON tournament_participants
  FOR SELECT USING (
    tournament_id IN (SELECT tournament_id FROM tournament_participants WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert participants" ON tournament_participants
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own participation" ON tournament_participants
  FOR UPDATE USING (user_id = auth.uid());

CREATE INDEX idx_tournament_participants_tournament ON tournament_participants(tournament_id);
CREATE INDEX idx_tournament_participants_user ON tournament_participants(user_id);

-- 3. Tournament rounds (scores submitted by players)
CREATE TABLE IF NOT EXISTS tournament_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  period_number integer NOT NULL CHECK (period_number >= 1),
  course_name text NOT NULL,
  tee_name text,
  gross_score integer NOT NULL CHECK (gross_score > 0),
  course_rating numeric(4,1) NOT NULL,
  slope_rating integer NOT NULL CHECK (slope_rating > 0),
  par integer,
  differential numeric(5,1) NOT NULL,
  played_at date NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tournament_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view rounds" ON tournament_rounds
  FOR SELECT USING (
    tournament_id IN (SELECT tournament_id FROM tournament_participants WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert own rounds" ON tournament_rounds
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_tournament_rounds_tournament ON tournament_rounds(tournament_id);
CREATE INDEX idx_tournament_rounds_user_period ON tournament_rounds(tournament_id, user_id, period_number);

-- 4. Tournament invites (shareable link tokens)
CREATE TABLE IF NOT EXISTS tournament_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tournament_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view invite" ON tournament_invites
  FOR SELECT USING (true);

CREATE POLICY "Participants can create invites" ON tournament_invites
  FOR INSERT WITH CHECK (true);
