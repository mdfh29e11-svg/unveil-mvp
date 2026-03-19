/**
 * Unveil - 간단한 파일 기반 데이터베이스
 * 외부 의존성 없이 JSON 파일로 데이터 저장
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(filename, def) {
  const fp = path.join(DATA_DIR, filename);
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return typeof def === 'function' ? def() : def; }
}

function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

// ── 사용자 ──────────────────────────────────────────────────
// { [userId]: { id, username, email, passwordHash, faceDescriptor, telegramChatId, createdAt } }
function getUsers()      { return readJSON('users.json', {}); }
function saveUsers(d)    { writeJSON('users.json', d); }

// ── 세션 ────────────────────────────────────────────────────
// { [token]: { uid, exp } }
function getSessions()   { return readJSON('sessions.json', {}); }
function saveSessions(d) { writeJSON('sessions.json', d); }

// ── 탐지 기록 ────────────────────────────────────────────────
// [{ id, timestamp, source, chatTitle, senderName, filename,
//    verdict, score, rdScore, hiveScore, aionScore, msgLink,
//    aionGenerator, claimedByUserId, reportPath }]
function getDetections()    { return readJSON('detections.json', []); }
function saveDetections(d)  { writeJSON('detections.json', d); }

// ── 헬퍼 ────────────────────────────────────────────────────
function addDetection(det) {
  const list = getDetections();
  list.unshift(det);              // 최신 순
  if (list.length > 5000) list.splice(5000); // 최대 5000건
  saveDetections(list);
  return det;
}

module.exports = {
  getUsers, saveUsers,
  getSessions, saveSessions,
  getDetections, saveDetections, addDetection,
  DATA_DIR
};
