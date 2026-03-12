-- Add golf_course_api_id to ladder_rounds so scoring page can fetch hole data
ALTER TABLE ladder_rounds ADD COLUMN IF NOT EXISTS golf_course_api_id integer;
