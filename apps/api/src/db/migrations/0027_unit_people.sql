-- 0027 — the people a project's risk can be owned by (owner report, 24/11/2026).
--
-- The risk form asked for the owner as a raw user id, a person typed a name,
-- the uuid column refused it and the API answered with a server error. The
-- form now offers a list. A unit's people are not readable by an ordinary
-- account (app_user_read in 0001 shows a user only their own record), so the
-- list comes through one function that answers only for a unit the caller
-- may read, and gives back nothing but an id and a name.
--
-- Who is on it: active users assigned to the unit, plus active
-- administrators, who are assigned to no unit and own risks all the same.
--
-- NO PATIENT DATA. Names of staff only, the same names the app already shows
-- next to every risk, issue and audit row.
create or replace function ecapital.unit_people(p_org_unit_id text)
returns table (id uuid, name text)
language sql stable security definer set search_path = ecapital, pg_catalog as $$
  select u.id, u.name
    from ecapital.app_user u
   where ecapital.current_actor_id() is not null
     and ecapital.can_read_unit(p_org_unit_id)
     and u.is_active
     and (exists (select 1 from ecapital.app_user_org_unit uo
                   where uo.app_user_id = u.id and uo.org_unit_id = p_org_unit_id)
          or exists (select 1 from ecapital.app_user_role r
                      where r.app_user_id = u.id and r.role = 'admin'))
   order by u.name
$$;

comment on function ecapital.unit_people(text) is
  'Active people who can own a risk in the unit: those assigned to it, and administrators. Id and name only, and only for a unit the caller may read.';
