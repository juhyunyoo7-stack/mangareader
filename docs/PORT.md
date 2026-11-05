# 포트 4173이 막힐 때 (Windows 예약 포트)

증상: 바탕화면 만화 리더를 켜면 "Windows가 4173번 포트를 예약해 두었습니다"라는 안내가 나옵니다.

원인: Hyper-V, WSL, Docker 같은 기능이 부팅 때마다 임의의 포트 범위를 "제외 범위"로 예약합니다. 4173이 그 범위 안에 들어가면 어떤 프로그램도 쓸 수 없습니다. 확인 명령:

    netsh interface ipv4 show excludedportrange protocol=tcp

해결 1 (가장 간단): 컴퓨터를 다시 시작합니다. 예약 범위는 부팅마다 달라집니다.

해결 2 (다시 시작해도 반복될 때): **관리자 권한** 명령 프롬프트에서 아래를 한 번 실행합니다. 4173을 영구 예약해 Windows가 가져가지 못하게 합니다. 네트워크 가상화(WSL, Docker)가 몇 초 끊깁니다.

    net stop winnat
    netsh int ipv4 add excludedportrange protocol=tcp startport=4173 numberofports=1
    net start winnat

만화책 목록이 `http://localhost:4173` 주소에 묶여 있어 포트 번호는 바꾸지 않습니다. 개발 테스트만 `PW_PORT=15173 npm run check`처럼 다른 포트를 씁니다.
