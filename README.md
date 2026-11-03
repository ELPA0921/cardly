# 카들리 (Cardly) — 명함 관리 웹앱

명함을 촬영하면 OCR로 이름·회사·직책·연락처를 읽어 정리하고, 데이터는 **내 Google Drive**에 저장합니다.
빌드 도구 없이 HTML/CSS/JavaScript만으로 만들어져 있어서, 나중에 그대로 안드로이드 앱(Capacitor)으로 감쌀 수 있습니다.

## 기능

| 기능 | 내용 |
|---|---|
| 명함 촬영 | 휴대폰에서는 카메라가 바로 열림. 앨범 선택, 직접 입력도 가능 |
| OCR 자동 입력 | 이름, 회사명, 부서, 직책, 휴대폰, 전화, 팩스, 이메일, 주소, 홈페이지 |
| 인식 결과 고치기 | 인식된 글자 줄을 누르면 원하는 항목에 바로 넣을 수 있음. 사진 회전 / 다시 인식 |
| 공유 | `이름: 홍길동` / `회사명: 창조이엔지` … 형식의 텍스트로 카카오톡·문자 공유, 복사, 연락처 파일(vCard) |
| 그룹 | 그룹 여러 개 지정 가능, 색상, 그룹별 보기, 그룹 단위 연락처 파일 내보내기 |
| 검색 | 이름·회사·번호·이메일, **초성 검색**(ㅎㄱㄷ → 홍길동) |
| 중복 확인 | 같은 휴대폰/이메일 명함이 있으면 "덮어쓰기 / 별도 저장" 선택 |
| 저장 | 기기(브라우저)에 먼저 저장 → Google Drive `명함관리` 폴더와 자동 동기화 |
| 백업 | JSON 백업 내보내기/불러오기, 전체 vCard 내보내기 |
| 홈 화면 설치 | PWA라서 안드로이드 크롬에서 "홈 화면에 추가"로 앱처럼 실행 가능 |

> **갤럭시 주소록에 저장 (임시 방법)**: 명함 상세 → "연락처 파일" → 내려받은 `.vcf`를 열면 삼성 연락처에 저장됩니다.
> 기존 번호 덮어쓰기까지 자동으로 하는 기능은 앱 버전에서 만들 예정입니다.

## 로컬에서 실행

설치할 것 없이 PowerShell로 실행됩니다.

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

브라우저에서 http://localhost:5173 을 엽니다.
Google Drive 연결 없이도 바로 쓸 수 있고, 이때 데이터는 그 브라우저에만 저장됩니다.

## Google Drive 연결 설정 (처음 한 번)

1. [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트를 만듭니다.
2. **API 및 서비스 → 라이브러리**에서 `Google Drive API`를 **사용 설정**합니다.
3. **OAuth 동의 화면**
   - 사용자 유형: **외부(External)**
   - 앱 이름(예: 카들리), 지원 이메일 입력
   - 범위(Scope): `.../auth/drive.file` 추가 (앱이 만든 파일에만 접근하는 권한이라 민감 범위가 아님)
   - **테스트 사용자**에 본인과 지인들의 Gmail 주소 추가 (테스트 모드에서는 최대 100명)
4. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 JavaScript 원본: `http://localhost:5173` (배포 후에는 배포 주소도 추가, 예: `https://내아이디.github.io`)
5. 만들어진 클라이언트 ID(`xxxx.apps.googleusercontent.com`)를
   - 앱의 **설정 → 고급 설정**에 붙여넣거나,
   - 지인들에게 배포할 거라면 `js/config.js`의 `googleClientId`에 넣어 두세요. (클라이언트 ID는 비밀값이 아닙니다)
6. 앱 **설정 → Google Drive 연결**.

Drive에는 이렇게 저장됩니다.

```
내 드라이브/
└─ 명함관리/
   ├─ business-cards.json   ← 명함·그룹 데이터
   └─ card_xxxx.jpg         ← 명함 사진
```

각자 자기 Google 계정으로 로그인하므로 지인들의 데이터는 각자의 Drive에 따로 저장됩니다.

### 알아둘 점
- 서버 없이 브라우저만으로 로그인하는 방식이라 **로그인이 약 1시간마다 만료**됩니다.
  만료되면 상단의 "다시 연결"을 한 번 누르면 됩니다 (이미 허용한 계정이면 창이 바로 닫힘).
  앱 버전에서는 계속 로그인 상태가 유지되도록 바꿀 예정입니다.
- 오프라인에서도 추가/수정이 되고, 다음에 연결되면 동기화됩니다.
- 삭제한 명함의 사진은 Drive **휴지통**으로 이동합니다(복구 가능).

## OCR 방식

설정에서 고를 수 있습니다.

| 방식 | 비용 | 정확도 | 비고 |
|---|---|---|---|
| 기본 (Tesseract.js) | 무료 | 보통 | 기기 안에서 처리. 처음 한 번 한국어 데이터(약 10MB) 내려받음 |
| Google Cloud Vision | 월 1,000건 무료 | 높음 | 같은 Cloud 프로젝트에서 `Cloud Vision API` 사용 설정 + API 키 발급 (결제 계정 연결 필요) |

Vision API 키를 `config.js`에 넣어 배포한다면, Cloud Console에서 키에 **HTTP 리퍼러 제한**(배포 주소만 허용)과 **API 제한**(Cloud Vision API만)을 꼭 걸어 두세요.

## 지인들에게 배포 (무료 호스팅)

HTTPS 주소가 있어야 휴대폰 카메라/설치 기능이 제대로 동작합니다. 폴더를 그대로 올리면 됩니다.

- **GitHub Pages**: 저장소에 이 폴더 내용을 올리고 Settings → Pages 활성화
- **Netlify / Cloudflare Pages**: 폴더를 드래그&드롭

배포 후 그 주소를 OAuth 클라이언트의 "승인된 JavaScript 원본"에 추가해야 합니다.

## 폴더 구조

```
index.html            앱 화면
css/style.css         디자인 (라이트/다크 모드)
js/app.js             화면과 동작
js/parser.js          OCR 글자 → 명함 항목 추출 규칙
js/ocr.js             이미지 처리, Tesseract / Google Vision
js/store.js           로컬 저장소, 동기화 병합
js/sync.js            Google Drive 동기화
js/drive.js           Google 로그인 + Drive API
js/idb.js             명함 사진 캐시(IndexedDB)
js/share.js           공유 텍스트, vCard
js/fields.js          명함 항목 정의 (항목 추가 시 여기부터)
js/config.js          배포용 기본 설정
sw.js, manifest.webmanifest   PWA(홈 화면 설치, 오프라인)
tests/parser-test.html        항목 추출 테스트 (서버 실행 후 /tests/parser-test.html)
serve.ps1             로컬 테스트 서버
```

## 앱(안드로이드) 단계에서 할 일

- Capacitor로 이 웹 폴더를 감싸서 APK 생성
- `@capacitor-community/contacts` 플러그인으로 **갤럭시 주소록에 저장**
- 저장 전 주소록에서 같은 번호 검색 → **있으면 덮어쓰기** (웹의 중복 확인 화면과 같은 흐름)
- 네이티브 Google 로그인으로 1시간 만료 문제 해결
