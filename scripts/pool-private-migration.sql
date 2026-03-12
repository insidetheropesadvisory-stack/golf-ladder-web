-- Add is_private flag to pool_listings for private club display
ALTER TABLE pool_listings ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false;
