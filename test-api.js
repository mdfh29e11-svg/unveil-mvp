/**
 * Reality Defender API 연결 테스트
 * 실행: node test-api.js
 */
const https = require('https');

const RD_API_KEY = 'rd_597dce470cdada7e_e99d4702b098a7a3368cb9dc7dbe93d5';
const RD_HOST = 'api.prd.realitydefender.xyz';

function httpsRequest(options, bodyData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function test() {
  console.log('Reality Defender API 테스트 시작...\n');

  const bodyJson = JSON.stringify({ fileName: 'test.jpg' });

  // 방법 1: X-API-KEY
  console.log('[테스트 1] X-API-KEY 헤더...');
  try {
    const r = await httpsRequest({
      hostname: RD_HOST,
      path: '/api/files/aws-presigned',
      method: 'POST',
      headers: {
        'X-API-KEY': RD_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyJson),
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    }, bodyJson);
    console.log('  상태:', r.status);
    console.log('  응답:', r.data.substring(0, 300));
  } catch(e) {
    console.log('  오류:', e.message);
  }

  console.log('');

  // 방법 2: Authorization Bearer
  console.log('[테스트 2] Authorization Bearer 헤더...');
  try {
    const r = await httpsRequest({
      hostname: RD_HOST,
      path: '/api/files/aws-presigned',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RD_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyJson),
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    }, bodyJson);
    console.log('  상태:', r.status);
    console.log('  응답:', r.data.substring(0, 300));
  } catch(e) {
    console.log('  오류:', e.message);
  }

  console.log('\n테스트 완료. 아무 키나 누르세요...');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit());
}

test().catch(e => {
  console.error('오류:', e);
  process.stdin.resume();
  process.stdin.once('data', () => process.exit());
});
