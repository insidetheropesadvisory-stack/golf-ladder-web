-- Add opponent_tee column so each player can pick their own tees
-- selected_tee = creator's tee, opponent_tee = opponent's tee
-- Run this in your Supabase SQL Editor

ALTER TABLE matches ADD COLUMN IF NOT EXISTS opponent_tee text;
