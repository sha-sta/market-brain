-- Manual portfolio P&L is removed. Ownership is now a lightweight flag on tracked_entities
-- (kind='owned', no shares/cost basis — the user checks Fidelity for actual P&L). Drop the positions
-- table with its policies/indexes (cascade). The app is pre-use, so no real data is lost.
drop table if exists public.positions cascade;
