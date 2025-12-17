-- Coursebook data model for Supabase SQL editor.
-- Run this script to (re)create the tables used to store coursebook courses,
-- their teachers, and associated programs. It replaces earlier ad-hoc schemas.

set search_path = public, extensions;

create extension if not exists pg_trgm with schema extensions;

do $$
declare
    stmt text;
begin
    for stmt in
        select format('drop view if exists %I.%I cascade;', schemaname, viewname)
        from pg_catalog.pg_views
        where schemaname = current_schema()
    loop
        execute stmt;
    end loop;

    for stmt in
        select format('drop materialized view if exists %I.%I cascade;', schemaname, matviewname)
        from pg_catalog.pg_matviews
        where schemaname = current_schema()
    loop
        execute stmt;
    end loop;

    for stmt in
        select format('drop table if exists %I.%I cascade;', schemaname, tablename)
        from pg_catalog.pg_tables
        where schemaname = current_schema()
          and tablename not in ('course_ratings', 'profiles')
    loop
        execute stmt;
    end loop;
end;
$$;

create table if not exists coursebook_courses (
    id              bigserial primary key,
    course_key      text        not null check (char_length(course_key) > 0),
    course_name     text        not null check (char_length(course_name) > 0),
    section         text        not null,
    study_program   text,
    study_faculty   text,
    study_block     text,
    course_url      text        not null,
    language        text        not null,
    credits         numeric(6,2),
    workload        numeric(6,2),
    semester        text,
    course_type     text,
    schedule        text        not null default '',
    schedule_matrix smallint[]  not null default array_fill(0::smallint, ARRAY[12,7]),
    constraint coursebook_courses_schedule_matrix_dims check (
        array_ndims(schedule_matrix) = 2
            and array_length(schedule_matrix, 1) = 12
            and array_length(schedule_matrix, 2) = 7
    ),
    description     text        not null default '',
    keywords        text        not null default '',
    entre_score     integer,
    "PD"            integer,
    "PB"            integer,
    "VB"            numeric(5,2),
    "INTRO"         integer     not null default 0,
    unique_code     text        generated always as (
        coalesce(btrim(course_key), '') || '::' || coalesce(btrim(course_name), '')
    ) stored
);

create unique index if not exists coursebook_courses_unique_code_idx
    on coursebook_courses (unique_code);

create index if not exists coursebook_courses_section_idx
    on coursebook_courses (section);

create index if not exists coursebook_courses_language_idx
    on coursebook_courses (language);

create index if not exists coursebook_courses_study_program_idx
    on coursebook_courses (study_program);

create index if not exists coursebook_courses_study_faculty_idx
    on coursebook_courses (study_faculty);

create index if not exists coursebook_courses_name_trgm_idx
    on coursebook_courses using gin (course_name extensions.gin_trgm_ops);

create index if not exists coursebook_courses_key_trgm_idx
    on coursebook_courses using gin (course_key extensions.gin_trgm_ops);


create table if not exists people_profiles (
    id                     bigserial primary key,
    name                   text        not null,
    card_url               text,
    email                  text,
    title                  text,
    lab_url                text,
    photo_url              text,
    introduction_summary   text
);

create index if not exists people_profiles_name_trgm_idx
    on people_profiles using gin (name extensions.gin_trgm_ops);

-- Ensure upserts can match existing profiles deterministically
do $$ begin
    if not exists (
        select 1 from pg_indexes where schemaname = current_schema() and indexname = 'people_profiles_unique_name_url_idx'
    ) then
        execute 'create unique index people_profiles_unique_name_url_idx on people_profiles (name, card_url)';
    end if;
end $$;

-- Link table: a course can have multiple teachers (people_profiles)
create table if not exists course_people_profiles (
    id          bigserial primary key,
    course_id   bigint  not null references coursebook_courses (id) on delete cascade,
    person_id   bigint  not null references people_profiles (id) on delete cascade,
    unique (course_id, person_id)
);

create index if not exists course_people_profiles_course_id_idx
    on course_people_profiles (course_id);

create index if not exists course_people_profiles_person_id_idx
    on course_people_profiles (person_id);


create table if not exists coursebook_programs (
    id            bigserial primary key,
    course_id     bigint      not null references coursebook_courses (id) on delete cascade,
    program_name  text        not null,
    level         text        not null,
    semester      text        not null,
    exam_form     text        not null,
    program_type  text        not null,
    workload      numeric(6,2),
    unique (course_id, program_name, level, semester, exam_form, program_type)
);

create index if not exists coursebook_programs_program_name_trgm_idx
    on coursebook_programs using gin (program_name extensions.gin_trgm_ops);

create index if not exists coursebook_programs_level_idx
    on coursebook_programs (level);

create index if not exists coursebook_programs_semester_idx
    on coursebook_programs (semester);

create index if not exists coursebook_programs_program_type_idx
    on coursebook_programs (program_type);

create index if not exists coursebook_programs_exam_form_idx
    on coursebook_programs (exam_form);

create table if not exists coursebook_studyplans (
    id             bigserial primary key,
    course_id      bigint      not null references coursebook_courses (id) on delete cascade,
    study_program  text        not null,
    study_faculty  text        not null,
    study_block    text        not null,
    unique (course_id, study_program, study_faculty, study_block)
);

create index if not exists coursebook_studyplans_program_idx
    on coursebook_studyplans (study_program);

create index if not exists coursebook_studyplans_faculty_idx
    on coursebook_studyplans (study_faculty);

-- Entries used to drive the Compass visualization
create table if not exists compass_entries (
    id          bigserial primary key,
    slot_index  integer     not null unique check (slot_index >= 0),
    label       text        not null,
    url         text        not null default '',
    category    text        not null,
    description text        not null default ''
);

alter table if exists compass_entries
    drop column if exists course_key;

alter table if exists compass_entries
    add column if not exists description text not null default '';

-- Seed initial compass entries with the top 30 courses by score, if slots are empty
insert into compass_entries (slot_index, label, url, category, description)
select
    ranked.slot_index,
    ranked.course_key,
    ranked.course_url,
    'course'::text as category,
    ranked.course_name
from (
    select
        row_number() over (
            order by
                coalesce(entre_score, 0) desc,
                coalesce("PD", 0) desc,
                coalesce("PB", 0) desc,
                id asc
        ) - 1 as slot_index,
        course_name,
        course_url,
        course_key
    from coursebook_courses
    where coalesce(course_url, '') <> ''
) as ranked
where ranked.slot_index < 30
on conflict (slot_index) do nothing;

create table if not exists course_ratings (
    id                  bigserial primary key,
    created_at          timestamptz not null default now(),
    course_id           text        not null check (char_length(course_id) > 0),
    course_code         text        not null check (char_length(course_code) > 0),
    user_email          text        check (char_length(user_email) <= 320),
    score_relevance     smallint    not null check (score_relevance between 0 and 100),
    score_personal      smallint    not null check (score_personal between 0 and 100),
    score_product       smallint    not null check (score_product between 0 and 100),
    score_venture       smallint    not null check (score_venture between 0 and 100),
    score_intro         smallint    not null check (score_intro between 0 and 100),
    comment_relevance   text        not null default '' check (char_length(comment_relevance) <= 2000),
    comment_personal    text        not null default '' check (char_length(comment_personal) <= 2000),
    comment_product     text        not null default '' check (char_length(comment_product) <= 2000),
    comment_venture     text        not null default '' check (char_length(comment_venture) <= 2000),
    comment_intro       text        not null default '' check (char_length(comment_intro) <= 2000),
    ip_hash             text,
    ua                  text
);

-- Enable RLS for core tables (views like coursebook_course_summary are excluded)
alter table if exists public.coursebook_courses      enable row level security;
alter table if exists public.people_profiles        enable row level security;
alter table if exists public.course_people_profiles enable row level security;
alter table if exists public.coursebook_programs    enable row level security;
alter table if exists public.coursebook_studyplans  enable row level security;
alter table if exists public.compass_entries        enable row level security;
alter table if exists public.course_ratings         enable row level security;

-- Backfill-safe permissive policies so existing behavior is preserved
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'coursebook_courses' and policyname = 'coursebook_courses_all'
    ) then
        execute 'create policy "coursebook_courses_all" on public.coursebook_courses for all using (true) with check (true);';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'people_profiles' and policyname = 'people_profiles_all'
    ) then
        execute 'create policy "people_profiles_all" on public.people_profiles for all using (true) with check (true);';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'course_people_profiles' and policyname = 'course_people_profiles_all'
    ) then
        execute 'create policy "course_people_profiles_all" on public.course_people_profiles for all using (true) with check (true);';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'coursebook_programs' and policyname = 'coursebook_programs_all'
    ) then
        execute 'create policy "coursebook_programs_all" on public.coursebook_programs for all using (true) with check (true);';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'coursebook_studyplans' and policyname = 'coursebook_studyplans_all'
    ) then
        execute 'create policy "coursebook_studyplans_all" on public.coursebook_studyplans for all using (true) with check (true);';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'compass_entries' and policyname = 'compass_entries_all'
    ) then
        execute 'create policy "compass_entries_all" on public.compass_entries for all using (true) with check (true);';
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'course_ratings' and policyname = 'course_ratings_all'
    ) then
        execute 'create policy "course_ratings_all" on public.course_ratings for all using (true) with check (true);';
    end if;
end $$;

-- Backfill-safe schema updates for course_ratings
do $$
begin
    if not exists (select 1 from information_schema.columns where table_name = 'course_ratings' and column_name = 'comment_relevance') then
        alter table course_ratings add column comment_relevance text not null default '';
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'course_ratings' and column_name = 'comment_personal') then
        alter table course_ratings add column comment_personal text not null default '';
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'course_ratings' and column_name = 'comment_product') then
        alter table course_ratings add column comment_product text not null default '';
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'course_ratings' and column_name = 'comment_venture') then
        alter table course_ratings add column comment_venture text not null default '';
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'course_ratings' and column_name = 'comment_intro') then
        alter table course_ratings add column comment_intro text not null default '';
    end if;
    if not exists (select 1 from information_schema.columns where table_name = 'course_ratings' and column_name = 'user_email') then
        alter table course_ratings add column user_email text;
    end if;

    if not exists (select 1 from pg_constraint where conname = 'course_ratings_comment_relevance_len_check') then
        alter table course_ratings add constraint course_ratings_comment_relevance_len_check check (char_length(comment_relevance) <= 2000);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_ratings_comment_personal_len_check') then
        alter table course_ratings add constraint course_ratings_comment_personal_len_check check (char_length(comment_personal) <= 2000);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_ratings_comment_product_len_check') then
        alter table course_ratings add constraint course_ratings_comment_product_len_check check (char_length(comment_product) <= 2000);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_ratings_comment_venture_len_check') then
        alter table course_ratings add constraint course_ratings_comment_venture_len_check check (char_length(comment_venture) <= 2000);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_ratings_comment_intro_len_check') then
        alter table course_ratings add constraint course_ratings_comment_intro_len_check check (char_length(comment_intro) <= 2000);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'course_ratings_user_email_len_check') then
        alter table course_ratings add constraint course_ratings_user_email_len_check check (user_email is null or char_length(user_email) <= 320);
    end if;
end $$;

create index if not exists course_ratings_course_id_idx
    on course_ratings (course_id);

create index if not exists course_ratings_course_code_idx
    on course_ratings (course_code);


create or replace view coursebook_course_summary as
select
    c.id,
    c.unique_code,
    c.course_key,
    c.course_name,
    c.section,
    c.study_program,
    c.study_faculty,
    c.study_block,
    c.course_url,
    c.language,
    c.credits,
    c.workload,
    c.semester,
    c.course_type as type,
    c.schedule,
    c.schedule_matrix,
    c.description,
    c.keywords,
    c.entre_score,
    c."PD",
    c."PB",
    c."VB",
    c."INTRO",
    coalesce(t_data.teachers, '[]'::jsonb) as teachers,
    coalesce(t_data.teacher_names, ARRAY[]::text[]) as teacher_names,
    coalesce(t_data.teacher_names_text, '') as teacher_names_text,
    coalesce(p_data.programs, '[]'::jsonb) as programs,
    coalesce(sp_data.study_plans, '[]'::jsonb) as study_plans
from coursebook_courses c
left join lateral (
    select
        jsonb_agg(
            jsonb_build_object(
                'name', p.name,
                'url',  coalesce(p.card_url, '')
            )
            order by p.name
        ) as teachers,
        array_agg(distinct p.name) as teacher_names,
        coalesce(string_agg(distinct p.name, ' '), '') as teacher_names_text
    from course_people_profiles cp
    join people_profiles p on p.id = cp.person_id
    where cp.course_id = c.id
) as t_data on true
left join lateral (
    select
        jsonb_agg(
            jsonb_build_object(
                'program_name', p.program_name,
                'level',        p.level,
                'semester',     p.semester,
                'exam_form',    p.exam_form,
                'type',         p.program_type,
                'workload',     p.workload
            )
            order by p.program_name, p.level
        ) as programs
    from coursebook_programs p
    where p.course_id = c.id
) as p_data on true
left join lateral (
    select
        jsonb_agg(
            jsonb_build_object(
                'study_program', s.study_program,
                'study_faculty', s.study_faculty,
                'study_block',   s.study_block
            )
            order by s.study_program, s.study_faculty, s.study_block
        ) as study_plans
    from coursebook_studyplans s
    where s.course_id = c.id
) as sp_data on true;


-- Ensure the view runs with the querying user's privileges (avoid SECURITY DEFINER)
alter view public.coursebook_course_summary set (security_invoker = true);


drop trigger if exists set_coursebook_courses_updated_at on coursebook_courses;

-- User profiles table linked to Supabase Auth
create table if not exists public.profiles (
  id uuid primary key references auth.users not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text null,
  email text null
);

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_own'
  ) then
    execute 'create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_insert_own'
  ) then
    execute 'create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own'
  ) then
    execute 'create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);';
  end if;
end $$;

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();
