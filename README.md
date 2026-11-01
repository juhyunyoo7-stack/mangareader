# MangaReader

오프라인 우선(offline-first) 만화/코믹 리더 PWA입니다. CBZ/ZIP 파일을 브라우저 안에서 직접 읽으며, 서버나 계정이 필요 없습니다. 모든 데이터는 사용 중인 기기에만 저장됩니다.

## 주요 기능

- CBZ/ZIP 가져오기 (파일 선택, 드래그 앤 드롭, Android 공유 대상). 같은 파일은 내용 키(contentKey)로 중복 방지
- 페이지 보기: 단일/양면/자동/웹툰, 좌우(LTR/RTL)·세로 방향, 표지 오프셋, 페이지별 예외 지정
- 확대/이동, 핀치 줌, 더블 탭, 키보드·휠 조작, 썸네일 스트립, 슬라이더
- 라이브러리: 시리즈 자동 묶음, 표지, 이어 읽기, 검색, 정렬
- 데스크톱 Chromium: 폴더를 연결해 복사 없이 제자리에서 읽기 (File System Access API)
- 저장 공간 관리: 읽은 책 파일만 삭제(진행률 유지) 후 재가져오기 시 자동 재연결, 전체 삭제(2단계 확인)
- 상태 내보내기/가져오기(JSON): 진행률·북마크·읽기 설정을 기기 간 병합(최신 우선). 14일간 백업이 없으면 알림
- 오프라인 동작 (자체 Service Worker, 빌드 시 프리캐시)

지원 형식은 현재 CBZ/ZIP 뿐입니다. RAR/7z/PDF/EPUB은 CBZ로 변환해야 합니다.

## 개발

```bash
npm install
npm run dev          # 개발 서버
npm run build        # 타입 검사 + 프로덕션 빌드 (dist/)
npm run preview      # 빌드 결과 미리보기 (포트 4173)
npm test             # 단위 테스트 (Vitest)
npm run e2e          # E2E 테스트 (Playwright, 빌드 포함)
npm run check        # 타입 검사 + prettier + 단위 + 빌드 + E2E 전체
npm run format       # prettier 적용
```

테스트용 CBZ 픽스처는 결정적으로 생성됩니다 (`npm run fixtures`, 코드: `scripts/fixtures`).
화면 캡처는 `SHOTS=1 npx playwright test screenshots --project=chromium-desktop` 으로 `docs/screenshots/` 에 다시 만들 수 있습니다.

## 구조

| 경로 | 내용 |
|---|---|
| `src/core` | 순수 로직: 타입, 펼침면(spread) 엔진, 병합(syncMerge), 타일링, 메모리 예산 |
| `src/archive` | ZIP 리더(지연 읽기), 형식 판별, 이미지 프로브 |
| `src/data` | IndexedDB, OPFS, 가져오기, 폴더 연결(fsa), 백업(backup) |
| `src/engine` | 캔버스 렌더러, 제스처, 디코드 워커 클라이언트, 페이지 캐시 |
| `src/app` | Preact UI (라이브러리, 리더, 설정) |
| `docs/DESIGN.md` | 설계 문서, `docs/STATUS.md` 진행 현황 |

## 알려진 한계

- 실제 iOS/Android 기기에서의 검증은 아직 하지 못했습니다 (docs/STATUS.md 참고). Playwright WebKit(Windows)은 OPFS 쓰기가 되지 않아 저장 관련 E2E는 Chromium에서만 실행됩니다.
- 현재 UI 문자열은 영어이며, 설정/백업 화면의 문자열만 `src/strings.ts` 로 분리되어 있습니다.
- 아직 배포하지 않았습니다.
