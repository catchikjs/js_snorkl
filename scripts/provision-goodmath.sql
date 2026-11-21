-- Goodmath: 2026학년도 경복비즈니스고등학교 교사와 1학년 1~7반 연결.
-- 지정된 Supabase 프로젝트에서 관리자로 실행합니다. 재실행해도 중복되지 않습니다.
begin;

do $$
declare
  teacher_uid constant uuid := 'c9efd659-36fc-4968-af62-799309387d9b';
  school_name constant text := '경복비즈니스고등학교';
  school_year constant integer := 2026;
  target_class_id uuid;
  class_number integer;
begin
  if not exists (select 1 from auth.users where id = teacher_uid) then
    raise exception '지정한 교사 계정이 없습니다. Goodmath 프로젝트의 User UID를 확인하세요.';
  end if;

  for class_number in 1..7 loop
    insert into math_private.classes (school, year, name)
    values (school_name, school_year, format('1학년 %s반', class_number))
    on conflict (school, year, name) do update set name = excluded.name
    returning id into target_class_id;

    if exists (
      select 1 from math_private.members m
      where m.class_id = target_class_id and m.uid = teacher_uid and m.role <> 'teacher'
    ) then
      raise exception '이 계정은 1학년 %반에 다른 역할로 등록되어 있습니다.', class_number;
    end if;

    insert into math_private.members (class_id, uid, role, label)
    values (target_class_id, teacher_uid, 'teacher', '경복비즈니스고등학교 구정숙')
    on conflict (class_id, uid) do update set label = excluded.label;
  end loop;
end $$;

select c.school as school, c.year as year, c.name as class_name, m.role as role, m.label as teacher_name
from math_private.classes c
join math_private.members m on m.class_id = c.id
where c.school = '경복비즈니스고등학교' and c.year = 2026
  and c.name in (select format('1학년 %s반', n) from generate_series(1, 7) n)
  and m.uid = 'c9efd659-36fc-4968-af62-799309387d9b'::uuid
order by c.name;

commit;
