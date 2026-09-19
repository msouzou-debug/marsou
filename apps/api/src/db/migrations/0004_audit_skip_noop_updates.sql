-- 0004 — the audit log records changes, not writes.
--
-- An UPDATE that leaves every column as it was (an idempotent seed re-run, a
-- form saved without edits) used to produce an audit row with identical
-- before and after images. Fifty of those bury the entries a reader needs
-- (R42). The trigger now returns early when nothing but updated_at moved.
-- Inserts and deletes are always recorded.

create or replace function ecapital.write_audit() returns trigger
language plpgsql security definer set search_path = ecapital, pg_catalog as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_ip     text := nullif(current_setting('app.ip', true), '');
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- RULE (R42): a no-op update is not a change. updated_at is set by the
    -- application on every write, so it is excluded from the comparison.
    if (v_before - 'updated_at') = (v_after - 'updated_at') then
      return null;
    end if;
  else
    v_after := to_jsonb(new);
  end if;

  insert into ecapital.audit_log (actor_id, entity_type, entity_id, action, before, after, at, ip, org_unit_id)
  values (
    ecapital.current_actor_id(),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    tg_op::ecapital.audit_action,
    v_before,
    v_after,
    now(),
    case when v_ip is null then null else v_ip::inet end,
    coalesce(v_after ->> 'org_unit_id', v_before ->> 'org_unit_id'));

  return null;
end $$;
