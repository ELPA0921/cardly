# 카들리 (Cardly) — Claude Code 작업 메모

명함 촬영 → OCR → Google Drive 저장 명함 관리 앱. 웹(GitHub Pages)과 안드로이드 앱(Capacitor)이 같은 코드를 씁니다.
**촬영·인식(OCR)·새 명함 등록은 앱 전용**, 웹은 조회·검색·수정·공유용 (웹 글자 인식은 정확도가 낮아 v0.9.4부터 숨김).
개발 환경 준비·빌드·배포 절차는 `DEVELOPMENT.md` 를 먼저 읽으세요.

## 사용자
- 모든 안내, 진행 상황, 요약, 질문을 **한국어**로 합니다.
- 개인용 + 지인 몇 명 배포가 목적. 데이터는 각자 Google Drive에만 저장(서버 없음).

## 구조 요약
- 빌드 도구 없는 바닐라 JS(ES 모듈). 웹 = 저장소 루트를 그대로 GitHub Pages로 배포 (`git push` → https://elpa0921.github.io/cardly/).
- 앱 = `npm run apk` (scripts/build-web.mjs로 www 복사 → `cap sync android` → Gradle assembleDebug).
- 네이티브 기능은 `android/app/src/main/java/io/github/elpa0921/cardly/CardlyNativePlugin.java` 하나에 모음
  (ML Kit 문서 스캐너, ML Kit 한국어 OCR, Identity AuthorizationClient로 Drive 토큰, 주소록 찾기/덮어쓰기, 새 연락처는 연락처 앱 편집 화면).
- JS에서 앱 여부는 `js/native.js` 의 `isNative`. 웹 전용/앱 전용 분기는 여기 기준.

## 규칙
- **PowerShell로 텍스트 파일 내용을 읽고 쓰지 말 것** (Get-Content/Set-Content, `>`): UTF-8 한글이 깨져 앱이 검은 화면이 된 적 있음.
  파일 수정은 Edit 도구나 bash `sed`. `.ps1` 파일은 ASCII만 사용.
- **비밀값을 저장소에 넣지 말 것**: 서명 키(`%USERPROFILE%\.cardly`), Gradle 비밀번호(`~/.gradle/gradle.properties`의 CARDLY_*), Vision API 키, 개인 이메일.
  커밋 전 `grep -rnE "AIza[0-9A-Za-z_-]{30,}"` 로 키가 없는지 확인. APK(`*.apk`)는 .gitignore.
- 새 버전을 낼 때 함께 올리는 것: `js/config.js` APP_VERSION, `android/app/build.gradle` versionCode(+1)/versionName, `sw.js` CACHE.
- 로그인 방식이 바뀌어 재로그인이 필요할 때만 `js/config.js` 의 AUTH_VERSION 을 올림.
- 전화번호는 숫자만 입력받고 하이픈은 규칙대로 자동(`hyphenatePhone` / `formatPhone` in js/parser.js).
- Drive: 「카들리」 폴더(예전 '명함관리'는 자동 이름 변경), 사진 파일명 `카들리_업체명_이름_01/02.jpg`, 데이터 `business-cards.json`.
- 설정 탭: 계정 / 화면 / 주소록 / 인식 / 데이터. 계정 공통 설정은 `store.setPref`(Drive로 기기 간 공유), 기기별 설정은 `store.setSettings`.

## 확인 방법
- `powershell -ExecutionPolicy Bypass -File serve.ps1` → http://localhost:5173
- `tests/parser-test.html` (모두 통과), `tests/native-sim.html` (앱 모드 흉내: 가짜 네이티브 플러그인 + 가짜 Drive API, 호출 기록은 `window.__argLog`, `window.__fetchLog`)
- 테스트로 브라우저 localStorage를 바꿨다면 끝나고 원래대로 돌려놓기.

## Google Cloud (프로젝트 myeongham-card)
- 웹 OAuth 클라이언트 ID는 `js/config.js` 에 있음(공개돼도 되는 값). 허용 원본: localhost:5173, elpa0921.github.io
- 안드로이드 OAuth 클라이언트: 패키지 io.github.elpa0921.cardly + 서명 키 SHA-1
- 동의 화면은 테스트 모드(테스트 사용자만 로그인 가능). drive.file 권한만 사용.
