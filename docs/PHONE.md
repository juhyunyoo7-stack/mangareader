# 폰에서 쓰기 (배포 준비)

상태: 앱은 하위 경로에서 동작하도록 빌드되어 있습니다 (`vite.config.ts`의 `base: './'`, 상대 경로 manifest). 공개 배포는 아직 하지 않았습니다. 이유: 이 저장소는 푸시 전에 보고하고 승인받기로 한 합의가 있습니다. 앱 코드에는 만화가 들어 있지 않고, 만화는 각 기기 브라우저 안에만 저장됩니다.

## 필요한 조건
- 폰에서 설치형으로 쓰려면 HTTPS 주소가 필요합니다 (Service Worker, 파일 저장소(OPFS)가 보안 연결에서만 동작).
- `http://컴퓨터IP:포트`로는 폰에서 저장소가 동작하지 않아 쓸 수 없습니다.

## 방법 A. GitHub Pages (기존 영어·일본어 앱과 같은 방식)
1. 새 저장소 `mangareader` 생성 (공개; Pages 무료 플랜은 공개 저장소만 가능).
2. `npm run build` 후 `dist/` 내용을 `gh-pages` 브랜치(또는 `docs/`)로 올립니다.
3. 주소: `https://juhyunyoo7-stack.github.io/mangareader/`
4. 푸시는 `git -c credential.helper= -c credential.helper='!gh auth git-credential' push` 형식 (기본 자격증명 창이 멈추는 문제 회피).
5. 폰: Android Chrome은 메뉴 > 앱 설치, iPhone Safari는 공유 > 홈 화면에 추가.

## 방법 B. Cloudflare Pages / Tailscale
- Cloudflare Pages: 비공개 저장소 연결 가능, 계정 로그인 필요.
- Tailscale Serve: PC에서만 서비스하고 폰은 같은 계정으로 접속. Tailscale 설치와 로그인 필요. 이 PC에는 설치되어 있지 않습니다.

## 주의
- 앱 주소가 바뀌면 브라우저 저장소(만화 목록)가 새 주소 기준으로 비어 보입니다. 주소를 먼저 정하고 쓰기 시작하세요.
- PC 바탕화면 런처(`localhost:4173`)와 폰 주소는 서로 다른 저장소입니다. 읽던 쪽은 설정의 상태 내보내기/가져오기로 옮깁니다.
