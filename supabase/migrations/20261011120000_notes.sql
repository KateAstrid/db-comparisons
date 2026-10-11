create table public.note (
  id bigint generated always as identity primary key,
  body text not null
);

alter table public.note enable row level security;

create policy "demo read" on public.note for select using (true);
create policy "demo insert" on public.note for insert with check (true);
create policy "demo delete" on public.note for delete using (true);

alter publication supabase_realtime add table public.note;

create or replace function public.fail_note()
returns void
language plpgsql
security definer
as $$
begin
  insert into public.note (body) values ('thrown away');
  raise exception 'cancelled on purpose';
end;
$$;

grant execute on function public.fail_note() to anon, authenticated;
