# ShotCL Google 계정·게스트 초대 설정

이 문서는 Google OAuth, 계정별 프로젝트 membership, 테스트 편집자 제한, 로그인 없는 초대 링크를 배포할 때 필요한 구조와 수동 설정을 설명합니다. 비밀값은 저장소에 기록하지 않습니다.

## 구현 전 구조 감사

- 설치된 런타임은 `@supabase/supabase-js 2.110.0`이며 새 인증 프레임워크나 Google SDK는 추가하지 않았습니다.
- 기존 로그인은 browser Supabase client의 email OTP가 전부였고, 전역 session provider와 OAuth callback은 없었습니다.
- 공유 프로젝트 접근은 `shotcl_project_session` HttpOnly cookie와 `project_access_sessions`의 browser-token hash를 사용했습니다. 프로젝트명과 4자리 비밀번호는 요청 중에만 사용하며 localStorage에 저장하지 않았습니다.
- localStorage/sessionStorage에는 최근 프로젝트 ID와 숨김 preference만 저장했습니다. Google 로그인 후에는 `project_members.user_id = auth.users.id`가 프로젝트 목록의 canonical source입니다.
- canonical membership은 `project_members(project_id, user_id)` unique relation이며 role은 DB의 `admin | crew`, UI의 유효 role은 `admin | progress`입니다. `projects.created_by`는 owner identity입니다.
- 기존 초대 링크는 raw token을 URL에서 받고 DB에는 hash/HMAC 재구성 정보만 저장했지만, redemption 후 일반 browser grant를 만들었습니다. 새 흐름은 이를 guest 전용 capability cookie로 분리했습니다.
- 대부분의 최신 업무 테이블은 service-role API 뒤에 있고 일부 핵심 테이블은 authenticated RLS도 사용합니다. 기존 `shots_update_members`는 non-allowlisted 사용자의 직접 mutation 경로였으므로 새 migration에서 제거합니다.
- `storyboards` Storage bucket은 기존부터 public URL을 사용합니다. 앱의 guest API는 현재 회차의 필요한 자료만 반환하지만, 이미 발급된 public URL 자체를 revoke하는 것은 불가능합니다. 완전한 미디어 기밀성이 필요하면 별도 작업으로 private bucket과 짧은 signed URL로 전환해야 합니다.

## 최종 권한 모델

| 접근 주체 | 프로젝트 목록 원본 | 읽기 | 쓰기 |
| --- | --- | --- | --- |
| Allowlisted Google admin/owner | `project_members` | membership 범위 | 관리·편집 가능 |
| Allowlisted Google crew | `project_members` | Staff 범위 | 기존 현장 OK/OMIT만, 자동 Key staff 아님 |
| Non-allowlisted Google member | `project_members` | Staff/read-only 범위 | 없음 |
| Password-only legacy session | `project_access_sessions` | 기존 호환 read-only | 없음 |
| Invite guest | active invite capability | Progress·Scenario만 | 없음 |

관리 권한은 항상 `검증된 Google identity + server allowlist + 해당 project의 admin/owner membership`을 함께 요구합니다. email 문자열만으로 role을 만들지 않습니다. Key staff 비밀번호도 이 세 조건을 우회하지 못합니다.

## Auth와 account persistence

- Main의 compact account control에서 Supabase `signInWithOAuth({ provider: "google" })` redirect flow를 시작합니다.
- browser client는 PKCE를 사용하고 `/auth/callback`에서 code를 한 번만 교환합니다. `next`는 앱 내부 절대 경로만 허용합니다.
- `AuthSessionProvider`가 초기 session을 한 번 확인하고 `onAuthStateChange` 한 개를 구독합니다. 같은 access token의 중복 sync를 합칩니다.
- server는 Supabase `auth.getUser(accessToken)`으로 uid와 confirmed email을 검증하고, `user.identities`의 Google 연결을 우선 확인합니다. identities가 생략된 응답에서는 `app_metadata.providers`와 primary provider를 보조로 확인한 뒤 12시간짜리 opaque `shotcl_account_session` HttpOnly cookie로 교환합니다. Google access/refresh token은 앱 DB에 저장하지 않습니다.
- account cookie는 로그인·token refresh sync마다 새 opaque token으로 회전하며, 이전 hash 삭제와 새 hash 생성을 DB transaction 하나로 처리합니다.
- Main project list는 로그인 확인 후 lazy load하며 `project_members`만 조회합니다. account switch 시 화면 state와 preference namespace가 즉시 교체됩니다.
- Join 성공 시 현재 `auth.users.id`에 crew 또는, allowlisted 계정이 정확한 Key staff 비밀번호를 사용한 경우에만 admin membership을 upsert합니다. 기존 admin은 downgrade하지 않습니다.
- 새 프로젝트는 allowlisted Google 계정만 만들 수 있으며 `created_by`와 admin membership을 함께 기록합니다.

## Editor allowlist와 RLS

- source of truth: server-only `SHOTCL_EDITOR_GOOGLE_EMAILS`.
- 형식: 쉼표 또는 줄바꿈 구분. 비교는 trim + lowercase만 적용하고 Gmail plus alias를 합치지 않습니다.
- 빈 값은 fail-closed이며 모든 write를 막습니다.
- OAuth/account sync 때 service role만 쓸 수 있는 `shotcl_editor_accounts`에 75분짜리 eligibility를 동기화합니다. server API는 현재 env를 매 요청 비교하고, direct Supabase RLS는 다음 로그인/token refresh sync에서 즉시 반영되며 sync가 끊겨도 eligibility가 만료되어 fail-closed 됩니다.
- `is_shotcl_editor()`와 `is_project_admin(project_id)`를 동시에 만족해야 핵심 authenticated write policy를 통과합니다.
- service-role key, 전체 allowlist, password, raw invite token은 client bundle/응답/log에 넣지 않습니다.

## Guest invite 구조

- Supabase anonymous auth는 사용하지 않습니다. Dashboard에서 Anonymous sign-ins를 켤 필요가 없습니다.
- invite URL의 token을 same-origin POST로 검증한 뒤 raw capability를 30일 `shotcl_guest_invite` HttpOnly/SameSite=Lax/Secure cookie에 둡니다. DB에는 raw token을 저장하지 않습니다.
- 매 guest API 요청에서 invite hash, active/revoked 상태, project ID를 다시 확인합니다. rotate/revoke하면 기존 guest cookie도 다음 요청부터 즉시 거부됩니다.
- 허용 route는 동일 프로젝트의 project summary, daily-plan list, 선택 회차 shots, 선택 회차 Progress media/diagram, Scenario 자료 GET뿐입니다. mutation과 Staff/Basic Info/Home/일촬표/의상/Archive/초대 관리 route는 중앙에서 거부합니다.
- guest shell은 Progress와 Scenario 두 navigation 및 작은 `Google 계정으로 저장` action만 표시합니다.
- guest는 direct Supabase Realtime에 가입시키지 않습니다. HttpOnly capability를 public Realtime/RLS로 넓히지 않았으며 현재 데이터는 재진입/새로고침 때 갱신됩니다.
- OAuth가 실패해도 guest cookie는 유지합니다. 성공하면 active invite를 다시 검증하고 Google uid에 crew membership을 idempotent하게 upsert한 뒤 guest cookie를 제거하고 Progress로 돌아갑니다. Allowlisted email이어도 자동 admin이 되지 않습니다.

## Migration

새 파일: `supabase/migration_shotcl_account_access.sql`

목적:

1. private `shotcl_editor_accounts`, `shotcl_account_sessions`와 원자적 account-session 회전 RPC 생성.
2. service-role-only membership-link RPC 생성. 기존 admin을 보존하고 중복 membership을 만들지 않음.
3. 기존 reusable invite에 account creator를 점진 추가하고, allowlisted Google owner/admin 전용 create/rotate/revoke RPC 생성.
4. 프로젝트, member 관리, 일촬표, 컷, 분석, 기본정보, 달력, storyboard storage write를 editor+project-admin으로 제한.
5. `shots_update_members` direct write 제거.
6. RLS가 없던 `shot_diagrams`를 service-role API 전용으로 잠금.

Guest SELECT policy는 추가하지 않습니다. Guest는 active capability를 검증한 exact server GET API만 사용합니다. `supabase/migration_shot_diagrams.sql`은 이 작업에서 수정하지 않았습니다.

적용 순서:

1. 현재 운영 DB의 기존 ShotCL schema와 `supabase/migration_project_staff_invites.sql`을 포함한 기존 migration이 모두 적용되어 있는지 확인합니다.
2. **배포 전에 최소 1개의 owner Google email을 `SHOTCL_EDITOR_GOOGLE_EMAILS`에 등록합니다.**
3. Supabase SQL Editor에서 `supabase/migration_shotcl_account_access.sql`을 사용자가 직접 적용합니다.
4. 그 다음 애플리케이션을 배포합니다. Codex는 원격 migration을 실행하지 않았습니다.

기존 `created_by` 연결이 없는 프로젝트는 allowlisted owner가 Google 로그인 후 기존 Key staff 비밀번호로 Join하면 안전하게 admin membership을 bootstrap할 수 있습니다. project ID나 email만으로 owner를 claim할 수는 없습니다.

## Google Cloud 수동 설정

Google Auth Platform에서 Web application OAuth client를 만듭니다.

Authorized JavaScript origins:

- `https://shot-cl.vercel.app`
- `http://localhost:3002`

Authorized redirect URI:

- `https://rujliohugaxhvxasshed.supabase.co/auth/v1/callback`

Supabase가 Google provider callback을 소유하므로 Google Cloud에는 앱의 `/auth/callback`이 아니라 위 Supabase callback을 등록합니다. Scope는 `openid`, email, profile의 기본 범위만 사용합니다.

## Supabase Dashboard 수동 설정

1. Authentication → Providers → Google을 활성화합니다.
2. Google Cloud의 Client ID와 Client Secret을 입력합니다.
3. Authentication → URL Configuration의 Site URL을 `https://shot-cl.vercel.app`로 설정합니다.
4. Redirect URLs에 다음 exact URL을 추가합니다.
   - `https://shot-cl.vercel.app/auth/callback`
   - `http://localhost:3002/auth/callback`
5. Vercel preview OAuth도 테스트할 경우에만 신뢰하는 preview pattern을 별도 추가합니다. production은 exact callback을 유지합니다.
6. Anonymous sign-ins는 이 guest 구조에 필요하지 않습니다.

참고: [Supabase Google Login](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Vercel environment

Production, Preview(필요한 경우), Development에 실제 범위대로 설정합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=https://rujliohugaxhvxasshed.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<existing anon key>
SUPABASE_SERVICE_ROLE_KEY=<existing server-only service role key>
SHOTCL_EDITOR_GOOGLE_EMAILS=owner@gmail.com,editor@gmail.com
```

`SHOTCL_EDITOR_GOOGLE_EMAILS`와 `SUPABASE_SERVICE_ROLE_KEY`에는 절대 `NEXT_PUBLIC_`을 붙이지 않습니다. `.env.local`과 secret은 commit하지 않습니다.

## 배포 후 smoke test

1. allowlisted Google 계정: 로그인, New, 기존 프로젝트 Key staff Join/upgrade, autosave 확인.
2. non-allowlisted Google 계정: project membership 목록은 보이지만 New/upgrade/input/mutation이 거부되는지 확인.
3. account A/B 전환: 서로의 project list와 canEdit state가 남지 않는지 확인.
4. KakaoTalk iPhone/Android WebView: invite → 로그인 없이 Progress → Scenario 확인.
5. guest에서 OK/OMIT, 업로드, 편집 API를 직접 호출해 401/403인지 확인.
6. guest URL의 project ID를 다른 project로 바꿔 read가 거부되는지 확인.
7. invite rotate/revoke 후 신규 및 기존 guest request가 거부되는지 확인.
8. guest `Google 계정으로 저장` → OAuth → Progress 복귀 → Main membership 표시 확인.
9. guest에서 저장한 allowlisted 계정도 crew로 남고 자동 Key staff가 아닌지 확인.
10. authenticated member는 invite revoke 후에도 membership이 유지되는지 확인.

Google Cloud, Supabase Dashboard, Vercel 환경변수, 원격 SQL 적용은 모두 수동 단계입니다.
