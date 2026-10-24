-- Operational records are deliberately independent of insurance coverage.
insert into public.permissions(code,description) values
 ('crm.read','Read fleet operational records'),('crm.manage','Manage fleet operational records');
insert into public.role_permissions(role,permission) values
 ('platform_super_admin','crm.read'),('platform_super_admin','crm.manage'),
 ('insurer_admin','crm.read'),('fleet_admin','crm.read'),('fleet_admin','crm.manage'),
 ('fleet_manager','crm.read'),('fleet_manager','crm.manage'),('fleet_accounts','crm.read');

alter table public.vehicles add constraint vehicles_id_fleet_unique unique(id,fleet_id);
create table public.crm_vehicle_profiles (
 id uuid primary key default gen_random_uuid(), fleet_id uuid not null references public.organisations(id),
 vehicle_id uuid not null unique, depot text not null default '' check(length(depot)<=120),
 operational_status text not null default 'available' check(operational_status in ('available','off_road','maintenance','disposed')),
 mileage integer check(mileage between 0 and 5000000), mileage_recorded_on date,
 mot_due date, tax_due date, service_due date, service_due_mileage integer check(service_due_mileage between 0 and 5000000),
 replacement_due date, ownership text not null default 'owned' check(ownership in ('owned','leased','hired')),
 monthly_payment numeric(12,2) check(monthly_payment between 0 and 1000000),
 notes text not null default '' check(length(notes)<=4000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id),
 foreign key(vehicle_id,fleet_id) references public.vehicles(id,fleet_id)
);
create table public.crm_contacts (
 id uuid primary key default gen_random_uuid(), fleet_id uuid not null references public.organisations(id),
 name text not null check(length(btrim(name)) between 1 and 160),
 kind text not null check(kind in ('fleet','garage','recovery','leasing','insurer','other')),
 company text not null default '' check(length(company)<=160),
 email text not null default '' check(length(email)<=254), phone text not null default '' check(length(phone)<=40),
 notes text not null default '' check(length(notes)<=4000), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id), unique(id,fleet_id)
);
create table public.crm_tasks (
 id uuid primary key default gen_random_uuid(), fleet_id uuid not null references public.organisations(id), vehicle_id uuid,
 title text not null check(length(btrim(title)) between 1 and 200),
 category text not null default 'task' check(category in ('task','mot','tax','service','repair','tyre','inspection','breakdown')),
 status text not null default 'open' check(status in ('open','in_progress','awaiting_approval','completed','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 due_on date, assignee_id uuid, supplier_id uuid,
 detail text not null default '' check(length(detail)<=4000),
 cost numeric(12,2) check(cost between 0 and 10000000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id),
 foreign key(vehicle_id,fleet_id) references public.vehicles(id,fleet_id),
 foreign key(assignee_id,fleet_id) references public.crm_contacts(id,fleet_id),
 foreign key(supplier_id,fleet_id) references public.crm_contacts(id,fleet_id)
);
create table public.crm_documents (
 id uuid primary key default gen_random_uuid(), fleet_id uuid not null references public.organisations(id), vehicle_id uuid,
 title text not null check(length(btrim(title)) between 1 and 200),
 storage_path text not null unique check(storage_path like fleet_id::text||'/%'),
 file_name text not null check(length(file_name)<=200), content_type text not null check(content_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes integer not null check(size_bytes between 1 and 4194304), expires_on date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid not null default auth.uid() references auth.users(id),
 foreign key(vehicle_id,fleet_id) references public.vehicles(id,fleet_id)
);
create table public.crm_events (
 id uuid primary key default gen_random_uuid(), fleet_id uuid not null references public.organisations(id), vehicle_id uuid,
 entity_id uuid not null, entity_type text not null, action text not null,
 actor_id uuid not null references auth.users(id), occurred_at timestamptz not null default now(),
 before_state jsonb, after_state jsonb,
 foreign key(vehicle_id,fleet_id) references public.vehicles(id,fleet_id)
);
create index crm_profiles_fleet on public.crm_vehicle_profiles(fleet_id);
create index crm_contacts_fleet on public.crm_contacts(fleet_id,name);
create index crm_tasks_fleet_due on public.crm_tasks(fleet_id,status,due_on);
create index crm_tasks_vehicle on public.crm_tasks(vehicle_id,created_at desc);
create index crm_tasks_assignee on public.crm_tasks(assignee_id);
create index crm_tasks_supplier on public.crm_tasks(supplier_id);
create index crm_docs_fleet on public.crm_documents(fleet_id,expires_on);
create index crm_docs_vehicle on public.crm_documents(vehicle_id);
create index crm_events_fleet on public.crm_events(fleet_id,occurred_at desc);
create index crm_events_vehicle on public.crm_events(vehicle_id,occurred_at desc);

-- Trigger-only privileged helper: records audit history atomically, with identity and permission checks.
create function private.crm_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous jsonb; current_row jsonb; v_vehicle uuid;
begin
 if auth.uid() is null or not private.has_permission(new.fleet_id,'crm.manage') then
  raise exception 'You cannot change this fleet.' using errcode='42501';
 end if;
 if not exists(select 1 from public.organisations where id=new.fleet_id and kind='fleet') then
  raise exception 'Choose a fleet organisation.' using errcode='22023';
 end if;
 if tg_op='UPDATE' then
  if new.fleet_id<>old.fleet_id or new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then
   raise exception 'Record identity cannot be changed.' using errcode='42501';
  end if;
  previous:=to_jsonb(old);
 else
  new.created_by:=auth.uid();new.created_at:=now();
 end if;
 new.updated_at:=now();current_row:=to_jsonb(new);
 if tg_table_name='crm_documents' and tg_op='UPDATE' then
  raise exception 'Uploaded files are versioned; add a new document instead.' using errcode='42501';
 end if;
 v_vehicle:=(current_row->>'vehicle_id')::uuid;
 insert into public.crm_events(fleet_id,vehicle_id,entity_id,entity_type,action,actor_id,before_state,after_state)
 values(new.fleet_id,v_vehicle,new.id,tg_table_name,lower(tg_op),auth.uid(),previous,current_row);
 perform private.write_audit(new.fleet_id,'crm.'||tg_table_name||'.'||lower(tg_op),tg_table_name,new.id,previous,current_row);
 return new;
end $$;
revoke all on function private.crm_audit() from public,anon,authenticated;

do $$ declare t text; begin
 foreach t in array array['crm_vehicle_profiles','crm_contacts','crm_tasks','crm_documents'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy crm_read on public.%I for select to authenticated using (fleet_id in (select private.accessible_orgs(''crm.read'')))',t);
  execute format('create policy crm_insert on public.%I for insert to authenticated with check (fleet_id in (select private.accessible_orgs(''crm.manage'')))',t);
  execute format('create policy crm_update on public.%I for update to authenticated using (fleet_id in (select private.accessible_orgs(''crm.manage''))) with check (fleet_id in (select private.accessible_orgs(''crm.manage'')))',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to authenticated',t);
  execute format('create trigger crm_audit before insert or update on public.%I for each row execute function private.crm_audit()',t);
 end loop;
end $$;
alter table public.crm_events enable row level security;
create policy crm_events_read on public.crm_events for select to authenticated using(fleet_id in (select private.accessible_orgs('crm.read')));
revoke all on public.crm_events from anon,authenticated;
grant select on public.crm_events to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fleet-documents','fleet-documents',false,4194304,array['application/pdf','image/jpeg','image/png','image/webp']);
create function private.crm_storage_permission(p_path text,p_permission text) returns boolean
language sql stable security invoker set search_path='' as $$
 select case when split_part(p_path,'/',1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 then private.has_permission(split_part(p_path,'/',1)::uuid,p_permission) else false end
$$;
revoke all on function private.crm_storage_permission(text,text) from public,anon;
grant execute on function private.crm_storage_permission(text,text) to authenticated;
create policy crm_files_read on storage.objects for select to authenticated using(bucket_id='fleet-documents' and private.crm_storage_permission(name,'crm.read'));
create policy crm_files_insert on storage.objects for insert to authenticated with check(bucket_id='fleet-documents' and private.crm_storage_permission(name,'crm.manage'));
-- Only the uploader may clean up an unregistered file if metadata creation fails.
create policy crm_files_cleanup on storage.objects for delete to authenticated using(bucket_id='fleet-documents' and owner_id=(select auth.uid())::text and private.crm_storage_permission(name,'crm.manage') and not exists(select 1 from public.crm_documents d where d.storage_path=name));
