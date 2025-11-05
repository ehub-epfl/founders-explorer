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
          and tablename <> 'course_ratings'
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


create table if not exists coursebook_teachers (
    id            bigserial primary key,
    course_id     bigint      not null references coursebook_courses (id) on delete cascade,
    teacher_name  text        not null,
    teacher_url   text,
    unique (course_id, teacher_name)
);

create index if not exists coursebook_teachers_name_trgm_idx
    on coursebook_teachers using gin (teacher_name extensions.gin_trgm_ops);


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

create table if not exists course_ratings (
    id                  bigserial primary key,
    created_at          timestamptz not null default now(),
    course_id           text        not null check (char_length(course_id) > 0),
    course_code         text        not null check (char_length(course_code) > 0),
    score_relevance     smallint    not null check (score_relevance between 0 and 100),
    score_personal      smallint    not null check (score_personal between 0 and 100),
    score_product       smallint    not null check (score_product between 0 and 100),
    score_venture       smallint    not null check (score_venture between 0 and 100),
    score_intro         smallint    not null check (score_intro between 0 and 100),
    ip_hash             text,
    ua                  text
);

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
                'name', t.teacher_name,
                'url',  coalesce(t.teacher_url, '')
            )
            order by t.teacher_name
        ) as teachers,
        array_agg(distinct t.teacher_name) as teacher_names,
        coalesce(string_agg(distinct t.teacher_name, ' '), '') as teacher_names_text
    from coursebook_teachers t
    where t.course_id = c.id
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


drop trigger if exists set_coursebook_courses_updated_at on coursebook_courses;
