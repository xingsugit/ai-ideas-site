create extension if not exists pgcrypto;

create table if not exists public.labels (
  name text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'new',
  label text not null default '',
  tags jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  ai_chat jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.labels (name)
values ('Agent'), ('Automation'), ('Research')
on conflict (name) do nothing;
