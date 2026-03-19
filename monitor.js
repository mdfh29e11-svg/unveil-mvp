/**
 * Unveil Monitor - 텔레그램 딥페이크 실시간 모니터
 * node monitor.js  (server.js와 별도로 실행)
 *
 * .env에 추가 필요:
 *   TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
 *   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   MONITOR_CHAT_IDS=-100123456789,-100987654321   ← 감시할 채팅 ID (비우면 봇 참여 전체)
 */
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ─── 환경변수 로드 ────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const UNVEIL_PORT     = parseInt(process.env.PORT || '3000', 10);
const CHAT_IDS        = (process.env.MONITOR_CHAT_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const POLL_MS         = 3000;  // 3초 간격 폴링
const DATA_DIR        = path.join(__dirname, 'data');
const CHANNELS_FILE   = path.join(DATA_DIR, 'channels.json');

// ─── 채널 목록 관리 ─────────────────────────────────────────
function loadChannels() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(CHANNELS_FILE)) return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
  } catch {}
  return [];
}
function saveChannel(chatId, title) {
  const channels = loadChannels();
  const existing = channels.find(c => String(c.id) === String(chatId));
  if (!existing) {
    channels.push({ id: String(chatId), title: title || `chat_${chatId}`, addedAt: new Date().toISOString() });
    try { fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2)); } catch {}
  }
}

if (!TELEGRAM_TOKEN)  { console.error('❌ TELEGRAM_BOT_TOKEN 없음 — .env 확인'); process.exit(1); }
if (!DISCORD_WEBHOOK) console.warn('⚠️  DISCORD_WEBHOOK_URL 없음 — Discord 알림 비활성');

// ─── 내부 API 시크릿 가져오기 (서버에서) ─────────────────
let internalSecret = null;
async function fetchInternalSecret(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await new Promise((resolve, reject) => {
        const req = http.request({ hostname: 'localhost', port: UNVEIL_PORT, path: '/api/internal/secret', method: 'GET' }, res => {
          let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b)));
        });
        req.on('error', reject); req.end();
      });
      if (r.secret) { internalSecret = r.secret; console.log('[모니터] ✅ 내부 API 시크릿 획득 완료'); return; }
    } catch(e) {
      if (i < retries - 1) { await new Promise(r => setTimeout(r, 2000)); }
    }
  }
  console.warn('[모니터] ⚠️  내부 API 시크릿 획득 실패 — 탐지 저장 비활성');
}

const TG_HOST = 'api.telegram.org';
let lastUpdateId = 0;
let processing   = false;

// 이미 처리한 file_id 중복 방지 (재시작 시 초기화)
const processedFiles = new Set();

// ─── HTTPS 유틸 ───────────────────────────────────────────────
function httpsGet(hostname, pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: pathname, method: 'GET' }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        try { resolve({ status: res.statusCode, data: JSON.parse(buf.toString()), buffer: buf }); }
        catch { resolve({ status: res.statusCode, data: buf.toString(), buffer: buf }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname, pathname, headers, bodyBuf) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: pathname, method: 'POST', headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

// ─── Telegram API ─────────────────────────────────────────────
async function tgCall(method, params = {}) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const r = await httpsGet(TG_HOST, `/bot${TELEGRAM_TOKEN}/${method}${qs ? '?' + qs : ''}`);
  return r.data;
}

async function tgDownload(filePath) {
  const r = await httpsGet(TG_HOST, `/file/bot${TELEGRAM_TOKEN}/${filePath}`);
  return r.buffer;
}

// ─── Unveil 분석 (로컬 서버) ──────────────────────────────────
function buildMultipart(fileBuf, filename, mimeType, boundary) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    ),
    fileBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
}

function analyzeWithUnveil(fileBuf, filename, mimeType) {
  const boundary = 'Monitor' + Date.now().toString(36);
  const body = buildMultipart(fileBuf, filename, mimeType, boundary);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: UNVEIL_PORT,
      path: '/api/analyze', method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── 탐지 결과를 Unveil 서버 DB에 저장 (이미지 포함 가능) ──
async function saveDetectionToServer(det, imageBuf) {
  if (!internalSecret) return null;
  // 이미지가 있으면 base64로 포함 (5MB 이하만)
  const payload = { ...det };
  if (imageBuf && imageBuf.length < 5 * 1024 * 1024) {
    payload.imageB64 = imageBuf.toString('base64');
  }
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost', port: UNVEIL_PORT,
      path: '/api/internal/detection', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Internal-Secret': internalSecret
      }
    }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ─── 텔레그램 개인 알림 발송 ─────────────────────────────
async function sendTelegramUserAlert(chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
  try {
    await httpsPost(TG_HOST, `/bot${TELEGRAM_TOKEN}/sendMessage`,
      { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      Buffer.from(body)
    );
  } catch(e) { console.warn('[텔레그램 알림]', e.message); }
}

// ─── 텔레그램 봇 커맨드 처리 (/start, /link) ─────────────
async function handleBotCommand(msg) {
  const text   = msg.text || '';
  const chatId = msg.chat.id;

  if (text === '/start') {
    await sendTelegramUserAlert(chatId,
      `🛡 <b>Unveil 딥페이크 모니터</b>에 오신 것을 환영합니다!\n\n` +
      `이 봇은 텔레그램 채널의 딥페이크를 자동으로 탐지하여 알림을 드립니다.\n\n` +
      `📱 웹 대시보드: <code>http://localhost:${UNVEIL_PORT}/</code>\n\n` +
      `<b>내 Chat ID: <code>${chatId}</code></b>\n` +
      `대시보드 → 텔레그램 연동 설정에서 위 ID를 입력하면 알림을 받을 수 있습니다.`
    );
    return;
  }

  if (text === '/chatid') {
    await sendTelegramUserAlert(chatId, `내 Chat ID: <code>${chatId}</code>`);
    return;
  }
}

// ─── Discord 웹훅 알림 ────────────────────────────────────────
async function sendDiscordAlert({ chatTitle, senderName, verdict, score, rdScore, hiveScore, aionScore, msgLink, filename, aionGenerator }) {
  if (!DISCORD_WEBHOOK) return;

  const colorMap   = { FAKE: 0xff3b30, UNCERTAIN: 0xffcc00, REAL: 0x34c759 };
  const emojiMap   = { FAKE: '🚨', UNCERTAIN: '⚠️', REAL: '✅' };
  const verdictKo  = { FAKE: '딥페이크 의심', UNCERTAIN: '판별 불확실', REAL: '진짜로 보임' };

  const apiScores = [
    `Reality Defender: ${rdScore != null ? rdScore + '%' : 'N/A'}`,
    `Hive: ${hiveScore != null ? hiveScore + '%' : 'N/A'}`,
    `AI or Not: ${aionScore != null ? aionScore + '%' : 'N/A'}`,
  ].join('\n');

  const fields = [
    { name: '📢 채널/그룹', value: chatTitle || '알 수 없음', inline: true },
    { name: '👤 발신자',    value: senderName || '알 수 없음', inline: true },
    { name: '🔍 종합 판정', value: `**${verdict}** — ${verdictKo[verdict] || verdict}`, inline: false },
    { name: '📊 딥페이크 확률', value: `**${score}%**`, inline: true },
    { name: '🤖 AI 생성 도구', value: aionGenerator || '미상', inline: true },
    { name: '📡 API별 점수', value: `\`\`\`\n${apiScores}\n\`\`\``, inline: false },
    { name: '🖼 파일명', value: filename, inline: false },
    ...(msgLink ? [{ name: '🔗 원본 링크', value: msgLink, inline: false }] : [])
  ];

  const payload = JSON.stringify({
    username: 'Unveil 모니터',
    embeds: [{
      title: `${emojiMap[verdict] || '❓'} 딥페이크 탐지 — ${chatTitle}`,
      color: colorMap[verdict] || 0x888888,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Unveil 딥페이크 탐지 시스템 · Reality Defender + Hive + AI or Not' }
    }]
  });

  const wh = new url.URL(DISCORD_WEBHOOK);
  const res = await httpsPost(
    wh.hostname,
    wh.pathname + wh.search,
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    Buffer.from(payload)
  );
  if (res.status !== 204 && res.status !== 200) {
    console.warn('[Discord] 발송 실패:', res.status, JSON.stringify(res.data).slice(0, 200));
  }
}

// ─── 메시지에서 이미지 정보 추출 ─────────────────────────────
function extractImageInfo(msg) {
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    return { fileId: largest.file_id, filename: `tg_${largest.file_id.slice(-8)}.jpg`, mimeType: 'image/jpeg' };
  }
  if (msg.document) {
    const doc = msg.document;
    if (doc.mime_type?.startsWith('image/') || doc.mime_type?.startsWith('video/')) {
      return { fileId: doc.file_id, filename: doc.file_name || `tg_doc_${doc.file_id.slice(-8)}`, mimeType: doc.mime_type };
    }
  }
  return null;
}

// ─── 단일 메시지 처리 ────────────────────────────────────────
async function handleMessage(msg) {
  const imgInfo = extractImageInfo(msg);
  if (!imgInfo) return;

  const { fileId, filename, mimeType } = imgInfo;
  if (processedFiles.has(fileId)) return;
  processedFiles.add(fileId);
  if (processedFiles.size > 10000) {
    // 메모리 관리: 오래된 항목 제거
    const iter = processedFiles.values();
    for (let i = 0; i < 5000; i++) processedFiles.delete(iter.next().value);
  }

  const chatTitle  = msg.chat.title || msg.chat.username || `chat_${msg.chat.id}`;
  // 채널 목록에 기록
  saveChannel(msg.chat.id, chatTitle);
  const senderName = msg.from
    ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ')
    : '채널';
  const msgLink    = msg.chat.username
    ? `https://t.me/${msg.chat.username}/${msg.message_id}`
    : null;

  console.log(`\n[모니터] ───────────────────────────────────`);
  console.log(`[모니터] 채널: ${chatTitle} / 발신: ${senderName}`);
  console.log(`[모니터] 파일: ${filename} (${mimeType})`);

  // 파일 다운로드
  let fileBuf;
  try {
    const fileInfo = await tgCall('getFile', { file_id: fileId });
    if (!fileInfo.ok) { console.warn('[모니터] getFile 실패:', JSON.stringify(fileInfo)); return; }
    fileBuf = await tgDownload(fileInfo.result.file_path);
    console.log(`[모니터] 다운로드: ${(fileBuf.length / 1024).toFixed(1)} KB`);
  } catch(e) {
    console.error('[모니터] 다운로드 오류:', e.message); return;
  }

  // Unveil 딥페이크 분석
  let result;
  try {
    result = await analyzeWithUnveil(fileBuf, filename, mimeType);
  } catch(e) {
    console.error('[모니터] 분석 오류:', e.message); return;
  }

  if (!result?.success) {
    console.warn('[모니터] 분석 실패:', result?.error || '알 수 없음'); return;
  }

  const { verdict, score, rdScore, hiveScore, aionScore, aionGenerator } = result;
  console.log(`[모니터] 결과: ${verdict} ${score}%  (RD:${rdScore??'N/A'} Hive:${hiveScore??'N/A'} AION:${aionScore??'N/A'})`);

  // ── DB에 탐지 결과 저장 (이미지 버퍼 포함 → 서버가 저장) ──
  const detPayload = {
    timestamp: new Date().toISOString(),
    source: 'telegram', chatTitle, senderName, filename, verdict, score,
    rdScore, hiveScore, aionScore, aionGenerator, msgLink
  };
  // fileBuf를 함께 전달 → 서버가 data/images/{id}.jpg에 저장
  // 대시보드에서 이 이미지로 얼굴 매칭 수행
  const saved = await saveDetectionToServer(detPayload, fileBuf);
  const detId = saved?.id || null;
  if (saved) console.log(`[모니터] 💾 탐지 저장 완료 (ID: ${detId}, 이미지: ${saved ? '포함' : '없음'})`);

  // ── FAKE / UNCERTAIN 만 알림 발송 ──────────────────────
  if (verdict === 'FAKE' || verdict === 'UNCERTAIN') {
    const emojiMap = { FAKE: '🚨', UNCERTAIN: '⚠️' };
    const verdictKo = { FAKE: '딥페이크 의심', UNCERTAIN: '판별 불확실' };

    // Discord 알림
    if (DISCORD_WEBHOOK) {
      console.log(`[모니터] 🚨 Discord 알림 발송 중...`);
      try {
        await sendDiscordAlert({ chatTitle, senderName, verdict, score, rdScore, hiveScore, aionScore, aionGenerator, msgLink, filename });
        console.log(`[모니터] ✅ Discord 알림 발송 완료`);
      } catch(e) { console.error('[모니터] Discord 오류:', e.message); }
    }

    // 텔레그램 개인 알림 (등록된 사용자에게)
    if (saved?.alertList && saved.alertList.length > 0) {
      const tgText = (
        `${emojiMap[verdict]} <b>딥페이크 탐지 알림</b>\n\n` +
        `📢 채널: <b>${chatTitle}</b>\n` +
        `👤 발신자: ${senderName}\n` +
        `🔍 판정: <b>${verdictKo[verdict]}</b> (${score}%)\n` +
        `📊 분석: RD ${rdScore ?? 'N/A'}% | AION ${aionScore ?? 'N/A'}%\n` +
        `🖼 파일: ${filename}\n` +
        (msgLink ? `🔗 원본: ${msgLink}\n` : '') +
        `\n📱 대시보드에서 신고서를 생성하세요:\n` +
        `<code>http://localhost:${UNVEIL_PORT}/</code>`
      );
      for (const u of saved.alertList) {
        console.log(`[모니터] 📨 텔레그램 알림 → ${u.username} (${u.chatId})`);
        await sendTelegramUserAlert(String(u.chatId), tgText);
      }
    }
  } else {
    console.log(`[모니터] ✅ REAL — 알림 없음`);
  }
}

// ─── 폴링 루프 ────────────────────────────────────────────────
async function poll() {
  if (processing) return;
  processing = true;
  try {
    const r = await tgCall('getUpdates', { offset: lastUpdateId + 1, timeout: 2 });
    if (!r.ok || !Array.isArray(r.result) || r.result.length === 0) return;

    for (const update of r.result) {
      lastUpdateId = Math.max(lastUpdateId, update.update_id);
      const msg = update.message || update.channel_post;
      if (!msg) continue;

      // 봇 커맨드 처리 (/start, /chatid 등)
      if (msg.text && msg.text.startsWith('/')) {
        await handleBotCommand(msg);
        continue;
      }

      // 지정 채널 필터 (비어있으면 봇 참여한 전체)
      if (CHAT_IDS.length > 0 && !CHAT_IDS.includes(String(msg.chat.id))) continue;

      await handleMessage(msg);
    }
  } catch(e) {
    if (!e.message.includes('ECONNREFUSED')) {
      console.error('[모니터] 폴링 오류:', e.message);
    }
  } finally {
    processing = false;
  }
}

// ─── 시작 ─────────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🔍 Unveil 텔레그램 실시간 모니터');
console.log(`  📡 Telegram Bot: ✅ 연결됨`);
console.log(`  📣 Discord 알림: ${DISCORD_WEBHOOK ? '✅ 활성' : '❌ 비활성 (URL 없음)'}`);
console.log(`  🎯 감시 채팅:    ${CHAT_IDS.length > 0 ? CHAT_IDS.join(', ') : '전체 (봇 참여 채팅 모두)'}`);
console.log(`  ⏱  폴링 주기:   ${POLL_MS / 1000}초`);
console.log(`  🔗 Unveil 서버:  http://localhost:${UNVEIL_PORT}`);
console.log('  ─────────────────────────────────────────────');
console.log('  판정 기준: FAKE / UNCERTAIN → Discord 알림');
console.log('             REAL → 무시 (조용히 넘김)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 봇 정보 확인 + 내부 시크릿 획득 후 폴링 시작
(async () => {
  try {
    const me = await tgCall('getMe');
    if (me.ok) console.log(`[모니터] 봇 확인: @${me.result.username} (${me.result.first_name})\n`);
    else console.warn('[모니터] 봇 토큰 확인 실패:', JSON.stringify(me));
  } catch(e) { console.error('[모니터] 봇 연결 오류:', e.message); }

  // Unveil 서버에서 내부 시크릿 획득 (탐지 저장용)
  await fetchInternalSecret();

  console.log('[모니터] 🚀 폴링 시작...\n');
  poll();
  setInterval(poll, POLL_MS);
})();
