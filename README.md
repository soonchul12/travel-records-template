# Travel Records

사진과 지도로 만드는 스크롤 여행기. Astro · TypeScript · MapLibre GL JS · PhotoSwipe로 만들었습니다.

메인에서 여행을 선택하고, 상세 페이지를 스크롤하면 해당 장소로 지도가 이동·확대되며 경로가 그려집니다. 모바일 화면, 사진 확대, 날짜별 이동, 자동 감상과 링크 공유를 지원합니다.

이 저장소는 개인 여행 사이트에서 코드만 분리한 공개 템플릿입니다. 개인 사진·여행 글·촬영 위치·원본 Git 이력은 포함하지 않습니다. 두 개의 샘플 여행과 코드로 그린 SVG 일러스트를 제공합니다. 샘플 좌표는 데모용입니다.

## 바로 시작

GitHub의 **Use this template → Create a new repository**로 내 저장소를 만들고 내려받으세요. Node.js 22.19 이상과 npm이 필요합니다.

```bash
npm ci
npm run dev
```

http://localhost:4321 에서 샘플 사이트가 열립니다. 처음 실행에는 Python이 필요하지 않습니다. 지도·글꼴을 불러오려면 인터넷 연결이 필요합니다.

```bash
npm run build
npm run preview
```

빌드 결과는 `dist/`에 생성됩니다.

## 사이트 이름과 문구 바꾸기

`src/data/site.json`에서 사이트 제목, 한글 제목, 소개, 메인 화면 문구와 지도 라벨을 변경하세요.

`content/trips.json`에서 여행별 제목·기간·지역·날짜별 글·장소 설명을 변경하세요. 편집 후 다음 명령을 실행하면 페이지용 데이터가 생성됩니다. Python 3.10 이상이 필요합니다.

```bash
npm run content
npm run dev
```

`src/data/trips.json`은 생성 결과입니다. 수정할 때는 입력 파일인 `content/trips.json`을 사용하세요. 여행은 날짜순으로 정렬하며 오래된 여행부터 이어집니다. 최소 한 여행, 여행당 한 날짜, 날짜당 한 장소, 장소당 한 사진이 필요합니다.

## iCloud 사진으로 내 여행 만들기

현재 템플릿은 iCloud에 로그인하거나 실시간 동기화하지 않습니다. 내 계정의 사진을 내 컴퓨터에서 원본으로 내보낸 뒤 가져오는 방식입니다. Apple 계정 비밀번호를 사이트나 GitHub에 넣을 필요가 없습니다.

1. Mac 사진 앱에서 내 iCloud 사진이 동기화되도록 설정합니다.
2. 사용할 여행 사진을 선택합니다.
3. **파일 → 내보내기 → 수정하지 않은 원본 내보내기**로 프로젝트의 `imports/` 폴더에 저장합니다. 원본이 다운로드될 때까지 기다려주세요.
4. 아래 이미지 처리 도구를 설치합니다.

Apple 안내: https://support.apple.com/en-ie/111762

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

`content/trips.json`의 장소 안에 있는 `photos`를 다음과 같이 교체합니다. 파일명은 내보낸 원본과 정확히 일치해야 합니다. 하위 폴더라면 `tokyo/IMG_0001.HEIC`처럼 적으세요.

```json
{
  "name": "방문한 장소",
  "en": "My Place",
  "kind": "city",
  "note": "이곳에서 기억에 남은 순간",
  "coords": [139.7671, 35.6812],
  "time": "10:30",
  "photos": [
    { "file": "IMG_0001.HEIC" },
    { "file": "IMG_0002.JPG", "time": "11:00" }
  ]
}
```

좌표 순서는 **[경도, 위도]**입니다. 장소의 `coords`는 지도 카메라가 이동할 위치이므로 직접 지정해주세요. 사진 GPS와 촬영 시각은 EXIF에서 읽으며, 정보가 없으면 장소의 좌표·시각을 사용합니다. 사진별 `coords`와 `time`을 명시하면 EXIF보다 우선합니다. 원본의 촬영 시각을 그대로 사용하므로 시간대 보정이 필요하면 `time`을 지정하세요.

```bash
python tools/build_content.py --photos imports
npm run build
```

도구가 HEIC/JPEG 등의 원본을 읽고 방향을 보정한 뒤 긴 변 최대 2,000px와 900px의 JPEG 두 종류를 만듭니다. 생성 이미지에는 EXIF를 넣지 않습니다. **지도용 좌표와 촬영 시각은 사이트 데이터에 포함되며 공개 사이트에서 표시됩니다.**

사진 파일명을 글에 직접 넣는 방식이라서, 파일 개수나 촬영 날짜만으로 여행 글을 자동 작성하지 않습니다. 사용할 사진과 장소 순서는 직접 선택합니다.

### 기간·날짜·경로

- `slug`: 주소에 사용할 고유한 영문 소문자·숫자·하이픈 이름
- `start`, `end`, 각 날짜의 `date`: `YYYY-MM-DD`
- 날짜의 `accent`: `#72b4b0` 같은 색상
- `titleKo`, `titleEn`, `lede`: 날짜 제목과 짧은 소개
- `journal`: 문단별 문자열 배열
- 장소의 `kind`: `city`, `nature`, `food`, `stay`, `night`, `arrival`, `park`
- 날짜의 `coverIndex`: 해당 날짜 전체 사진 중 대표 사진 번호, 기본 0
- 날짜의 `route`: 선택 사항. `[경도, 위도]` 좌표 배열을 지정하면 그 경로를 사용합니다. 생략하면 장소 좌표를 입력 순서대로 연결합니다.

경로와 거리는 입력 좌표 사이를 연결한 근사값이며 도로 내비게이션 경로가 아닙니다. 사진을 바꾸면 갤러리와 지도상의 사진 위치가 함께 바뀝니다.

## 내 사진을 Git에 올릴 때

`imports/`, `public/photos/`, `.venv/`, 환경 변수 파일은 기본적으로 Git에서 제외됩니다. 로컬에서 사진을 생성하고 `dist/`를 직접 배포할 수 있습니다.

내 사진도 내 저장소에 포함해서 자동 배포하려면 아래 명령으로 **가공된 사진만** 추가하세요. 공개 저장소에 추가하면 사진도 공개됩니다. 사진을 공개하지 않을 경우 내 템플릿 복사본은 비공개 저장소로 만드세요.

```bash
git add -f public/photos/
git add content/trips.json src/data/trips.json src/data/site.json
git commit -m "Add my travel content"
git push
```

기존에 올린 사진을 입력에서 제거해도 가공 파일은 자동 삭제되지 않습니다. 공개 전에 더 이상 사용할 사진은 `public/photos/`에서도 제거해주세요. `content/trips.json`에 넣은 원본 파일명도 커밋 대상이므로 필요한 경우 원본을 단순한 이름으로 바꿔 가져오세요.

## 배포

### Netlify에 직접 업로드

`npm run build` 후 `dist/` 폴더를 Netlify에 업로드합니다. 가공한 사진을 Git에 올리지 않고도 배포할 수 있습니다.

### GitHub와 Netlify 연결

내 저장소를 Netlify에 연결하고 빌드 명령 `npm run build`, 게시 디렉터리 `dist`를 사용합니다. 저장소의 `netlify.toml`에 설정이 포함돼 있습니다. 가공 이미지와 생성 데이터가 저장소에 있어야 합니다. 자동 배포 단계에서는 Python 사진 변환을 실행하지 않습니다.

원하면 배포 환경 변수 `SITE_URL`에 내 사이트의 전체 주소를 넣으세요.

## 파일 구조

```text
content/trips.json         여행 글·장소·사진 입력
src/data/site.json         사이트 이름과 메인 문구
src/data/trips.json        생성된 페이지 데이터
src/pages/                메인·여행 상세 페이지
src/scripts/              지도·스크롤·사진 뷰어
src/styles/global.css     디자인·모바일 화면
public/demo/              직접 그린 샘플 SVG
public/photos/            가공한 사진 (기본 Git 제외)
imports/                  내보낸 원본 (Git 제외)
tools/build_content.py    입력 검증·사진 변환·데이터 생성
```

## 라이선스와 출처

프로젝트 코드와 직접 만든 샘플 SVG는 MIT 라이선스입니다. 본인이 추가하는 사진과 글의 권리는 해당 소유자에게 있습니다. 외부 라이브러리와 지도·글꼴은 각 제공자의 라이선스를 따릅니다.

- Astro: https://astro.build
- MapLibre GL JS: https://maplibre.org
- PhotoSwipe: https://photoswipe.com
- 지도: OpenFreeMap / OpenStreetMap contributors
- 지형: Mapzen / AWS Terrain Tiles
- 글꼴: Google Fonts / Pretendard

지도 출처 표시는 유지해주세요. 데스크톱 Chrome과 모바일 화면·터치 에뮬레이션을 기준으로 기능을 확인했으며, 실제 기기와 브라우저별 동작은 추가 확인할 수 있습니다.
