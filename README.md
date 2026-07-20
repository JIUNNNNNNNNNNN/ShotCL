# 오늘의 스토리보드 진행 관리 앱 MVP

촬영 현장에서 오늘 찍을 컷 리스트를 공유하고, 각 컷의 OK/omit 상태를 빠르게 바꾸는 모바일 최적화 PWA입니다.

## 1단계: 파일 구조

```text
app/
  page.tsx                         프로젝트 목록
  projects/new/page.tsx            프로젝트 생성
  projects/[id]/page.tsx           오늘의 컷 리스트
  projects/[id]/upload/page.tsx    PDF/Excel/이미지 업로드 + 컷 단위 mock AI 분석
  projects/[id]/analysis-runs/page.tsx
                                  AI 원본 결과와 최종 확정 결과 비교 기록
  projects/[id]/edit/page.tsx      새 편집 방식 안내
  login/page.tsx                   Supabase 이메일 매직링크 로그인
  api/analyze-storyboard/route.ts  서버 AI 분석 API 자리
components/                        공통 UI
lib/
  ai/                              mock AI와 실제 AI 연결 자리
  data/                            Supabase/로컬 저장소 공통 데이터 함수
  realtime/                        Supabase Realtime 구독
  supabase/                        Supabase 클라이언트
supabase/schema.sql                새 설치용 Supabase 테이블/정책/스토리지 SQL
supabase/mvp_dev_projects_safe.sql 프로젝트 생성/조회 복구용 안전 SQL
supabase/migration_shots_cut_status_image.sql
                                  기존 DB 업데이트용 migration SQL
supabase/migration_analysis_runs.sql
                                  AI 분석 기록용 migration SQL
supabase/migration_analysis_text_quality.sql
                                  한글 깨짐 감지/실패 기록용 migration SQL
public/manifest.webmanifest        PWA 설정
public/sw.js                       서비스 워커
```

## 2단계: 설치와 실행

```bash
npm install
npm run dev
```

개발 서버는 `0.0.0.0:3002`로 실행되도록 고정되어 있습니다.

- 컴퓨터에서 접속: `http://localhost:3002`
- 휴대폰에서 접속: `http://현재컴퓨터IP:3002`

먼저 데스크탑 브라우저에서 `http://localhost:3002`가 정상으로 열리는지 확인하세요. 관리자 작업인 프로젝트 생성, 문서 업로드, 컷 리스트 정리는 데스크탑에서 먼저 안정화한 뒤 휴대폰 반응형 화면을 확인하는 순서가 좋습니다.

`localhost`는 앱을 실행 중인 컴퓨터에서만 여는 주소입니다. 데스크탑에서 확인할 때는 `http://localhost:3002`를 사용하고, 휴대폰에서 확인할 때는 `localhost` 대신 Mac의 Wi-Fi IP 주소를 사용해야 합니다.

데스크탑 기본 테스트 순서:

1. `http://localhost:3002`에서 프로젝트 목록을 확인합니다.
2. “새 프로젝트”를 눌러 `/projects/new`로 이동합니다.
3. 프로젝트명, 촬영일, 설명을 입력하고 프로젝트를 생성합니다.
4. 생성 후 상세 페이지로 이동하는지 확인합니다.
5. 로고 또는 목록 링크로 돌아와 프로젝트 카드가 보이는지 확인합니다.
6. 새로고침 후에도 프로젝트가 남아 있는지 확인합니다.
7. 상세 페이지 주소를 직접 열어 프로젝트 정보가 보이는지 확인합니다.

## 2-1단계: 휴대폰에서 테스트하는 방법

1. Mac과 휴대폰을 같은 Wi-Fi에 연결합니다.
2. Mac에서 아래 명령어로 Wi-Fi IP를 확인합니다.

```bash
ipconfig getifaddr en0
```

3. 예를 들어 IP가 `192.168.68.113`이면, iPhone Safari에서 아래 주소를 엽니다.

```text
http://192.168.68.113:3002
```

4. Mac에서 먼저 `http://localhost:3002`가 열리는지 확인합니다.
5. 휴대폰에서만 안 열리면 Mac 방화벽, VPN, 서로 다른 Wi-Fi, 게스트 Wi-Fi의 기기 간 차단 설정을 확인합니다.

Next.js 터미널에 `Local`과 `Network` 주소가 표시됩니다. `Network` 주소가 `http://0.0.0.0:3002`로 보일 수 있는데, 휴대폰에서는 `0.0.0.0` 대신 위에서 확인한 실제 Mac IP를 넣어야 합니다.

## 3단계: 개발 모드

`.env.local`이 비어 있으면 Supabase 없이도 앱이 동작합니다.

- 프로젝트, 업로드 파일 기록, 컷 리스트가 브라우저 localStorage에 저장됩니다.
- 분석 원본 결과, 사람이 확정한 최종 결과, 컷 단위 비교 기록도 localStorage에 저장됩니다.
- mock AI 분석으로 컷 15개가 생성됩니다.
- 실시간 기능은 같은 브라우저의 탭 사이에서 테스트할 수 있습니다.

Supabase 환경변수를 넣었지만 아직 로그인 UI 없이 테스트하고 싶다면 두 가지 중 하나를 고르면 됩니다.

- 가장 쉬운 방법: `.env.local`에서 `NEXT_PUBLIC_USE_LOCAL_DATA=true`로 바꿔 localStorage 개발 모드를 강제로 사용합니다.
- Supabase DB에 실제 저장하는 방법: Supabase Dashboard의 Authentication 설정에서 Anonymous sign-ins를 켜고 `NEXT_PUBLIC_ENABLE_DEV_ANON_AUTH=true`를 둡니다. 이 방식은 RLS를 풀지 않고도 로그인 화면 없이 `authenticated` 세션으로 프로젝트 생성/조회가 됩니다.

## 4단계: 환경변수

`.env.local.example`을 복사해서 `.env.local`을 만듭니다.

```bash
cp .env.local.example .env.local
```

`.env.local` 예시:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_USE_LOCAL_DATA=false
NEXT_PUBLIC_ENABLE_DEV_ANON_AUTH=true
OPENAI_API_KEY=
USE_REAL_AI=false
OPENAI_PDF_VISION_MODEL=gpt-5
TESSERACT_PATH=
TESSERACT_LANG=kor+eng
TESSDATA_PREFIX=
```

`OPENAI_API_KEY`는 서버 API route에서만 사용합니다. `NEXT_PUBLIC_`이 붙지 않은 값은 브라우저에 노출하지 않습니다.

### Open-Meteo 날씨 자동 입력

일촬표의 날씨 자동 입력은 API 키가 필요 없는 Open-Meteo를 사용합니다. 별도의 회원가입이나 `.env.local` 설정 없이 촬영일과 날씨 기준 지역 또는 대표 LOCATION 주소를 입력한 뒤 “날씨 자동 입력” 버튼을 누르면 됩니다. 자동 예보를 찾지 못해도 날씨, 기온, 강수 확률, 일몰 시간은 계속 직접 입력할 수 있습니다.

일촬표의 촬영 장소 기능에는 지도 API 키가 필요하지 않습니다. 장소명과 주소를 직접 입력하거나 “주소 검색” 버튼으로 Daum 우편번호 서비스를 열 수 있습니다. “네이버 지도에서 열기”는 입력한 장소명과 주소를 네이버 지도 검색 페이지로 전달하는 일반 링크이며, 앱 안에 지도나 로드뷰를 삽입하지 않습니다.

## 5단계: Supabase 설정

1. Supabase 프로젝트를 만듭니다.
2. 새 프로젝트라면 SQL Editor에서 `supabase/schema.sql` 내용을 실행합니다.
3. 프로젝트 생성/조회가 막혀 있다면 SQL Editor에서 `supabase/mvp_dev_projects_safe.sql` 내용을 실행합니다.
4. 기존 MVP DB가 이미 있다면 `supabase/migration_shots_cut_status_image.sql`을 실행합니다.
5. AI 분석 기록 기능을 쓰려면 `supabase/migration_analysis_runs.sql`을 실행합니다.
6. 이전에 `migration_analysis_runs.sql`을 이미 실행했다면 `supabase/migration_analysis_text_quality.sql`도 실행합니다.
7. Authentication에서 이메일 로그인을 켭니다.
8. 로그인 화면 없이 MVP를 테스트하려면 Authentication 설정에서 Anonymous sign-ins를 켭니다.
9. Storage에 `storyboards` 버킷이 생겼는지 확인합니다.
10. Realtime에서 `public.shots` 테이블이 활성화되어 있는지 확인합니다.

Supabase 환경변수를 넣으면 `/login`에서 이메일 매직링크 로그인을 사용할 수 있습니다. 개발 모드에서는 localStorage 또는 Anonymous Auth로 로그인 화면 없이 테스트할 수 있습니다.

메인 화면 하단의 “개발용 Supabase 점검” 패널은 개발 중에만 보입니다. 키 전체 값은 보여주지 않고 URL/anon key 설정 여부, 인증 세션, `projects` select/insert 결과와 Supabase error message/code/details를 화면에 표시합니다.

모든 화면 하단에는 개발 중에만 “현재 접속 주소”와 “현재 페이지”가 표시됩니다. 예를 들어 데스크탑에서 열었다면 `현재 접속 주소: http://localhost:3002`처럼 보입니다.

프로젝트 상세 화면 하단에는 개발 중에만 “개발용 초기화” 영역이 보입니다. “현재 프로젝트 컷 목록 초기화” 버튼은 현재 프로젝트의 컷 목록만 삭제하고 프로젝트 정보와 분석 기록은 유지합니다. 삭제 전 확인창이 뜨며, 사용자가 버튼을 누르지 않으면 어떤 데이터도 자동으로 삭제되지 않습니다.

## 6단계: mock AI 분석

현재 분석 흐름은 다음 파일로 나뉘어 있습니다.

- `lib/ai/mockAnalyzeStoryboard.ts`: 파일 이름 기반 임시 컷 15개 생성
- `lib/ai/analysisRules.ts`: 컷 단위 분석 프롬프트와 감지 후보 수/경고 계산
- `lib/analyzers/extractExcel.ts`: CSV/TSV/XLSX 행과 시트 추출
- `lib/analyzers/extractPdf.ts`: PDF 텍스트 스트림 추출
- `lib/analyzers/buildShotCandidates.ts`: 추출 행/텍스트를 컷 후보로 분리
- `lib/ai/analyzeShotCandidates.ts`: 컷 후보를 저장 전 미리보기용 shot JSON으로 정리
- `app/api/projects/[projectId]/analyze/route.ts`: 파일 원본을 받아 분석 결과만 반환하는 서버 API

실제 AI를 붙일 때는 `USE_REAL_AI=true`로 바꾸고 `analyzeShotCandidates()` 안에서 OpenAI 호출을 구현하면 됩니다.

분석 원칙은 씬 단위가 아니라 컷 단위입니다. Excel은 행 하나를 컷 후보로 보고, PDF/이미지는 C#, Cut, Shot, 컷, 콘티 같은 패턴을 기준으로 최대한 많이 분리하는 방향입니다.

분석 결과는 바로 컷 리스트에 저장되지 않습니다. 업로드 화면에서 “컷 단위 분석”을 누르면 먼저 미리보기 표가 나타나고, 사용자가 저장 버튼을 눌러야 컷 리스트에 반영됩니다.

- 분석 직후 `analysis_runs`에 AI 원본 결과가 `preview` 상태로 저장됩니다.
- 사람이 미리보기에서 수정하고 확정하면 `shots`에 저장되고, `analysis_runs`에는 최종 확정 결과가 `confirmed` 상태로 저장됩니다.
- 컷 단위 비교 결과는 `analysis_run_items`에 저장됩니다.
- AI 분석 전에는 추출된 원본 텍스트 품질을 검사합니다.
- Excel/CSV에서 한글이 깨진 것으로 보이면 AI 분석을 중단하고 `analysis_runs`에 `failed`, `failure_reason=encoding_error`로 기록합니다.
- PDF에서 내부 텍스트가 깨졌거나 거의 없으면 실패 처리하지 않고 PDF 페이지를 이미지로 변환한 뒤 OCR/이미지 분석 fallback으로 전환합니다.
- OCR/이미지 분석까지 실패한 경우에만 `failed`로 기록합니다.
- 깨진 Excel 분석이나 OCR 실패 분석은 미리보기 표에 표시하지 않고, `shots`와 `final_confirmed_shots`에도 저장하지 않습니다.
- 기존 컷이 없으면 “컷 리스트에 추가” 버튼이 보입니다.
- 기존 컷이 있으면 “기존 컷 뒤에 추가”, “기존 컷 삭제 후 교체”, “취소”를 선택할 수 있습니다.
- “기존 컷 삭제 후 교체”는 확인창을 통과한 뒤에만 기존 컷을 삭제합니다.
- 개발 모드의 “분석 미리보기 초기화” 버튼은 아직 DB에 저장하지 않은 미리보기만 지우며, 저장된 컷 목록은 건드리지 않습니다.

분석 기록 확인 주소:

```text
http://localhost:3002/projects/프로젝트ID/analysis-runs
```

저장 흐름:

```text
파일 업로드
→ 파일 텍스트/표 추출
→ 텍스트 품질 검사
→ PDF 텍스트가 깨지면 PDF 페이지 이미지 변환
→ OCR/이미지 분석 fallback
→ 정상일 때만 AI 분석 또는 이미지 분석 결과 저장
→ AI 원본 결과 저장
→ 미리보기
→ 사람이 수정
→ 최종 확정
→ shots 저장
→ 최종 결과도 analysis_runs에 저장
```

개발 테스트용 샘플 파일:

```text
samples/daily-shooting-sample.csv
```

API 직접 테스트 예시:

```bash
curl -X POST http://localhost:3002/api/projects/test-project/analyze \
  -F "file=@samples/daily-shooting-sample.csv;type=text/csv" \
  -F "fileName=daily-shooting-sample.csv" \
  -F "projectName=데스크탑 테스트" \
  -F "shootDate=2026-07-20"
```

응답은 `summary`, `shots`, `candidates`, `debug`를 포함합니다. 개발 모드에서는 미리보기 아래 “개발자 디버그” 영역에서 추출 텍스트, 감지 컬럼, 컷 후보 raw data를 확인할 수 있습니다.

업로드 화면에는 “PDF / 문서 추출 품질 확인”이 표시됩니다. PDF는 내부 텍스트 추출 결과와 OCR 이미지 분석 결과를 따로 보여줍니다. PDF 내부 텍스트가 깨져도 OCR 결과가 정상 한글이면 분석을 계속 진행하고, OCR 결과도 깨지면 분석표를 보여주지 않고 더 선명한 PDF나 페이지 캡처 이미지를 업로드하라고 안내합니다.

PDF fallback 기록에는 `extraction_method`, `native_text_preview`, `native_text_quality`, `ocr_text_preview`, `ocr_text_quality`, `ocr_engine`, `ocr_language`, `available_languages`, `ocr_succeeded`, `ocr_failure_reason`, `rendered_page_count`, `rendered_image_info`가 `analysis_runs.debug_payload`에 저장됩니다. 개발 모드에서는 OCR에 실제로 들어간 첫 번째 PDF 페이지 이미지도 업로드 화면에서 확인할 수 있습니다.

한국어 OCR을 제대로 쓰려면 Tesseract와 한국어 언어 데이터가 필요합니다. Mac에서는 예를 들어 Homebrew로 `tesseract`와 한국어 traineddata를 설치한 뒤 `.env.local`에 `TESSERACT_LANG=kor+eng`를 둡니다. 한국어 언어 데이터가 없으면 화면에 “현재 OCR 엔진에 한국어 인식 데이터가 없어 PDF 일촬표를 읽을 수 없습니다”라는 안내가 표시됩니다.

Tesseract OCR이 계속 실패하는 PDF는 OpenAI 비전 분석으로 자동 전환됩니다. 이 경우 `.env.local`에 `OPENAI_API_KEY`가 있어야 하며, 서버는 렌더링된 PDF 페이지 이미지를 비전 모델에 직접 전달해 `vision_image` 방식으로 컷 리스트 JSON을 만듭니다. `OPENAI_PDF_VISION_MODEL` 값으로 사용할 모델을 바꿀 수 있습니다. OCR 실패는 최종 실패가 아니라 `vision_image` 전환 조건입니다.

분석 기록 화면에서는 “개선 데이터 JSON 내보내기” 버튼으로 AI 원본 컷, 최종 확정 컷, 사용자 피드백, 경고, 컷 단위 비교 결과를 `.json` 파일로 받을 수 있습니다. OCR까지 실패한 분석이나 최종 확정 컷이 없는 기록은 개선 데이터로 내보낼 수 없습니다.

## 7단계: 주요 기능

- 프로젝트 생성/목록
- PDF/JPG/PNG/HEIC 파일 업로드 UI
- 휴대폰 카메라 촬영 업로드 UI
- mock AI 컷 리스트 15개 생성
- 컷 상태 변경: pending, OK, omit
- 전체 컷 수 / OK 수 / omit 수 / 남은 컷 수 표시
- 전체 / 남은 컷 / OK / omit 필터
- 컷 카드 클릭으로 수정 bottom sheet 열기
- 하단 “새 컷 추가” 버튼으로 추가 bottom sheet 열기
- 컷 추가/수정/삭제/순서 변경
- 컷별 콘티 이미지 수동 업로드
- 콘티 썸네일과 큰 이미지 미리보기
- 위로/아래로 버튼을 통한 촬영 순서 변경
- AI 원본 결과와 최종 확정 결과를 analysis_runs에 기록
- 컷 단위 변경/삭제/추가 비교를 analysis_run_items에 기록
- 분석 기록 화면과 개선 데이터 JSON 내보내기
- PDF 내부 텍스트 실패 시 이미지/OCR fallback 분석
- Supabase Realtime 구독 구조
- PWA manifest와 서비스 워커
- Supabase Auth 이메일 매직링크 로그인 화면

## 8단계: 배포

Vercel 배포가 가장 쉽습니다.

```bash
npm run build
```

빌드가 통과하면 Vercel에 프로젝트를 연결하고, Vercel 환경변수에 `.env.local`과 같은 값을 넣습니다.

## 다음 개발 추천 순서

1. 프로젝트 멤버 초대 화면 추가
2. admin/crew 역할에 따라 버튼 숨김 처리
3. 실제 OpenAI 분석 연결
4. PDF/Excel 실제 내용 추출 서버 처리
5. PDF 페이지별 이미지 변환/미리보기
6. 콘티 박스 자동 감지와 crop
7. HEIC 변환 또는 서버 처리
