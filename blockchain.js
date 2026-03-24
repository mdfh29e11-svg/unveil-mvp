/**
 * Unveil - 블록체인 타임스탬프 모듈
 * OpenTimestamps 기반 무료 Bitcoin 블록체인 앵커링
 */

'use strict';
const https  = require('https');
const crypto = require('crypto');

const OTS_CALENDARS = [
  { host: 'alice.btc.calendar.opentimestamps.org',  name: 'Alice/BTC'    },
  { host: 'bob.btc.calendar.opentimestamps.org',    name: 'Bob/BTC'      },
  { host: 'finney.calendar.eternitywall.com',       name: 'Finney/EMRT'  },
];

function submitToCalendar(hashHex, calendar) {
  const hashBytes = Buffer.from(hashHex, 'hex');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: calendar.host,
      path: '/digest',
      method: 'POST',
      headers: {
        'Content-Type':  'application/octet-stream',
        'Content-Length': hashBytes.length,
        'Accept':        'application/vnd.opentimestamps.v1',
        'User-Agent':    'Unveil-Deepfake-Detector/1.0',
      },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ calendar: calendar.name, calendarHost: calendar.host, receipt: Buffer.concat(chunks).toString('hex') });
        } else {
          reject(new Error(calendar.name + ': HTTP ' + res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(calendar.name + ': timeout')); });
    req.write(hashBytes);
    req.end();
  });
}

async function stampHash(hashHex) {
  if (!hashHex || hashHex.length !== 64) { console.warn('[OTS] invalid hash'); return null; }
  for (const calendar of OTS_CALENDARS) {
    try {
      const result = await submitToCalendar(hashHex, calendar);
      console.log('[OTS] submitted to ' + result.calendar);
      return {
        hash: hashHex, algorithm: 'SHA-256',
        calendar: result.calendar, calendarHost: result.calendarHost,
        receipt: result.receipt, status: 'pending',
        submittedAt: new Date().toISOString(),
        verifyUrl: 'https://opentimestamps.org',
        btcConfirmEta: '1~3 hours',
        legalNote: 'Bitcoin blockchain timestamp. Hash: ' + hashHex,
      };
    } catch (e) { console.warn('[OTS] ' + calendar.name + ' failed:', e.message); }
  }
  return { hash: hashHex, algorithm: 'SHA-256', calendar: 'local-only', status: 'local_only', submittedAt: new Date().toISOString() };
}

function buildEvidencePayload(evidenceHash, verdict, score, timestamp) {
  const payload = JSON.stringify({
    fileHash: evidenceHash, verdict, score, timestamp,
    service: 'Unveil-Deepfake-Detector', version: '1.0',
  }, ['fileHash','score','service','timestamp','verdict','version']);
  return { payload, combinedHash: crypto.createHash('sha256').update(payload).digest('hex') };
}

async function stampEvidencePackage(evidenceHash, verdict, score, timestamp) {
  const { payload, combinedHash } = buildEvidencePayload(evidenceHash, verdict, score, timestamp);
  console.log('[OTS] evidence hash: ' + combinedHash);
  const result = await stampHash(combinedHash);
  if (result) {
    result.evidenceHash = evidenceHash;
    result.combinedHash = combinedHash;
    result.verdict = verdict;
    result.score = score;
    result.evidencePayload = payload;
  }
  return result;
}

module.exports = { stampHash, stampEvidencePackage, buildEvidencePayload };
