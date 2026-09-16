-- 0001_extensions_and_types.sql
-- Extensions, schemas and enumerated types.
-- Reference: ARCHITECTURE.md §4.2 (core entities), §15 (roles).

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- Helper/config functions live in `app` so they are never confused with data.
create schema if not exists app;

-- --------------------------------------------------------------------------
-- Roles (§15). Single-valued: a user holds exactly one role.
-- --------------------------------------------------------------------------
create type app.user_role as enum (
  'consultant',
  'manager',
  'leader',
  'head_of_department',
  'admin',
  'super_admin'
);

create type app.user_status as enum ('pending', 'active', 'suspended');

create type app.access_request_status as enum ('pending', 'approved', 'rejected');

-- An actor is either a signed-in user or the system itself (§4.2 case_events).
create type app.actor_type as enum ('user', 'system');

-- Provenance of a finalised policy term (§4.2 policy_terms.source).
create type app.term_source as enum ('extracted', 'manual', 'plan_match');

-- §11 insurer response state machine.
create type app.insurer_rfq_status as enum (
  'sent',
  'responded',
  'declined',
  'not_responded',
  'deemed_accepted'
);

create type app.extraction_status as enum ('pending', 'running', 'succeeded', 'failed');

create type app.compliance_review_status as enum ('pending', 'approved', 'rejected');

-- --------------------------------------------------------------------------
-- Current-actor resolution.
--
-- Supabase Auth exposes the signed-in user through the `request.jwt.claims`
-- GUC; `auth.uid()` is a thin wrapper over it. We read the GUC directly rather
-- than calling auth.uid() so that (a) migrations and pgTAP can run on a plain
-- Postgres instance with no Supabase schema present, and (b) the eventual move
-- off Supabase (§3.1 migration checklist) touches this one function instead of
-- every RLS policy.
-- --------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
      current_setting('app.current_user_id', true)
    ),
    ''
  )::uuid;
$$;

comment on function app.current_user_id() is
  'UUID of the signed-in user, from the Supabase JWT or the app.current_user_id GUC. Null when unauthenticated.';
