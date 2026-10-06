import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ESM 빌드는 워커 파일 위치를 직접 알려줘야 한다 (npm install 때 public/vendor 로 복사됨)
maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');

export default maplibregl;
