begin;

alter table public.shots add column if not exists cut_number text;
alter table public.shots add column if not exists memo text;
alter table public.shots add column if not exists storyboard_image_url text;
alter table public.shots add column if not exists source_file_id uuid references public.storyboard_files(id) on delete set null;
alter table public.shots add column if not exists source_page integer;
alter table public.shots add column if not exists source_row integer;

update public.shots
set cut_number = coalesce(nullif(cut_number, ''), shot_number, ''),
    memo = coalesce(nullif(memo, ''), notes, '')
where cut_number is null
   or cut_number = ''
   or memo is null
   or memo = '';

alter table public.shot_status_logs
  alter column previous_status type text using previous_status::text,
  alter column new_status type text using new_status::text;

alter table public.shots
  alter column status type text using (
    case status::text
      when 'done' then 'ok'
      when 'skipped' then 'omit'
      when 'ok' then 'ok'
      when 'omit' then 'omit'
      else 'pending'
    end
  );

update public.shots
set status = case status
  when 'done' then 'ok'
  when 'skipped' then 'omit'
  when 'ok' then 'ok'
  when 'omit' then 'omit'
  else 'pending'
end;

update public.shot_status_logs
set previous_status = case
    when previous_status is null then null
    when previous_status = 'done' then 'ok'
    when previous_status = 'skipped' then 'omit'
    when previous_status = 'ok' then 'ok'
    when previous_status = 'omit' then 'omit'
    else 'pending'
  end,
  new_status = case
    when new_status = 'done' then 'ok'
    when new_status = 'skipped' then 'omit'
    when new_status = 'ok' then 'ok'
    when new_status = 'omit' then 'omit'
    else 'pending'
  end;

alter table public.shots alter column cut_number set default '';
alter table public.shots alter column cut_number set not null;
alter table public.shots alter column memo set default '';
alter table public.shots alter column memo set not null;
alter table public.shots alter column status set default 'pending';
alter table public.shots alter column status set not null;

alter table public.shots drop constraint if exists shots_status_check;
alter table public.shots add constraint shots_status_check check (status in ('pending', 'ok', 'omit'));

alter table public.shot_status_logs drop constraint if exists shot_status_logs_status_check;
alter table public.shot_status_logs add constraint shot_status_logs_status_check check (
  (previous_status is null or previous_status in ('pending', 'ok', 'omit'))
  and new_status in ('pending', 'ok', 'omit')
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'storyboards',
  'storyboards',
  true,
  52428800,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "storyboards_select_members" on storage.objects;
create policy "storyboards_select_members"
on storage.objects for select
using (
  bucket_id = 'storyboards'
  and public.is_project_member(((storage.foldername(name))[2])::uuid)
);

drop policy if exists "storyboards_insert_admins" on storage.objects;
create policy "storyboards_insert_admins"
on storage.objects for insert
with check (
  bucket_id = 'storyboards'
  and public.is_project_admin(((storage.foldername(name))[2])::uuid)
);

drop policy if exists "storyboards_delete_admins" on storage.objects;
create policy "storyboards_delete_admins"
on storage.objects for delete
using (
  bucket_id = 'storyboards'
  and public.is_project_admin(((storage.foldername(name))[2])::uuid)
);

commit;
