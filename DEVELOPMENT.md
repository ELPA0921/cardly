# 카들리 개발 안내서

다른 컴퓨터(예: 회사 PC)에서 카들리를 이어서 개발하고, 앱(APK)을 만들고, 배포하는 방법입니다.

---

## 1. 새 컴퓨터 준비 (처음 한 번)

### 1-1. 미리 챙길 것 — 서명 키 폴더
원래 PC의 **`C:\Users\(사용자)\.cardly`** 폴더를 USB나 **본인만 볼 수 있는** 개인 클라우드에 복사해 가세요.

| 파일 | 내용 |
|---|---|
| `cardly-release.jks` | 앱 서명 키 |
| `signing.properties` | 서명 키 비밀번호 설정 |

- 같은 키로 서명해야 **이미 설치된 앱 위에 업데이트**되고, **Google 로그인**도 됩니다.
  (Google Cloud의 안드로이드 로그인 설정이 이 키의 지문(SHA-1)에 묶여 있음)
- 이 폴더는 비밀번호와 같습니다. **GitHub나 공유 폴더에 절대 올리지 마세요.**
- 이 키를 잃어버리면 지인들이 앱을 지웠다가 다시 설치해야 합니다. 백업을 꼭 해 두세요.

### 1-2. 새 컴퓨터에서
1. 복사해 온 `.cardly` 폴더를 새 컴퓨터의 **`C:\Users\(사용자)\.cardly`** 에 넣습니다.
2. Git이 없다면 먼저 설치합니다: `winget install Git.Git`
3. 코드를 받습니다.
   ```
   git clone https://github.com/ELPA0921/cardly.git
   cd cardly
   ```
4. 설치 스크립트를 실행합니다. (도구 설치 중 관리자 승인 창이 뜨면 '예')
   ```
   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
   ```
   하는 일: Git·Node.js·JDK 21 설치 → Android SDK 설치(Android SDK 라이선스에 동의하게 됨) →
   환경 변수(JAVA_HOME, ANDROID_HOME) → 서명 키 설정(사용자 폴더 경로 자동 보정) → `android\local.properties` → `npm install`
5. **새 터미널을 열고** 앱을 빌드해 봅니다.
   ```
   npm run apk
   ```
   결과: `android\app\build\outputs\apk\debug\app-debug.apk`

> 도구가 이미 깔려 있다면 `-SkipTools` 를 붙이면 3~5단계(환경 변수·서명 키·패키지)만 합니다.
> 회사 PC에서 관리자 권한이 없거나 방화벽 때문에 설치가 안 되면, IT 담당자에게 Node.js / Temurin JDK 21 설치를 요청하세요.

### 1-3. GitHub에 올리기(push) 준비
처음 `git push` 할 때 GitHub 로그인 창이 뜹니다 (ELPA0921 계정으로 로그인).
커밋 작성자 설정은 한 번만:
```
git config user.name "ELPA0921"
git config user.email "ELPA0921@users.noreply.github.com"
```

---

## 2. 폴더 구조

```
index.html, css/, js/, icons/   웹앱 (GitHub Pages에 그대로 배포됨)
  js/app.js          화면과 동작 (목록, 편집, 상세, 설정, 로그인, 뒤로가기)
  js/parser.js       OCR 글자 → 명함 항목 추출, 전화번호 하이픈 규칙
  js/ocr.js          글자 인식: ML Kit(앱) / Google Vision / Tesseract(웹)
  js/scan.js         (웹) 명함 테두리 찾기 + 원근 보정
  js/store.js        로컬 저장소, Drive 데이터 병합, 계정 공통 설정(prefs)
  js/sync.js         Google Drive 동기화 (카들리 폴더, 사진 파일 이름)
  js/drive.js        Google 로그인(웹: GIS / 앱: 네이티브) + Drive API
  js/contactRules.js 주소록 이름 규칙, 연락처 사진 옵션
  js/native.js       앱(Capacitor) 네이티브 기능 연결
  js/share.js        공유 텍스트, 사진, vCard
  js/config.js       버전, OAuth 클라이언트 ID, Drive 폴더 이름
android/             안드로이드 앱 (Capacitor)
  app/src/main/java/io/github/elpa0921/cardly/CardlyNativePlugin.java
                     문서 스캐너, 한국어 OCR, Google 권한, 주소록 저장/덮어쓰기
design/logo-source.webp   로고 원본
scripts/build-web.mjs     웹 파일을 앱용 www 폴더로 복사
scripts/make-icons.mjs    로고 원본 → 앱/웹 아이콘, 워드마크, 시작 화면 생성
scripts/setup-windows.ps1 새 PC 개발 환경 설치
tests/parser-test.html    항목 추출 테스트 (브라우저에서 열기)
tests/native-sim.html     PC 브라우저에서 '앱 모드'를 흉내 내 테스트
tests/intro-preview.html  시작 애니메이션 미리보기
serve.ps1                 로컬 테스트 서버 (http://localhost:5173)
```

---

## 3. 평소 작업 흐름

### 웹에서 확인
```
powershell -ExecutionPolicy Bypass -File serve.ps1
```
- http://localhost:5173 — 웹앱
- http://localhost:5173/tests/parser-test.html — 항목 추출 테스트 (전부 통과해야 함)
- http://localhost:5173/tests/native-sim.html — 앱 모드 시뮬레이션 (로그인 화면, 뒤로가기, 주소록 저장 흐름 등)

### 앱(APK) 만들기
```
npm run apk
```
웹 파일 복사(www) → Capacitor 동기화 → Gradle 빌드를 한 번에 합니다.

### 새 버전 내보내기 체크리스트
1. 버전 올리기 (세 곳)
   - `js/config.js` → `APP_VERSION`
   - `android/app/build.gradle` → `versionCode`(1씩 증가), `versionName`
   - `sw.js` → `CACHE` 이름 (웹 캐시 갱신)
2. `tests/parser-test.html`, `tests/native-sim.html` 로 확인
3. `npm run apk` → APK를 `cardly-x.y.z.apk` 로 복사해서 전달 (APK는 git에 올리지 않음)
4. 커밋 후 `git push` → GitHub Pages 웹(https://elpa0921.github.io/cardly/)에 1~2분 뒤 자동 반영

### 로고를 바꿀 때
`design/logo-source.webp` 를 교체하고 (위치/크기가 다르면 `scripts/make-icons.mjs` 위쪽의 좌표 수정)
```
node scripts/make-icons.mjs
```

---

## 4. 꼭 지킬 것 / 알아둘 것

- **PowerShell로 JS·HTML 파일을 읽고 다시 쓰지 마세요** (`Get-Content | Set-Content` 등).
  Windows PowerShell이 UTF-8 한글을 깨뜨려 앱이 검은 화면이 된 적이 있습니다. 편집기나 git bash(`sed`)를 쓰세요.
- **비밀값은 저장소에 넣지 않습니다**: 서명 키(.jks)·비밀번호, Google Vision API 키.
  Vision 키는 앱/웹 설정 화면에서 입력하면 내 Drive 데이터에 저장되어 기기 간 공유됩니다.
- **로그인 방식이 바뀌는 업데이트**라 다시 로그인이 필요할 때만 `js/config.js` 의 `AUTH_VERSION` 을 올립니다
  (기존 사용자는 자동 로그아웃 → 로그인 화면. 명함 데이터는 남음).
- Google Drive: 앱이 만든 **「카들리」 폴더**에만 접근(drive.file 권한).
  명함 데이터는 `business-cards.json`, 사진은 `카들리_업체명_이름_01.jpg`(앞면)/`_02`(뒷면).
- Google Cloud 프로젝트: **myeongham-card** (Google 인증 플랫폼)
  - 웹 OAuth 클라이언트 "카들리 웹" — 허용 원본: `http://localhost:5173`, `https://elpa0921.github.io`
  - 안드로이드 OAuth 클라이언트 "카들리 안드로이드 앱" — 패키지 `io.github.elpa0921.cardly` + 서명 키 SHA-1
  - 동의 화면은 **테스트 모드**: 테스트 사용자로 등록된 Gmail만 로그인 가능 (최대 100명)
- 앱 인식(OCR)·스캔은 휴대폰 안의 Google ML Kit라 무료. Google Cloud 결제 계정은 웹의 Vision용(무료 체험판).

---

## 5. 문제 해결

| 증상 | 해결 |
|---|---|
| `npm run apk` 에서 `JAVA_HOME is not set` | 설치 스크립트 실행 후 **새 터미널**을 열었는지 확인 |
| `SDK location not found` | `scripts\setup-windows.ps1 -SkipTools` 다시 실행 (local.properties 생성) |
| 설치한 앱 위에 업데이트가 안 됨 ("패키지 충돌") | 서명 키가 다름 → `.cardly` 폴더를 넣고 `-SkipTools` 로 다시 설정 후 빌드 |
| 앱에서 Google 로그인 오류 `10` / `DEVELOPER_ERROR` | 서명 키가 다름 (위와 같음) |
| 앱이 검은/빈 화면 | 화면에 나오는 오류 내용 확인. 흔한 원인은 JS 파일의 한글 깨짐(4번 참고) |
| 웹에 변경이 안 보임 | `sw.js` 의 CACHE 이름을 올렸는지 확인, 브라우저 새로고침 |
