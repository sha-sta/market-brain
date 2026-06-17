-- The local stack's default privileges grant only Dxtm (truncate/references/trigger/maintain)
-- and NO function EXECUTE to the API roles, so grant what the app needs explicitly. RLS still
-- gates `authenticated` (these grants just make the policies reachable); `service_role`
-- bypasses RLS for the worker; `anon` gets nothing — the graph requires sign-in.

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
