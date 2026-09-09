# 바이크투어

Next.js 웹 앱과 Capacitor 기반 iOS 네이티브 앱을 함께 제공하는 라이딩 기록기입니다.

- 현재 위치와 라이딩 경로를 네이버 지도에 표시
- 총 이동거리, 평균·최대 속도, 정지시간, 휴식시간, 총시간 기록
- 일시정지 위치와 라이딩 결과를 기기에 저장
- 저장된 라이딩의 통계와 경로 다시 보기
- iOS 네이티브 앱에서 화면 잠금 중 Core Location 백그라운드 기록

## 웹 개발

```bash
npm install
npm run dev
```

네이버 지도 Client ID는 `.env.local`에 설정할 수 있습니다.

```text
NEXT_PUBLIC_NAVER_MAP_CLIENT_ID=발급받은_Client_ID
```

## 무료 Apple ID로 iPhone에 설치

iOS 앱 빌드와 설치는 macOS, Xcode, 본인의 iPhone이 필요합니다.

```bash
npm install
npm run ios:sync
npm run ios:open
```

Xcode가 열리면 다음 순서로 설치합니다.

1. 왼쪽 프로젝트에서 `App` 타깃을 선택합니다.
2. `Signing & Capabilities`의 Team에서 본인의 `Personal Team`을 선택합니다.
3. Bundle Identifier가 이미 사용 중이라는 오류가 나오면 `com.본인이름.biketour`처럼 고유하게 변경합니다.
4. 케이블로 연결한 iPhone을 실행 대상으로 선택하고 Run(▶)을 누릅니다.
5. iPhone이 요구하면 개발자 모드를 켜고 컴퓨터와 개발자 인증서를 신뢰합니다.
6. 앱에서 라이딩 시작을 누른 뒤 위치 접근을 허용합니다.

무료 Personal Team 서명은 7일 후 만료되므로 같은 과정으로 다시 빌드해 설치해야 합니다. App Store 또는 TestFlight 배포에는 유료 Apple Developer Program이 필요합니다.

## iOS 위치 기록 동작

라이딩 시작 시 네이티브 `CLLocationManager`가 작동합니다. 앱이 백그라운드로 가거나 화면이 잠기면 위치를 네이티브 파일에 임시 저장하고, 앱을 다시 열면 경로에 순서대로 반영합니다. 일시정지 또는 라이딩 종료 시 네이티브 위치 추적도 중단됩니다.

iOS에서 사용자가 앱을 강제 종료하면 연속 위치 기록도 종료됩니다. 다음 라이딩은 앱을 다시 열어 시작해야 합니다.

## 검사

```bash
npm run lint
npm run build
npm run ios:sync
```
