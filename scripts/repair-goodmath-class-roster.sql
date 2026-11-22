-- 2026 Goodmath 명부 복구: 1반에 잘못 등록된 102xx~107xx 학생 119명.
-- 202611220003 적용 후 운영자 승인하에 실행. 계정/비밀번호/문항/제출/초안은 보존.
begin;
set local lock_timeout='5s';

-- Concurrent imports/distributions must not change the reviewed repair scope.
lock table math_private.members, math_private.accounts, math_private.recipients
  in share row exclusive mode;

do $$
begin
 if (select count(*) from math_private.classes
   where school='경복비즈니스고등학교' and year=2026 and name ~ '^1학년 [1-7]반$'
   and number_prefix='1'||lpad(substring(name from '^1학년 ([1-7])반$'),2,'0'))<>7 then
   raise exception 'Expected seven configured classes; apply 202611220003 first';
 end if;
end $$;

create temporary table roster_class_repair on commit drop as
select m.uid,m.number,m.label,m.class_id as old_class,n.id as new_class,n.number_prefix
from math_private.members m
join math_private.classes c on c.id=m.class_id
join math_private.classes n on n.school=c.school and n.year=c.year
  and n.number_prefix=left(m.number,3)
  and n.name='1학년 '||right(n.number_prefix,1)||'반'
join math_private.accounts a on a.uid=m.uid and a.class_id=m.class_id
  and a.school=c.school and a.year=c.year and a.number=m.number
where c.school='경복비즈니스고등학교' and c.year=2026
  and c.name='1학년 1반' and c.number_prefix='101'
  and m.role='student' and m.number ~ '^10[2-7][0-9]{2}$';

do $$
declare total integer;
begin
 select count(*) into total from roster_class_repair;
 if total not in (0,119) then raise exception 'Repair scope changed: % students (expected 119)',total; end if;
 if total=0 then
   if exists(select from math_private.members m join math_private.classes c on c.id=m.class_id
     where c.school='경복비즈니스고등학교' and c.year=2026 and m.role='student'
     and not math_private.roster_number_ok(c.id,m.number)) then
     raise exception 'Invalid membership remains; review required';
   end if;
   return;
 end if;
 if exists(select from (values ('102',20),('103',20),('104',20),('105',19),('106',20),('107',20)) expected(prefix,n)
   where (select count(*) from roster_class_repair r where r.number_prefix=expected.prefix)<>expected.n) then
   raise exception 'Per-class repair counts changed; review required';
 end if;
 if exists(select from roster_class_repair r join math_private.members m
   on m.class_id=r.new_class and (m.uid=r.uid or m.number=r.number)) then
   raise exception 'Destination membership conflict; review required';
 end if;
end $$;

-- Preserve the old assignment settings in the existing private audit table.
insert into math_private.changes(task,actor,detail)
select r.task,t.owner_id,jsonb_build_object('action','repair_class_number_20261122',
 'uid',fix.uid,'number',fix.number,'old_class',fix.old_class,'new_class',fix.new_class,
 'recipient',to_jsonb(r))
from roster_class_repair fix join math_private.recipients r on r.uid=fix.uid
join math_private.tasks t on t.id=r.task and t.class_id=fix.old_class;

insert into math_private.members(class_id,uid,role,label,number)
select new_class,uid,'student',label,number from roster_class_repair;
update math_private.accounts a set class_id=fix.new_class
from roster_class_repair fix where a.uid=fix.uid;
delete from math_private.recipients r using roster_class_repair fix,math_private.tasks t
where r.uid=fix.uid and t.id=r.task and t.class_id=fix.old_class;
delete from math_private.members m using roster_class_repair fix
where m.uid=fix.uid and m.class_id=fix.old_class;

select math_private.touch(uid) from roster_class_repair;
select math_private.touch(uid) from math_private.members
where role='teacher' and class_id in(select old_class from roster_class_repair);

do $$
begin
 if exists(select from math_private.members m join math_private.classes c on c.id=m.class_id
   where c.school='경복비즈니스고등학교' and c.year=2026 and m.role='student'
   and not math_private.roster_number_ok(c.id,m.number)) then
   raise exception 'Invalid membership remains; rolling back repair';
 end if;
end $$;
commit;

select c.name,count(m.uid) as students,
 (select count(*) from math_private.recipients r join math_private.tasks t on t.id=r.task where t.class_id=c.id) as assignments
from math_private.classes c left join math_private.members m on m.class_id=c.id and m.role='student'
where c.school='경복비즈니스고등학교' and c.year=2026
group by c.id,c.name order by c.name;
