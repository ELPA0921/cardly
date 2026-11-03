// 앱 기본 설정
// 지인들에게 배포할 때는 여기에 값을 넣어두면 각자 설정할 필요가 없습니다.
// (앱의 '설정' 화면에서 입력한 값이 있으면 그 값이 우선합니다.)
export const DEFAULT_CONFIG = {
  // Google Cloud Console > API 및 서비스 > 사용자 인증 정보 > OAuth 2.0 클라이언트 ID (웹 애플리케이션)
  googleClientId: '92671224460-vqg64i1rqmbs7btm06vcbo2hdgkslt6e.apps.googleusercontent.com',
  // 선택: Google Cloud Vision API 키 (정확도 높은 OCR). 비워두면 기기 내 무료 OCR(Tesseract)을 사용합니다.
  // 공개 저장소에 키가 올라가지 않도록 여기는 비워 두고, 앱 '설정'에서 입력하세요.
  // 설정에서 입력한 키는 내 Google Drive 데이터에 함께 저장되어 다른 기기에도 자동으로 적용됩니다.
  visionApiKey: '',
  // Google Drive에 만들어질 폴더 이름 (예전 '명함관리' 폴더는 자동으로 이 이름으로 바뀜)
  driveFolderName: '카들리',
};

export const APP_VERSION = '0.9.2';

// 로그인 방식이 바뀌어 업데이트 후 다시 로그인해야 할 때만 이 숫자를 올립니다.
// (올리면 기존 사용자는 자동으로 로그아웃되고 로그인 화면이 나옵니다. 명함 데이터는 지워지지 않습니다.)
export const AUTH_VERSION = 1;
