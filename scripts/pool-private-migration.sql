-- Add is_private flag to clubs and pool_listings
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false;
ALTER TABLE pool_listings ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false;
