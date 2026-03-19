/**
 * Hive API 응답 구조 진단 스크립트
 * 실행: node test-hive.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// .env 로드
const lines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n');
for (const l of lines) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  process.env[t.slice(0,i).trim()] = t.slice(i+1).trim();
}

const HIVE_API_KEY = process.env.HIVE_API_KEY;
console.log('Hive API Key:', HIVE_API_KEY ? HIVE_API_KEY.slice(0,6)+'...' : '없음');

// 최소한의 1x1 JPEG (실제 파일 없어도 됨)
// 실제 테스트용: 현재 폴더에 test.jpg 있으면 그걸 씀
let testImageBuffer;
let testFilename = 'test.jpg';
const localJpg = path.join(__dirname, 'test.jpg');
if (fs.existsSync(localJpg)) {
  testImageBuffer = fs.readFileSync(localJpg);
  console.log('테스트 이미지:', localJpg, `(${(testImageBuffer.length/1024).toFixed(1)}KB)`);
} else {
  // 최소 JPEG (회색 1x1)
  testImageBuffer = Buffer.from(
    'ffd8ffe000104a46494600010100000100010000' +
    'ffdb004300080606070605080707070909080a0c' +
    '140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20' +
    '242e2720222c231c1c2837292c30313434341f27' +
    '39393028303c3c333c2e333334' +
    'ffc0000b080001000101011100' +
    'ffda00030101003f00f97b0000ffd9', 'hex'
  );
  console.log('테스트 이미지: 내장 최소 JPEG (1x1)');
}

const boundary = 'HiveTestBoundary' + Date.now();
const header = Buffer.from(
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="image"; filename="${testFilename}"\r\n` +
  `Content-Type: image/jpeg\r\n\r\n`
);
const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
const body = Buffer.concat([header, testImageBuffer, footer]);

console.log('\n━━━━ Hive API 요청 ━━━━');
console.log('POST https://api.thehive.ai/api/v2/task/sync');
console.log('Body size:', body.length, 'bytes');

const req = https.request({
  hostname: 'api.thehive.ai',
  path: '/api/v2/task/sync',
  method: 'POST',
  headers: {
    'Authorization': `Token ${HIVE_API_KEY}`,
    'Accept': 'application/json',
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length
  }
}, (res) => {
  let raw = '';
  res.on('data', c => raw += c);
  res.on('end', () => {
    console.log('\n━━━━ Hive API 응답 ━━━━');
    console.log('HTTP 상태코드:', res.statusCode);
    console.log('\n[RAW 응답]:');
    try {
      const parsed = JSON.parse(raw);
      console.log(JSON.stringify(parsed, null, 2));

      // 클래스 분석
      console.log('\n━━━━ 클래스 분석 ━━━━');
      const output = parsed?.status?.[0]?.response?.output;
      if (output && output.length > 0) {
        output.forEach((o, i) => {
          console.log(`output[${i}] time=${o.time}`);
          if (o.classes) {
            o.classes.forEach(c => {
              console.log(`  class="${c.class}" score=${(c.score*100).toFixed(2)}%`);
            });
          }
        });
      } else {
        console.log('⚠️  output 없음 - 응답 구조 확인 필요');
      }
    } catch(e) {
      console.log('[RAW 텍스트]:', raw.slice(0, 2000));
    }
  });
});
req.on('error', e => {
  console.error('요청 오류:', e.message);
});
req.write(body);
req.end();
