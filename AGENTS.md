# 프로젝트 작업 규칙

- 코드는 HTML, CSS, JavaScript 파일로 분리합니다.
- `index.html`은 프로젝트 루트에 두고, 애플리케이션 CSS와 JavaScript는 `src` 폴더에 둡니다. `vite.config.js` 같은 설정 파일은 프로젝트 루트에 둡니다.
- JavaScript는 ES 모듈 방식으로 연결합니다. CSS는 JavaScript 진입 파일에서 import하여 Vite 빌드에 포함합니다.
- 외부 JavaScript 라이브러리는 CDN으로 불러오지 않습니다. 필요한 라이브러리는 `npm install`로 설치하고 모듈로 import합니다.
- 기존 파일과 설정을 먼저 확인하고, 필요한 부분만 수정합니다.

## Netlify 배포

- Build command: `npm run build`
- Publish directory: `dist`
