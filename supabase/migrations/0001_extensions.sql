-- pgvector: semantic relatedness ("how things relate") + the dedupe embedding boost.
-- gen_random_uuid() is built into Postgres 13+ (Supabase runs 15+), so no pgcrypto needed.
create extension if not exists vector;
