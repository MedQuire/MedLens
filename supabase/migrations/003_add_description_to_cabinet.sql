-- Migration: Add description column to cabinet_items
-- Purpose: Store a short clinical purpose for medications in the cabinet

ALTER TABLE cabinet_items ADD COLUMN IF NOT EXISTS description TEXT;

-- Update existing items with a default value if needed (optional)
-- UPDATE cabinet_items SET description = 'Saved medication' WHERE description IS NULL;
