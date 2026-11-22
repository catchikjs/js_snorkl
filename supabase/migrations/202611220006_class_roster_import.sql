-- Four-column imports bind the explicit class name, class ID and student number.
-- Correct legacy misclassification only within classes owned by the same teacher.
create or replace function public.math_class_roster(u uuid,op text,p jsonb)
returns jsonb language plpgsql security definer set search_path=math_private,pg_catalog as $$
declare
 cl classes; old_class classes; account accounts; target members; old_member members;
 student_number text:=btrim(p->>'number'); student_label text:=btrim(p->>'label');
 prefix text; moved boolean:=false; previous_class uuid; result jsonb;
begin
 select * into strict cl from classes where id=(p->>'class_id')::uuid;
 if u is null or not teacher(cl.id,u) or exists(select from accounts where uid=u and force_change) then
   raise exception 'enroll_denied';
 end if;
 if op is null or op not in ('check','assign') or student_label is null or length(student_label) not between 1 and 100 then
   raise exception 'enroll_invalid';
 end if;
 prefix:=substring(cl.name from '^([1-9])학년 [0-9]{1,2}반$')||
   lpad(substring(cl.name from '^[1-9]학년 ([0-9]{1,2})반$'),2,'0');
 if prefix is null or right(prefix,2)='00' or p->>'class_name' is distinct from cl.name
   or student_number is null or student_number !~ '^[1-9][0-9]{4}$'
   or left(student_number,3)<>prefix or not roster_number_ok(cl.id,student_number) then
   raise exception 'roster_class_mismatch';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(cl.school||':'||cl.year||':'||student_number,0));
 select * into account from accounts where school=cl.school and year=cl.year and number=student_number for update;
 select * into target from members where class_id=cl.id and number=student_number for update;
 if target.uid is not null and (target.role<>'student' or target.label<>student_label or
    (account.uid is not null and account.uid<>target.uid)) then raise exception 'roster_mismatch'; end if;
 if account.uid is not null then
   select * into strict old_class from classes where id=account.class_id;
   if not teacher(old_class.id,u) then raise exception 'roster_transfer_denied'; end if;
   select * into strict old_member from members where class_id=old_class.id and uid=account.uid for update;
   if old_member.role<>'student' or old_member.number is distinct from student_number or old_member.label<>student_label then
     raise exception 'roster_mismatch';
   end if;
   if old_class.id<>cl.id then
     -- Never move a valid enrollment or one whose class numbering is unknown.
     if old_class.school<>cl.school or old_class.year<>cl.year or
       old_class.name !~ '^[1-9]학년 [0-9]{1,2}반$' or
       left(student_number,3)=substring(old_class.name from '^([1-9])학년')||lpad(substring(old_class.name from '학년 ([0-9]{1,2})반$'),2,'0') or
       target.uid is not null or exists(select from members where class_id=cl.id and uid=account.uid) then
       raise exception 'roster_transfer_denied';
     end if;
     previous_class:=old_class.id;
   end if;
 end if;
 if op='check' then
   return jsonb_build_object('id',coalesce(account.uid,target.uid),'school',cl.school,'year',cl.year,
     'class_id',cl.id,'previous_class_id',previous_class);
 end if;
 if coalesce(account.uid,target.uid) is null or coalesce(account.uid,target.uid) is distinct from (p->>'id')::uuid then
   raise exception 'roster_mismatch';
 end if;
 if previous_class is not null then
   insert into changes(actor,detail) values(u,jsonb_build_object('action','class_roster_transfer',
     'uid',account.uid,'number',student_number,'old_class',previous_class,'new_class',cl.id));
   insert into changes(task,actor,detail)
     select r.task,u,jsonb_build_object('action','class_roster_revoke_assignment','uid',account.uid,
       'old_class',previous_class,'new_class',cl.id,'recipient',to_jsonb(r))
     from recipients r join tasks t on t.id=r.task where r.uid=account.uid and t.class_id=previous_class;
   insert into members(class_id,uid,role,label,number) values(cl.id,account.uid,'student',student_label,student_number);
   update accounts set class_id=cl.id where uid=account.uid;
   delete from recipients r using tasks t where r.task=t.id and r.uid=account.uid and t.class_id=previous_class;
   delete from members where class_id=previous_class and uid=account.uid;
   moved:=true;
   perform touch(account.uid); perform touch(u);
 end if;
 result:=public.math_roster_assignment(u,'assign',p);
 return result||jsonb_build_object('moved',moved,'class_id',cl.id,'previous_class_id',previous_class);
end $$;
revoke all on function public.math_class_roster(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.math_class_roster(uuid,text,jsonb) to service_role;
