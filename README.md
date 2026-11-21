# Good쌤 수학교실

고등학교 간단퀴즈·수행평가를 출제하고, 학생이 iPad로 풀이를 제출하고, 교사가 결과를 검토해 공개하는 웹앱입니다. 이 저장소의 출발점은 Vanilla Vite 기본 템플릿이었습니다. 기존 객관식 퀴즈·로그인·수다노트 소스나 운영 DB는 제공되지 않았습니다. 이번 명세에 따라 평가 모듈을 React와 TypeScript로 구현했습니다.

## 키 없이 시작하기

1. Node.js 24와 npm을 준비하고 프로젝트 폴더에서 아래 명령을 실행합니다.
2. 터미널에 출력된 localhost 주소를 엽니다. 예시 과제 세 개가 보입니다.
3. **과제 열기 → 문항 1**에서 풀이를 작성하고 제출합니다. 왼쪽 아래 **교사 모드로 전환 → 제출·검토**에서 같은 제출물을 열 수 있습니다.
4. 원본을 확인하고 루브릭별 점수와 확정 사유를 입력합니다. **평가 확정** 후 공개할 항목을 선택합니다. 학생 모드의 **피드백**에서 결과를 확인합니다.

```sh
npm ci
npm run dev
```

공개 환경변수가 없는 개발 서버는 가상 교사 한 명과 두 학급을 제공합니다. 개발 DB와 파일은 Git에서 제외한 `.goodmath/`에 저장됩니다. PGlite가 운영용 평가 SQL을 실행하고, 개발용 큐·파일 저장소·모의 분석기가 외부 서비스를 대신합니다. 모의 분석은 점수를 미판정으로 둡니다. 역할 전환은 localhost 개발 서버에서만 사용할 수 있습니다. 프로덕션 빌드와 Netlify 미리보기에는 가상 사용자를 주입하지 않습니다.

로컬 교사 모드 진입에는 비밀번호가 필요합니다. `.env.local`에 `GOODMATH_DEMO_TEACHER_PASSWORD=원하는-비밀번호`를 설정하세요. 설정이 비어 있으면 개발 서버 시작 때 임의 비밀번호가 터미널에 출력됩니다. 교사 모드 전환은 서버에서 확인하며, 학생 역할값만 바꿔서는 교사 권한을 얻을 수 없습니다.

## 출제에서 공개까지

- **평가 만들기**에서 유형, 과목, 단원, 기간, 문항별 총 제출 횟수를 정합니다. 기본 총 2회는 최초 제출과 재제출을 합한 값입니다.
- 문제 설명·선지·정답·풀이·루브릭의 **ƒ 수식**에서 LaTeX를 입력합니다. 삽입한 수식을 누르면 원문을 다시 편집할 수 있습니다. **파일 · 영역 가져오기**는 PDF·PNG·JPG 원본을 받아 페이지, 회전, 확대율, 선택 영역을 조절합니다. 미리보기에서 학생에게 보일 부분을 확인한 후 삽입합니다. HWP와 DOCX는 PDF로 변환합니다.
- **문제 작성 완료**는 문제 버전을 저장하고 문항별 출제 작업을 등록합니다. **답안·루브릭**에서 AI 초안을 선택해 반영하거나 직접 작성합니다. 문항 배점과 루브릭 합계가 같아야 확정할 수 있습니다.
- **최종 확정 → 학급별 배포**에서 여러 반을 선택합니다. 학급별 링크와 QR이 발급됩니다. 링크 중지·재발급은 제출 기록을 보존합니다. **복사**는 새 편집본을 만들고 기간과 승인을 비웁니다.
- 학생은 펜이나 마우스로 필기합니다. 손가락 필기는 도구에서 켭니다. 완료된 획·설명·사진은 계정별 IndexedDB에 저장하고 서버 revision과 동기화합니다. 같은 기기에서 접속을 복구하면 전송 대기 중인 제출을 재시도합니다. 오프라인에서 새로고침하려면 앱 자체를 다시 내려받아야 합니다.
- 검토 화면에서 회차를 선택해 원본, AI 초안, 교사 교정본을 확인합니다. 점수·피드백·정답은 선택한 검토 버전에서 각각 공개합니다. 분석 실패 시에도 수동 평가할 수 있습니다.
- **학습 기록**의 공개 결과와 제출 원본은 브라우저 인쇄에서 PDF로 저장합니다. 학급 결과 CSV는 교사 화면에서 내보냅니다. 학번 열은 선행 0 보존을 위해 텍스트로 표시하며, CSV 가져오기에서도 텍스트 형식을 선택할 수 있습니다.

## 교사가 학생 계정 등록하기

1. 교사로 로그인하고 **학생 관리**를 엽니다. 상단에서 등록할 반을 선택합니다.
2. **학번 · 이름 · 초기 비밀번호(6~200자)**를 입력합니다. **학생 추가**로 행을 늘리거나, 엑셀의 세 열을 복사해 **엑셀에서 여러 명 붙여넣기 → 입력표에 추가**를 사용합니다. 학번은 텍스트로 관리해 앞자리 0을 보존합니다.
3. 내용을 확인하고 **N명 등록**을 누릅니다. 성공·실패는 행별로 표시되며 성공한 행은 재등록하지 않습니다. 중복 학번은 기존 계정이나 비밀번호를 덮어쓰지 않습니다.
4. 학생에게 학번과 초기 비밀번호를 개별 전달합니다. 학생은 **학생** 탭에서 바로 로그인하며, 이 방식은 별도 활성화 코드가 필요 없습니다.
5. 이미 배포된 평가에는 해당 평가의 **학급별 배포 → 명부 갱신**을 눌러 새 학생을 추가합니다.

초기 비밀번호는 등록 요청 동안에만 사용하고, 성공한 행에서 즉시 지웁니다. 브라우저 저장소나 명부 테이블에는 저장하지 않으며 Supabase Auth가 해시로 관리합니다. 교사는 담당 학급에만 등록할 수 있고 학교·학년도 전체에서 학번이 고유해야 합니다. 페이지를 닫거나 반을 바꾸면 미등록 입력은 사라집니다. 연결 실패 시 같은 행에서 재시도하면 동일 요청의 완료 여부를 확인하며 기존 계정 비밀번호를 재설정하지 않습니다.

## Supabase 개발 프로젝트 연결

먼저 가상 학생 데이터를 사용할 Supabase 프로젝트를 준비합니다. 기존 운영 DB에 적용할 때는 테이블명, 기존 Storage 정책, 공개 스키마 목록, 권한을 먼저 검토합니다. 개발 미리보기와 운영은 별도 Supabase 프로젝트를 사용합니다.

1. Supabase CLI에 로그인하고 프로젝트를 연결합니다. 적용할 migration을 먼저 확인합니다.

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push --dry-run
   supabase db push
   ```

2. Dashboard에서 Queues, Cron, pg_net, Vault를 사용할 수 있는지 확인합니다. migration이 pgmq 큐, 전용 비공개 테이블, Storage 버킷·정책, Realtime 상태 테이블을 추가합니다. `math_private`를 Data API의 노출 스키마에 추가하지 마세요. 기존 프로젝트에 넓은 Storage 접근 정책이 있다면 두 전용 버킷에 영향을 주는지 확인하세요. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Storage 권한](https://supabase.com/docs/guides/storage/security/access-control)
3. 루트의 `.env.example`을 `.env.local`로 복사하고 아래 공개 설정을 채웁니다. 개발 서버를 다시 시작하면 Supabase Auth 로그인 화면으로 바뀝니다.
4. `supabase/secrets.example`을 `supabase/secrets.env`로 복사합니다. 서버 값을 입력하고 배포합니다.

   ```sh
   supabase secrets set --env-file supabase/secrets.env
   supabase functions deploy assessment
   supabase functions deploy account
   supabase functions deploy worker
   ```

5. **Vault**에서 `math_worker_url`에는 해당 프로젝트의 `https://YOUR_PROJECT_REF.supabase.co/functions/v1/worker`를, `math_worker_secret`에는 Edge의 `WORKER_SECRET`과 동일한 값을 등록합니다. SQL Editor에서 `supabase/cron.sql`을 실행합니다. Cron이 매분 워커를 호출하며, 전역 동시 처리 수는 `math_private.settings.concurrency`에서 조정합니다. 기본 3으로 시작합니다. [Supabase Queues](https://supabase.com/docs/guides/queues) · [예약 함수 호출](https://supabase.com/docs/guides/functions/schedule-functions)
6. Auth 설정에서 **Site URL**을 실제 앱 도메인으로 설정하고 허용할 로그인 복귀 도메인을 명시합니다. Edge의 `APP_ORIGINS`에도 같은 origin을 추가합니다. 평가 링크의 로그인 복귀는 현재 앱의 `/a/<UUID>` 경로를 유지합니다. [Edge 인증](https://supabase.com/docs/guides/functions/auth)
7. 검증된 교사 Auth 계정을 만든 뒤 SQL Editor에서 `scripts/provision.sql`의 학교, 학급 및 교사 UUID를 채워 실행합니다. 새 학급 UUID는 Dashboard SQL Editor에서 `select id,name from math_private.classes;`로 확인합니다.
8. 학생은 승인된 명부를 기준으로 등록합니다. 관리자 전용 터미널에서 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Edge와 동일한 `CODE_PEPPER`를 설정합니다. 저장소 밖의 새 파일 경로를 `ACTIVATION_OUTPUT`에 지정하고 다음을 실행합니다.

   ```sh
   node scripts/enroll.mjs CLASS_UUID 0101 "연습 학생"
   ```

   관리자가 코드 파일을 해당 학생에게 개별 전달합니다. 학생은 **학생 활성화**에서 학번·코드와 새 비밀번호(6자 이상)를 입력합니다. 코드는 발급 후 24시간 동안 유효하며 한 번 사용하면 폐기됩니다. 이후 **학생** 탭에서 학번과 본인이 정한 비밀번호로 로그인합니다. 학교·학년도는 서버의 `STUDENT_SCHOOL_BASE64`(또는 `STUDENT_SCHOOL`), `STUDENT_YEAR` 설정을 사용하며 학생에게 입력받지 않습니다. 학번은 해당 학교·학년도 안에서 중복되지 않아야 하며, 앞자리 0을 포함한 문자열 그대로 등록합니다. 활성화 코드 방식은 관리자 등록 도구를 사용할 때의 절차입니다. 코드 재발급은 같은 명령의 마지막 인수에 해당 학생의 기존 Auth UUID를 넣습니다. 운영자는 학번과 Auth UUID를 확인하고 재발급해야 합니다. 교사 로그인은 승인된 이메일 계정을 사용합니다.

### 환경별 설정

| 위치 | 변수 | 용도 |
|---|---|---|
| Vite/Netlify 공개 환경 | VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY | 해당 환경의 Supabase URL과 publishable key |
| Vite/Netlify 공개 환경 | VITE_APP_ORIGIN | 링크·QR의 기준 도메인. 생략하면 접속 origin |
| Edge secrets | APP_ORIGINS | 허용할 앱 origin을 쉼표로 연결. 경로·마지막 슬래시 제외 |
| Edge secrets | STUDENT_SCHOOL_BASE64, STUDENT_SCHOOL, STUDENT_YEAR | 학생 계정 학교명·학년도. 한글 환경변수 손상을 피하기 위해 UTF-8 Base64 학교명을 우선 사용하며 없으면 STUDENT_SCHOOL 사용. 명부와 일치하도록 지정하고 새 학년도 운영 시 갱신 |
| Edge secrets | AI_PROVIDER, AI_MODEL, AI_API_KEY | 공급자 openai, 계정에서 사용 가능한 이미지·구조화 출력 모델, 서버 API 키 |
| Edge secrets | WORKER_SECRET, CODE_PEPPER | 별도로 생성한 긴 무작위 값. 워커 인증 및 학생 코드 해시용 |
| Supabase 런타임 | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | 서버에서만 사용하는 프로젝트 설정 |
| Supabase Vault | math_worker_url, math_worker_secret | Cron 호출 주소 및 워커 인증값 |

서버 환경에서 `node scripts/check-model.mjs`를 실행하면 지정한 모델에 대한 계정 접근 여부를 확인합니다. 실제 이미지 입력과 스키마 호환성은 가상 문제 하나를 생성·검토해 확인합니다. 공급자 호출은 `_shared/provider.ts`에 있고 작업 큐와 분리되어 있습니다. 운영 요금·할당량은 해당 계정의 설정을 확인하세요. [이미지 입력](https://developers.openai.com/api/docs/guides/images-vision) · [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs) · [Edge 실행 한도](https://supabase.com/docs/guides/functions/limits)

## Netlify에 배포하기

GitHub 저장소를 Netlify의 **Import an existing project**에서 연결합니다. 기본 디렉터리는 프로젝트 루트, **Build command**는 `npm run build`, **Publish directory**는 `dist`입니다. 위 표의 공개 환경변수만 설정하고 배포합니다. `netlify.toml`이 SPA 내부 주소를 처리합니다. 미리보기 환경에는 개발용 프로젝트 키를 설정합니다. 배포 후 시크릿 창에서 학급 링크를 직접 열어 로그인·복귀와 다른 반의 접근 거절을 확인합니다. [Netlify Vite 가이드](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/)

## 저장과 접근 경계

| 자료 | 저장·접근 방식 |
|---|---|
| 원본 PDF·이미지 | math-sources 비공개 버킷. 담당 교사와 소유 평가 관계 검증 |
| 학생에게 제시할 문제 | 선택한 영역의 PNG와 수식 노드만 공개 문항 버전에 저장. 캡처에는 원본 ID·쪽·회전·좌표·출력 크기 포함 |
| 채점 기준 | 교사용 작업본, 승인 버전, 배포 시 고정된 문항별 키. 학생 조회와 분리 |
| 필기 원본 | math-originals 비공개 버킷. 논리 좌표 1200×900. 제출 키·쪽 순서·파일별 크기 및 SHA-256을 고정 |
| 제출 접수 | prepare → 최초 파일 INSERT → seal → 파일 검증 → commit. 마지막 DB 트랜잭션에서 제출 회차·작업·큐를 함께 기록 |
| 분석 | 문항 버전과 학생 제출은 각각 별도의 작업 대상. 가시성 제한, lease 및 token 검증 후 결과 저장과 archive |
| 교사 평가 | AI 원본, 교사 리뷰, 공개본을 별도 보존. 점수 공개는 지정한 회차·리뷰의 스냅샷 |
| Realtime | 각 사용자가 읽을 수 있는 갱신 시각만 발행. 클라이언트가 권한이 적용된 조회로 실제 자료를 가져옴 |

`math_private.settings.slot_retention`은 미확정 업로드 보존 기간입니다. 워커가 유휴 시 만료 슬롯을 막고 Storage API로 정리합니다. 확정본과 성적은 별도 학교 보존 기준에 따라 관리해야 합니다. 외부 AI 호출 직후 워커가 중단되면 호출과 과금이 중복될 수 있으며 결과 저장은 fencing token으로 보호합니다.

## 파일과 연결 지점

| 경로 | 책임 |
|---|---|
| index.html, src/main.tsx, src/style.css | 앱 진입점, 로그인·역할별 메뉴·학습 보드, 반응형 디자인 |
| src/Author.tsx, Capture.tsx, MathEditor.tsx | 출제·승인·복사·배포, PDF.js 영역 선택, 공통 LaTeX 편집 |
| src/Notebook.tsx, api.ts | Pointer Events 필기, IndexedDB, revision, 오프라인 제출 복구 |
| src/Review.tsx, Progress.tsx, Bulk.tsx | 회차별 검토·공개, 원본 비교, 기록·일괄 공개 |
| supabase/migrations, supabase/functions, supabase/cron.sql | DB·Storage 권한, Auth 명부, 명령 처리, 작업 큐 및 AI |
| dev, tests, scripts | 로컬 가상 교실, 자동 검증, 관리자 등록·스테이징 부하 측정 |

기존 수학교실이 연결될 때는 기존 Supabase Auth UUID와 학급 명부를 이 모듈의 멤버십에 대응시키고 수행평가 메뉴에서 앱을 엽니다. 수다노트의 연결 지점은 학생이 공개 피드백 아래 **성찰 저장**을 누른 시점입니다. 검증 결과와 실기 절차는 [TESTING.md](TESTING.md)에 있습니다.
