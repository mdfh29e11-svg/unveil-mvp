/**
 * Unveil — 로컬 딥페이크 탐지 모델
 * TensorFlow.js (Node.js) 기반 EfficientNetB4 추론
 *
 * 사용 조건:
 *   - unveil-mvp/model/ 폴더에 훈련된 모델 파일 필요
 *   - npm install @tensorflow/tfjs-node
 *
 * 모델이 없으면 자동으로 비활성화 (서버는 정상 작동)
 */

const path = require('path');
const fs   = require('fs');

const MODEL_DIR      = path.join(__dirname, 'model');
const MODEL_JSON     = path.join(MODEL_DIR, 'model.json');
const METADATA_PATH  = path.join(MODEL_DIR, 'metadata.json');
const IMG_SIZE       = 224;  // EfficientNetB4 입력 크기

let tf          = null;  // TensorFlow.js (없으면 null)
let model       = null;  // 로드된 모델
let metadata    = null;  // 모델 메타데이터
let modelReady  = false; // 모델 준비 완료 여부
let loadAttempted = false;

// ─────────────────────────────────────────────────────────────
// 모델 초기화 — 서버 시작 시 한 번만 호출
// ─────────────────────────────────────────────────────────────
async function initModel() {
  if (loadAttempted) return modelReady;
  loadAttempted = true;

  // 모델 파일 존재 확인
  if (!fs.existsSync(MODEL_JSON)) {
    console.log('  🤖 로컬 모델: 미설치 (선택사항 — 훈련 후 model/ 폴더에 배치)');
    return false;
  }

  // @tensorflow/tfjs-node 로드 시도
  try {
    tf = require('@tensorflow/tfjs-node');
  } catch(e) {
    console.warn('  ⚠️  로컬 모델: @tensorflow/tfjs-node 없음');
    console.warn('     설치: npm install @tensorflow/tfjs-node');
    return false;
  }

  // 메타데이터 로드
  try {
    if (fs.existsSync(METADATA_PATH)) {
      metadata = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
    }
  } catch(e) { metadata = null; }

  // 모델 로드
  try {
    console.log('  🤖 로컬 모델: 로딩 중...');
    const t = Date.now();
    model = await tf.loadLayersModel(`file://${MODEL_JSON}`);
    model.predict(tf.zeros([1, IMG_SIZE, IMG_SIZE, 3])); // 워밍업
    const elapsed = ((Date.now() - t) / 1000).toFixed(1);
    modelReady = true;
    const acc = metadata ? ` (정확도 ${(metadata.valAccuracy*100).toFixed(1)}%)` : '';
    console.log(`  ✅ 로컬 모델: 준비 완료 (${elapsed}초)${acc}`);
    return true;
  } catch(e) {
    console.warn(`  ⚠️  로컬 모델 로드 실패: ${e.message}`);
    model = null;
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 이미지 버퍼 → 텐서 전처리
// EfficientNet 표준 정규화 (훈련 시와 동일해야 함)
// ─────────────────────────────────────────────────────────────
function preprocessImageBuffer(imgBuf, mime) {
  // tf.node.decodeImage: JPEG/PNG/GIF/BMP 지원
  let tensor = tf.node.decodeImage(imgBuf, 3);  // RGB 3채널

  // 224×224으로 리사이즈
  tensor = tf.image.resizeBilinear(tensor, [IMG_SIZE, IMG_SIZE]);

  // MobileNetV3 preprocess_input 재현:
  // 픽셀 값을 [0,255] → [-1, 1] 정규화 (scale=1/127.5, offset=-1)
  // EfficientNet 과 동일한 수식이지만 metadata로 모델 확인
  tensor = tensor.div(127.5).sub(1.0);

  // 배치 차원 추가: [H,W,C] → [1,H,W,C]
  tensor = tensor.expandDims(0);

  return tensor;
}

// ─────────────────────────────────────────────────────────────
// 메인 추론 함수
// 반환: { score: 0~100, verdict: 'FAKE'|'UNCERTAIN'|'REAL', loaded: bool }
// score: 딥페이크(가짜) 확률 % — 높을수록 가짜
// ─────────────────────────────────────────────────────────────
async function analyzeWithLocalModel(imgBuf, mime) {
  if (!modelReady || !model || !tf) {
    return { score: null, verdict: null, loaded: false };
  }
  if (!imgBuf || imgBuf.length < 100) {
    return { score: null, verdict: null, loaded: true, error: '이미지 버퍼 없음' };
  }

  let tensor = null;
  try {
    tensor = preprocessImageBuffer(imgBuf, mime);

    // 추론 실행
    const prediction = model.predict(tensor);
    const predValue  = (await prediction.data())[0]; // 0.0(가짜) ~ 1.0(진짜)
    prediction.dispose();

    // 딥페이크 점수로 변환 (1 - realScore = fakeScore)
    const fakeProb = 1.0 - predValue;
    const score    = Math.round(fakeProb * 100);

    // 임계값 (metadata에 있으면 사용, 없으면 기본값)
    const fakeThreshold = metadata?.fakeThreshold ?? 0.45;
    const fakeScoreThreshold = Math.round(fakeThreshold * 100);

    let verdict;
    if (fakeProb >= fakeThreshold)           verdict = 'FAKE';
    else if (fakeProb >= fakeThreshold - 0.20) verdict = 'UNCERTAIN';
    else                                       verdict = 'REAL';

    console.log(`[LocalModel] predReal=${(predValue*100).toFixed(1)}% → fakeScore=${score}% → ${verdict}`);
    return { score, verdict, loaded: true, predReal: Math.round(predValue * 100) };

  } catch(e) {
    console.warn(`[LocalModel] 추론 오류: ${e.message}`);
    return { score: null, verdict: null, loaded: true, error: e.message };
  } finally {
    if (tensor) tensor.dispose();
  }
}

// ─────────────────────────────────────────────────────────────
// 상태 조회
// ─────────────────────────────────────────────────────────────
function getModelStatus() {
  return {
    ready:      modelReady,
    metadata:   metadata,
    modelPath:  MODEL_JSON,
    installed:  fs.existsSync(MODEL_JSON),
  };
}

module.exports = { initModel, analyzeWithLocalModel, getModelStatus };
