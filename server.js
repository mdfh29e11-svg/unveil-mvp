/**
 * Unveil - 딥페이크 탐지 MVP v3
 * Reality Defender + Hive Moderation + AI or Not 3중 분석
 * node server.js
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');
const crypto = require('crypto');
const zlib  = require('zlib');h

// ── 인증 / DB 모듈 ───────────────────────────────────────
const db         = require('./db');
const auth       = require('./auth');
const localModel = require('./local_model');

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

const PORT         = process.env.PORT || 3000;
const RD_API_KEY   = process.env.RD_API_KEY;
const HIVE_API_KEY = process.env.HIVE_API_KEY;
const AION_API_KEY = process.env.AION_API_KEY;  // AI or Not
const BING_KEY     = process.env.BING_SEARCH_KEY || null;  // Bing Visual Search (무료 1000/월)
const RD_HOST      = 'api.prd.realitydefender.xyz';
const HIVE_HOST    = 'api.thehive.ai';
const AION_HOST    = 'api.aiornot.com';
const BING_HOST    = 'api.cognitive.microsoft.com';

// FAKE ≥ 40%, UNCERTAIN ≥ 25%
const FAKE_THRESHOLD      = 40;
const UNCERTAIN_THRESHOLD = 25;

if (!RD_API_KEY)   { console.error('❌ RD_API_KEY 없음'); process.exit(1); }
if (!HIVE_API_KEY) console.warn('⚠️  HIVE_API_KEY 없음 — Hive 비활성');
if (!AION_API_KEY) console.warn('⚠️  AION_API_KEY 없음 — AI or Not 비활성');
if (!BING_KEY)     console.warn('⚠️  BING_SEARCH_KEY 없음 — 유출 탐색 제한 모드');

// ─── 마지막 raw 응답 저장 (디버그용) ─────────────────────────
let lastDebug = {
  rdRaw:null, rdError:null,
  hiveRaw:null, hiveStatus:null, hiveError:null,
  aionRaw:null, aionStatus:null, aionError:null
};

// ─── 보안 ─────────────────────────────────────────────────────
const MAX_FILE_MB    = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_REQ_BYTES  = MAX_FILE_BYTES + 10 * 1024;

const ALLOWED_MIME = new Set([
  'image/jpeg','image/jpg','image/png','image/webp','image/gif',
  'video/mp4','video/quicktime','video/x-msvideo','video/webm',
  'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave',
  'audio/mp4','audio/m4a','audio/x-m4a','audio/ogg','audio/webm',
  'audio/aac','audio/flac','audio/x-flac'
]);
const ALLOWED_EXT = new Set([
  '.jpg','.jpeg','.png','.webp','.gif','.mp4','.mov','.avi','.webm',
  '.mp3','.wav','.m4a','.ogg','.aac','.flac','.weba'
]);
const MAGIC = [
  { bytes:[0xFF,0xD8,0xFF] }, { bytes:[0x89,0x50,0x4E,0x47] },
  { bytes:[0x47,0x49,0x46] }, { offset:8, bytes:[0x57,0x45,0x42,0x50] },
  { offset:4, bytes:[0x66,0x74,0x79,0x70] },
  { bytes:[0x49,0x44,0x33] },                        // ID3 (MP3)
  { bytes:[0x52,0x49,0x46,0x46] },                   // RIFF (WAV)
  { bytes:[0x4F,0x67,0x67,0x53] },                   // OGG
  { bytes:[0x66,0x4C,0x61,0x43] },                   // fLaC
  { bytes:[0xFF,0xF1] }, { bytes:[0xFF,0xF9] },       // AAC ADTS
];

// Rate Limit
const rlMap = new Map();
function checkRL(ip) {
  const now = Date.now(), e = rlMap.get(ip) || { c:0, t:now };
  if (now - e.t > 60000) { e.c=1; e.t=now; } else e.c++;
  rlMap.set(ip, e); return e.c <= 10;
}
setInterval(() => { const n=Date.now(); for(const[k,v]of rlMap)if(n-v.t>120000)rlMap.delete(k); }, 300000);

function validateFile(filename, mimeType, buffer) {
  if (filename.includes('\0')) return { ok:false, reason:'잘못된 파일명' };
  const ext = path.extname(path.basename(filename)).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return { ok:false, reason:`허용 안된 확장자: ${ext}` };
  const mime = mimeType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return { ok:false, reason:`허용 안된 MIME: ${mime}` };
  if (buffer.length > MAX_FILE_BYTES) return { ok:false, reason:`파일 너무 큼 (최대 ${MAX_FILE_MB}MB)` };
  if (mime.startsWith('image/')) {
    const ok = MAGIC.some(m => {
      const o = m.offset||0;
      return buffer.length >= o+m.bytes.length && m.bytes.every((b,i) => buffer[o+i]===b);
    });
    const riff = buffer.length>4 && buffer[0]===0x52&&buffer[1]===0x49&&buffer[2]===0x46&&buffer[3]===0x46;
    if (!ok && !riff) return { ok:false, reason:'파일 내용이 이미지 형식 불일치' };
  }
  if (mime.startsWith('audio/')) {
    const ok = MAGIC.some(m => {
      const o = m.offset||0;
      return buffer.length >= o+m.bytes.length && m.bytes.every((b,i) => buffer[o+i]===b);
    });
    // M4A/AAC는 ftyp 박스로 식별 (offset 4)
    const isM4a = buffer.length>11 && buffer[4]===0x66&&buffer[5]===0x74&&buffer[6]===0x79&&buffer[7]===0x70;
    if (!ok && !isM4a) console.warn('[검증] 오디오 매직 불일치 — 계속 진행');
  }
  return { ok:true };
}

// ═══════════════════════════════════════════════════════════════
// 증거 해시 — SHA-256 (블록체인 타임스탬프 준비)
// ═══════════════════════════════════════════════════════════════
function computeEvidenceHash(buf, filename, timestamp) {
  // 파일 내용 + 파일명 + 타임스탬프를 함께 해시
  const h = crypto.createHash('sha256');
  h.update(buf);
  h.update(filename);
  h.update(timestamp);
  return h.digest('hex');
}

// ═══════════════════════════════════════════════════════════════
// C2PA 콘텐츠 자격증명 확인 — 무료 (파일 내부 분석)
// Adobe Content Credentials / Google SynthID 서명 탐지
// ═══════════════════════════════════════════════════════════════
function checkC2PA(buf, mime) {
  const result = { hasC2PA: false, hasSynthId: false, c2paStatus: 'none', details: [] };
  try {
    const str = buf.slice(0, Math.min(buf.length, 4096)).toString('latin1');
    // C2PA JUMBF 컨테이너 마커 (JPEG APP11, 0xFF EB)
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i] === 0xFF && buf[i+1] === 0xEB) {
          result.hasC2PA = true;
          result.c2paStatus = 'verified';
          result.details.push('C2PA JUMBF 컨테이너 감지 (JPEG APP11)');
          break;
        }
      }
    }
    // XMP 메타데이터에서 C2PA 네임스페이스 탐지
    const xmpStart = buf.indexOf(Buffer.from('http://c2pa.org'));
    if (xmpStart > -1) {
      result.hasC2PA = true;
      result.c2paStatus = 'verified';
      result.details.push('C2PA XMP 메타데이터 감지');
    }
    // PNG에서 C2PA (caBX 또는 c2pa 청크)
    if (mime === 'image/png') {
      const caBX = buf.indexOf(Buffer.from('caBX'));
      if (caBX > -1) { result.hasC2PA = true; result.c2paStatus = 'verified'; result.details.push('C2PA PNG 청크 감지'); }
    }
    // Google SynthID 워터마크 (실험적 탐지)
    if (str.includes('SynthId') || str.includes('synthid') || str.includes('google/deepmind')) {
      result.hasSynthId = true;
      result.details.push('Google SynthID 워터마크 감지');
    }
    // Adobe Firefly 서명
    if (str.includes('adobe:firefly') || str.includes('ContentCredentials') || str.includes('contentcredentials')) {
      result.hasC2PA = true;
      result.c2paStatus = 'verified';
      result.details.push('Adobe Content Credentials 감지');
    }
  } catch {}
  return result;
}

// ═══════════════════════════════════════════════════════════════
// EXIF / PNG 메타데이터 분석 — 무료 (외부 API 불필요)
// AI 생성 도구가 남긴 흔적 탐지: Stable Diffusion, Midjourney,
// DALL-E, ComfyUI, NovelAI, Kling, Runway, Sora 등
// ═══════════════════════════════════════════════════════════════
const AI_SOFTWARE_SIGNATURES = [
  // Stable Diffusion 생태계
  'stable diffusion','stablediffusion','stable-diffusion',
  'automatic1111','a1111','sd webui','webui','vladmandic','sdnext',
  'comfyui','comfy ui','invokeai','invoke ai',
  'novelai','novel ai',
  // LoRA / 파인튜닝 마커
  'lora','dreambooth','hypernetwork','textual inversion',
  'controlnet','control net','animatediff','deforum',
  'ipadapter','instantid','faceid','ip-adapter',
  // 상업용 AI 이미지 툴
  'midjourney','dall-e','dalle','dalle-2','dalle-3',
  'openai','adobe firefly','firefly','adobe ai',
  'canva ai','canva text to image',
  'bing image creator','bing create','designer',
  'leonardo.ai','leonardo ai',
  'nightcafe','night cafe',
  'dreamstudio','dream studio',
  'getimg.ai','getimg',
  'playground ai','playgroundai',
  'tensor.art','tensor art',
  'civitai',
  'fotor ai','fotor',
  'wombo dream','wombo',
  'jasper art','jasper',
  'artbreeder',
  'deep dream','deepdream',
  'craiyon',
  'imagine.art','seaart',
  'stablecog',
  'pixai',
  'nijijourney',
  // GAN 생성 툴
  'stylegan','stylegan2','stylegan3',
  'this person does not exist',
  'generated.photos',
  'generated by ai',
  // 비디오 AI
  'kling','runway','runwayml','sora','pika','pika labs',
  'genmo','haiper','stable video','svd','wan','hailuo',
  'invideo','invideo ai','pixverse',
  // 딥페이크 / 페이스스왑
  'heygen','hey gen','d-id',
  'deepfakelab','faceswap','face swap','reface',
  'avatarify','roop','facefusion','face fusion',
  'deepfakes web',
  // 기타 생성 마커
  'ai generated','ai-generated','ai image',
  'image generator','text to image','text-to-image',
];

// AI 생성 이미지 특유 해상도 (StyleGAN, SD, DALL-E, Flux 등 공통 출력 크기)
const AI_RESOLUTION_SIGNATURES = new Set([
  '256x256',
  '512x512','512x768','768x512','768x768',
  '640x640','640x960','960x640',
  '1024x1024','1024x1792','1792x1024',
  '1152x896','896x1152','1216x832','832x1216',
  '1344x768','768x1344','1536x640','640x1536',
  '1280x1280',
]);

function readJpegDimensions(buf) {
  let i = 2;
  while (i < buf.length - 4) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i+1];
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3) {
      if (i + 9 <= buf.length) {
        const h = buf.readUInt16BE(i+5);
        const w = buf.readUInt16BE(i+7);
        if (w > 0 && h > 0) return { width: w, height: h };
      }
    }
    if (i + 3 >= buf.length) break;
    const segLen = buf.readUInt16BE(i+2);
    if (segLen < 2) { i += 2; continue; }
    i += 2 + segLen;
  }
  return null;
}

function readPngDimensions(buf) {
  if (buf.length < 24) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return (w > 0 && h > 0) ? { width: w, height: h } : null;
}

function parseXmpData(xmpBuf, result) {
  try {
    const xmp = xmpBuf.toString('utf8').toLowerCase();
    const xmpKeywords = [
      'generativeai','ai generated','ai-generated','artificially generated',
      'stable diffusion','midjourney','dall-e','firefly','adobe firefly',
      'generative fill','generative expand','content credentials','c2pa',
      'text-to-image','image generation','openai','bing image creator',
      'leonardo','nightcafe','dreamstudio','created with ai',
    ];
    for (const kw of xmpKeywords) {
      if (xmp.includes(kw)) {
        result.hasAiPrompt = true;
        result.hasExif = true;
        result.details.push(`⚠️ XMP AI 메타데이터 탐지: "${kw}"`);
        break;
      }
    }
    // CreatorTool 필드 체크
    const ctMatch = xmp.match(/<xmp:creatortool[^>]*?>([^<]{1,120})<\/xmp:creatortool>/);
    if (ctMatch) {
      const tool = ctMatch[1].trim();
      const found = AI_SOFTWARE_SIGNATURES.find(s => tool.includes(s));
      if (found) {
        result.aiSoftware = result.aiSoftware || tool.slice(0, 60);
        result.details.push(`⚠️ XMP CreatorTool AI: ${tool.slice(0, 60)}`);
      }
    }
  } catch {}
}

function analyzeExifMetadata(buf, mime) {
  const result = {
    hasExif:        false,
    aiSoftware:     null,   // 탐지된 AI 소프트웨어명
    hasAiPrompt:    false,  // PNG에 AI 프롬프트 텍스트 있으면 true
    hasCameraInfo:  false,  // 실제 카메라 정보 있으면 true
    suspicionScore: 0,      // 0~100 : 높을수록 AI 의심
    details:        []
  };

  try {
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      parseJpegExif(buf, result);
    } else if (mime === 'image/png') {
      parsePngChunks(buf, result);
    } else if (mime === 'image/webp') {
      parseWebpExif(buf, result);
    }
  } catch(e) { /* 파싱 실패해도 무시 */ }

  // 최종 의심 점수 계산
  if (result.aiSoftware)    result.suspicionScore += 80;
  if (result.hasAiPrompt)   result.suspicionScore += 60;
  if (!result.hasCameraInfo && (mime==='image/jpeg'||mime==='image/jpg'))
    result.suspicionScore += 15; // 카메라 정보 없는 JPEG은 약간 의심
  result.suspicionScore = Math.min(result.suspicionScore, 95);

  return result;
}

function parseJpegExif(buf, result) {
  if (buf[0]!==0xFF || buf[1]!==0xD8) return;
  let i = 2;
  while (i < buf.length - 4) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i+1];
    const segLen = buf.readUInt16BE(i+2);
    const segEnd = Math.min(i + 2 + segLen, buf.length);
    if (marker === 0xE1) { // APP1 (EXIF 또는 XMP)
      const header = buf.slice(i+4, Math.min(i+44, buf.length)).toString('latin1');
      if (header.startsWith('Exif')) {
        result.hasExif = true;
        parseExifIFD(buf.slice(i+10, segEnd), result);
      } else if (header.includes('adobe.com/xap') || header.includes('adobe:ns') || header.startsWith('http://ns.adobe')) {
        parseXmpData(buf.slice(i+4, segEnd), result);
      }
    }
    if (marker === 0xE2) { // APP2 — ICC 또는 Flashpix (일부 AI 툴이 여기에 정보 삽입)
      const hdr = buf.slice(i+4, Math.min(i+16, buf.length)).toString('ascii');
      if (hdr.startsWith('MPF') || hdr.includes('FPXR')) {
        result.details.push('APP2 멀티픽처/Flashpix 마커 감지 (일부 합성 이미지에서 나타남)');
      }
    }
    if (marker === 0xFE) { // JPEG COM — 주석 필드
      const comment = buf.slice(i+4, segEnd).toString('utf8').replace(/\0/g,'').trim();
      if (comment.length > 2) {
        const low = comment.toLowerCase();
        const found = AI_SOFTWARE_SIGNATURES.find(s => low.includes(s));
        if (found) {
          result.aiSoftware = result.aiSoftware || comment.slice(0, 60);
          result.details.push(`⚠️ JPEG 주석 AI 탐지: ${comment.slice(0, 60)}`);
        }
      }
    }
    i = segEnd;
  }
}

function parseExifIFD(buf, result) {
  try {
    if (buf.length < 8) return;
    const littleEndian = buf[0]===0x49 && buf[1]===0x49;
    const readU16 = (o) => littleEndian ? buf.readUInt16LE(o) : buf.readUInt16BE(o);
    const readU32 = (o) => littleEndian ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    const firstIFD = readU32(4);
    if (firstIFD + 2 > buf.length) return;
    const count = readU16(firstIFD);
    for (let e = 0; e < count; e++) {
      const base = firstIFD + 2 + e * 12;
      if (base + 12 > buf.length) break;
      const tag      = readU16(base);
      const type     = readU16(base+2);
      const numVals  = readU32(base+4);
      const valOff   = readU32(base+8);
      let strVal = '';
      if (type === 2) { // ASCII
        const dataOffset = (numVals <= 4) ? base+8 : valOff;
        if (dataOffset + numVals <= buf.length) {
          strVal = buf.slice(dataOffset, dataOffset + numVals).toString('ascii').replace(/\0/g,'').trim();
        }
      }
      if (!strVal) continue;
      const low = strVal.toLowerCase();
      // 0x010F=Make, 0x0110=Model, 0x0131=Software
      if (tag === 0x010F || tag === 0x0110) {
        if (strVal.length > 1) { result.hasCameraInfo = true; result.details.push(`카메라: ${strVal}`); }
      }
      if (tag === 0x0131) { // Software
        result.details.push(`소프트웨어: ${strVal}`);
        const found = AI_SOFTWARE_SIGNATURES.find(s => low.includes(s));
        if (found) { result.aiSoftware = strVal; result.details.push(`⚠️ AI 소프트웨어 감지: ${strVal}`); }
      }
    }
  } catch {}
}

function parsePngChunks(buf, result) {
  if (buf.length < 8) return;
  const PNG_SIG = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A];
  if (!PNG_SIG.every((b,i) => buf[i]===b)) return;
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length   = buf.readUInt32BE(offset);
    const type     = buf.slice(offset+4, offset+8).toString('ascii');
    const data     = buf.slice(offset+8, offset+8+length);
    offset += 12 + length;
    if (type === 'tEXt' || type === 'iTXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx < 0) continue;
      const key = data.slice(0, nullIdx).toString('ascii').toLowerCase();
      const val = data.slice(nullIdx+1).toString('utf8').replace(/\0+/g,'').slice(0, 300);
      const valLow = val.toLowerCase();
      // AI 생성 PNG는 보통 아래 키들을 가짐 (SD/ComfyUI/Flux 등)
      const AI_PNG_KEYS = [
        'parameters','prompt','workflow',
        'positive prompt','negative prompt','negative_prompt',
        'sampler','cfg scale','cfg_scale','model hash','model_hash',
        'model','seed','steps','denoising_strength','clip_skip',
        'schedule type','hires upscaler','face restoration',
        'comfy workflow','comfy prompt',
        'ai_generated','generator','creation tool',
      ];
      if (AI_PNG_KEYS.includes(key)) {
        result.hasAiPrompt = true;
        result.hasExif = true;
        result.details.push(`PNG AI 메타데이터(${key}): ${val.slice(0,80)}...`);
      }
      // SD 출력값 내용 패턴 탐지 (키 이름 무관하게 값 안에 SD 출력 마커 있는 경우)
      if (!result.hasAiPrompt && val.length > 10) {
        const sdPatterns = ['steps:', 'sampler:', 'cfg scale:', 'model hash:', 'negative prompt:',
                            'seed:', 'size:', 'clip skip:', 'denoising strength:'];
        const matchCount = sdPatterns.filter(p => valLow.includes(p)).length;
        if (matchCount >= 2) {
          result.hasAiPrompt = true;
          result.hasExif = true;
          result.details.push(`PNG SD 출력 패턴 탐지 (파라미터 ${matchCount}개 일치)`);
        }
      }
      if (key === 'software') {
        const found = AI_SOFTWARE_SIGNATURES.find(s => valLow.includes(s));
        if (found) { result.aiSoftware = val.slice(0,60); result.details.push(`⚠️ AI 소프트웨어(PNG): ${result.aiSoftware}`); }
      }
    }
    if (type === 'IEND') break;
  }
}

function parseWebpExif(buf, result) {
  // WEBP EXIF chunk is inside RIFF container
  const EXIF_SIG = Buffer.from('EXIF');
  let i = 12; // skip RIFF header
  while (i + 8 <= buf.length) {
    const chunkType = buf.slice(i, i+4).toString('ascii');
    const chunkSize = buf.readUInt32LE(i+4);
    if (chunkType === 'EXIF') {
      parseExifIFD(buf.slice(i+8, i+8+chunkSize), result);
      break;
    }
    i += 8 + chunkSize + (chunkSize % 2);
  }
}

// ═══════════════════════════════════════════════════════════════
// 이미지 통계 분석 — JPEG 썸네일 불일치 + GAN 주파수 지문
// 완전 무료, 외부 라이브러리 없음, 순수 버퍼 분석
// ═══════════════════════════════════════════════════════════════
function analyzeImageStatistics(buf, mime) {
  const result = {
    thumbnailMismatch: false,  // JPEG 내부 썸네일 ≠ 본문 → 조작 신호
    ganFrequencyScore: 0,      // 0~100: GAN 바이트 분포 패턴 강도
    compressionArtifacts: 0,   // 반복 아티팩트 지수
    aiResolution: false,       // AI 특유 해상도 패턴
    dimensions: null,          // { width, height }
    suspicionScore: 0,
    details: []
  };
  try {
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      detectJpegThumbnailMismatch(buf, result);
      analyzeJpegBytePattern(buf, result);
      const dims = readJpegDimensions(buf);
      if (dims) {
        result.dimensions = dims;
        const key = `${dims.width}x${dims.height}`;
        if (AI_RESOLUTION_SIGNATURES.has(key)) {
          result.aiResolution = true;
          result.details.push(`⚠️ AI 특유 해상도: ${key} (SD/DALL-E/StyleGAN 공통 출력 크기)`);
        }
      }
    } else if (mime === 'image/png') {
      analyzePngBytePattern(buf, result);
      analyzePngColorStats(buf, result);
      const dims = readPngDimensions(buf);
      if (dims) {
        result.dimensions = dims;
        const key = `${dims.width}x${dims.height}`;
        if (AI_RESOLUTION_SIGNATURES.has(key)) {
          result.aiResolution = true;
          result.details.push(`⚠️ AI 특유 해상도: ${key} (SD/DALL-E/StyleGAN 공통 출력 크기)`);
        }
      }
    }
  } catch(e) { /* 파싱 오류 무시 */ }

  let score = 0;
  if (result.thumbnailMismatch)   score += 35;
  if (result.aiResolution)        score += 18;  // 해상도 단독으론 약한 신호
  score += result.ganFrequencyScore * 0.40;
  score += result.compressionArtifacts * 0.25;

  // 복수 약한 신호 동시 발생 시 추가 부스팅
  const weakSignalCount = [
    result.aiResolution,
    result.ganFrequencyScore > 20,
    result.thumbnailMismatch,
    result.compressionArtifacts > 20,
    (result.colorVariance !== undefined && result.colorVariance < 300),
  ].filter(Boolean).length;
  if (weakSignalCount >= 2) {
    const bonus = weakSignalCount * 7;
    score += bonus;
    result.details.push(`복수 AI 신호 ${weakSignalCount}개 동시 감지 (+${bonus}점 보정)`);
  }

  result.suspicionScore = Math.min(Math.round(score), 88);
  return result;
}

// JPEG 내부 썸네일 vs 본문 불일치 탐지
function detectJpegThumbnailMismatch(buf, result) {
  if (buf.length < 20 || buf[0] !== 0xFF || buf[1] !== 0xD8) return;
  let i = 2;
  while (i < buf.length - 4 && i < 65536) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i+1];
    if (marker === 0x00 || marker === 0xFF) { i++; continue; }
    const segLen = buf.readUInt16BE(i + 2);
    if (marker === 0xE1) { // APP1 = EXIF
      const header = buf.slice(i + 4, i + 10).toString('ascii');
      if (header.startsWith('Exif')) {
        const tiff = buf.slice(i + 10, Math.min(i + 2 + segLen, buf.length));
        const thumb = extractJpegThumbnail(tiff);
        if (thumb && thumb.length > 200) {
          const thumbHash = simpleByteHash(thumb.slice(0, Math.min(thumb.length, 512)));
          const sosPos = findJpegSOS(buf);
          if (sosPos > 0) {
            const mainSample = buf.slice(sosPos, Math.min(sosPos + 512, buf.length));
            const mainHash = simpleByteHash(mainSample);
            const diff = Math.abs(thumbHash - mainHash) / Math.max(thumbHash, mainHash, 1);
            if (diff > 0.72) {
              result.thumbnailMismatch = true;
              result.details.push(`⚠️ JPEG 썸네일-본문 불일치 탐지 (차이율 ${(diff*100).toFixed(0)}%)`);
            }
          }
        }
      }
    }
    i += 2 + segLen;
  }
}

function extractJpegThumbnail(tiff) {
  try {
    if (tiff.length < 8) return null;
    const le = tiff[0] === 0x49 && tiff[1] === 0x49;
    const r16 = o => le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o);
    const r32 = o => le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
    const ifd0Off = r32(4);
    if (ifd0Off + 2 > tiff.length) return null;
    const ifd0Cnt = r16(ifd0Off);
    const ifd1Ptr = ifd0Off + 2 + ifd0Cnt * 12;
    if (ifd1Ptr + 4 > tiff.length) return null;
    const ifd1Off = r32(ifd1Ptr);
    if (!ifd1Off || ifd1Off + 2 > tiff.length) return null;
    const ifd1Cnt = r16(ifd1Off);
    let jpgOff = 0, jpgLen = 0;
    for (let e = 0; e < ifd1Cnt; e++) {
      const base = ifd1Off + 2 + e * 12;
      if (base + 12 > tiff.length) break;
      const tag = r16(base), val = r32(base + 8);
      if (tag === 0x0201) jpgOff = val;
      if (tag === 0x0202) jpgLen = val;
    }
    if (jpgOff > 0 && jpgLen > 0 && jpgOff + jpgLen <= tiff.length)
      return tiff.slice(jpgOff, jpgOff + jpgLen);
    return null;
  } catch { return null; }
}

function findJpegSOS(buf) {
  for (let i = 2; i < buf.length - 2; i++) {
    if (buf[i] === 0xFF && buf[i+1] === 0xDA) return i + 2;
  }
  return -1;
}

function simpleByteHash(buf) {
  let weighted = 0, sum = 0;
  for (let i = 0; i < buf.length; i++) { sum += buf[i]; weighted += buf[i] * (i + 1); }
  return buf.length > 0 ? weighted / (sum || 1) : 0;
}

// GAN 주파수 지문 — JPEG 스캔 데이터 바이트 분포 분석
// GAN/확산모델 이미지는 JPEG로 저장 시 엔트로피 코딩 바이트 분포가 더 균일
function analyzeJpegBytePattern(buf, result) {
  const sosPos = findJpegSOS(buf);
  if (sosPos < 0 || sosPos + 2000 > buf.length) return;
  const scan = buf.slice(sosPos, Math.min(sosPos + 16384, buf.length - 2));
  // 바이트 주파수 분포 카이제곱 검정
  const freq = new Array(256).fill(0);
  for (const b of scan) freq[b]++;
  const expected = scan.length / 256;
  let chi = 0;
  for (const f of freq) { const d = f - expected; chi += d * d / expected; }
  // chi가 낮을수록 균일(GAN 특성), 높을수록 자연사진(불균일)
  const normChi = Math.min(chi / (scan.length * 2), 1);
  const ganScore = Math.round((1 - normChi) * 55);
  if (ganScore > 28) {
    result.ganFrequencyScore = ganScore;
    result.details.push(`GAN 주파수 패턴: ${ganScore}점 (JPEG DCT 바이트 균일도 이상)`);
  }
  // 4-바이트 주기 반복 패턴 (GAN 업샘플링 아티팩트)
  let reps = 0;
  const sampleLen = Math.min(scan.length - 8, 8192);
  for (let i = 0; i < sampleLen; i++) {
    if (scan[i] === scan[i+4] && scan[i+1] === scan[i+5] &&
        scan[i] !== 0xFF && scan[i] !== 0x00) reps++;
  }
  const repRatio = reps / sampleLen;
  if (repRatio > 0.14) {
    result.compressionArtifacts = Math.round(repRatio * 100);
    result.details.push(`반복 아티팩트: ${result.compressionArtifacts}점 (GAN 업샘플링 패턴 의심)`);
  }
}

// PNG 픽셀 색상 통계 분석 (zlib 디코딩 기반)
// GAN 이미지는 색상 분포가 실제 사진보다 인공적으로 균일한 경향
function analyzePngColorStats(buf, result) {
  try {
    if (buf.length < 24) return;
    const width    = buf.readUInt32BE(16);
    const height   = buf.readUInt32BE(20);
    const bitDepth = buf[24];
    const colorType= buf[25];
    if (bitDepth !== 8) return; // 8비트만 처리
    if (colorType !== 2 && colorType !== 6) return; // RGB 또는 RGBA만
    const channels = colorType === 6 ? 4 : 3;

    // IDAT 청크 수집
    const idatChunks = [];
    let offset = 8;
    while (offset + 12 <= buf.length) {
      const len  = buf.readUInt32BE(offset);
      const type = buf.slice(offset+4, offset+8).toString('ascii');
      if (type === 'IDAT') idatChunks.push(buf.slice(offset+8, offset+8+len));
      if (type === 'IEND') break;
      offset += 12 + len;
      if (offset > 8 * 1024 * 1024) break; // 8MB 제한
    }
    if (idatChunks.length === 0) return;

    const compressed = Buffer.concat(idatChunks);
    if (compressed.length > 6 * 1024 * 1024) return; // 너무 큰 파일 스킵
    const raw = zlib.inflateSync(compressed);

    const stride = width * channels + 1; // 필터 바이트 포함
    // 20×20 그리드 샘플링
    const rowStep = Math.max(1, Math.floor(height / 20));
    const colStep = Math.max(1, Math.floor(width  / 20));

    let rSum=0, gSum=0, bSum=0;
    let rSq=0,  gSq=0,  bSq=0;
    let count = 0;
    for (let row = 0; row < height; row += rowStep) {
      const rowBase = row * stride + 1;
      if (rowBase + width * channels > raw.length) break;
      for (let col = 0; col < width; col += colStep) {
        const px = rowBase + col * channels;
        const r = raw[px], g = raw[px+1], b = raw[px+2];
        rSum += r; gSum += g; bSum += b;
        rSq  += r*r; gSq += g*g; bSq += b*b;
        count++;
      }
    }
    if (count < 20) return;

    const rM = rSum/count, gM = gSum/count, bM = bSum/count;
    const rV = rSq/count - rM*rM;
    const gV = gSq/count - gM*gM;
    const bV = bSq/count - bM*bM;
    const avgVar = (rV + gV + bV) / 3;

    // 평균 채도 계산 (max - min per pixel)
    let satSum = 0;
    for (let row = 0; row < height; row += rowStep) {
      const rowBase = row * stride + 1;
      if (rowBase + width * channels > raw.length) break;
      for (let col = 0; col < width; col += colStep) {
        const px = rowBase + col * channels;
        const r = raw[px], g = raw[px+1], b = raw[px+2];
        satSum += Math.max(r,g,b) - Math.min(r,g,b);
      }
    }
    const avgSat = satSum / count;

    result.colorVariance = Math.round(avgVar);
    result.colorSaturation = Math.round(avgSat);

    // 신호 1: 색상 분산이 매우 낮음 (단색/단조 배경 많은 AI 아트)
    if (avgVar < 300 && count > 30) {
      const score = Math.round((1 - avgVar / 300) * 25);
      result.ganFrequencyScore = Math.max(result.ganFrequencyScore, score);
      result.details.push(`PNG 색상 균일도 의심: 분산=${Math.round(avgVar)} (낮을수록 합성 가능)`);
    }
    // 신호 2: 채도가 극단적으로 높음 (AI 일러스트/Midjourney 특성)
    if (avgSat > 160) {
      result.details.push(`PNG 고채도 이미지: 평균채도=${Math.round(avgSat)} (AI 생성 아트 경향)`);
      result.compressionArtifacts = Math.max(result.compressionArtifacts, 15);
    }
  } catch { /* zlib 실패 또는 디코딩 오류 무시 */ }
}

// PNG 바이트 패턴 분석
function analyzePngBytePattern(buf, result) {
  let offset = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type   = buf.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT' && length > 100) {
      const data = buf.slice(offset + 8, offset + 8 + Math.min(length, 2000));
      let zeros = 0;
      for (const b of data) if (b === 0) zeros++;
      const zeroRatio = zeros / data.length;
      if (zeroRatio > 0.38) {
        result.ganFrequencyScore = Math.max(result.ganFrequencyScore, Math.round(zeroRatio * 70));
        result.details.push(`PNG IDAT 패턴 이상 (0바이트 비율: ${(zeroRatio*100).toFixed(0)}%)`);
      }
      break; // 첫 IDAT만 샘플링
    }
    if (type === 'IEND') break;
    offset += 12 + length;
    if (offset > 5 * 1024 * 1024) break;
  }
}

// ─── HTTPS 요청 ───────────────────────────────────────────────
function httpsReq(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(raw), raw }); }
        catch { resolve({ status: res.statusCode, data: raw, raw }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// S3 PUT
function uploadS3(signedUrl, buf, ct) {
  return new Promise((resolve, reject) => {
    const p = new url.URL(signedUrl), lib = p.protocol==='https:'?https:http;
    const req = lib.request({ hostname:p.hostname, path:p.pathname+p.search, method:'PUT',
      headers:{ 'Content-Type':ct, 'Content-Length':buf.length } }, res => {
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode}));
    });
    req.on('error', reject); req.write(buf); req.end();
  });
}

// Multipart 파싱
function parseMultipart(buffer, boundary) {
  const parts=[], sep=Buffer.from('--'+boundary), end=Buffer.from('--'+boundary+'--');
  let s=0;
  while(s<buffer.length) {
    const si=bufIdx(buffer,sep,s); if(si<0)break;
    const ns=bufIdx(buffer,sep,si+sep.length+2); if(ns<0)break;
    const part=buffer.slice(si+sep.length+2,ns-2);
    const he=bufIdx(part,Buffer.from('\r\n\r\n'),0); if(he<0){s=ns;continue;}
    const hStr=part.slice(0,he).toString(), body=part.slice(he+4);
    const nm=hStr.match(/name="([^"]+)"/),fn=hStr.match(/filename="([^"]+)"/),ct=hStr.match(/Content-Type:\s*(.+)/i);
    parts.push({name:nm?nm[1]:'',filename:fn?fn[1]:null,contentType:ct?ct[1].trim():'application/octet-stream',data:body});
    s=ns; if(bufIdx(buffer,end,s)===s)break;
  }
  return parts;
}
function bufIdx(buf,search,start=0) {
  for(let i=start;i<=buf.length-search.length;i++){
    let ok=true;for(let j=0;j<search.length;j++)if(buf[i+j]!==search[j]){ok=false;break;}
    if(ok)return i;
  }return -1;
}

// Multipart 빌드
function buildMp(fileBuf, filename, ct, boundary, fieldName='image') {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${ct}\r\n\r\n`),
    fileBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
}

// ═══════════════════════════════════════════════════════════════
// Reality Defender
// ═══════════════════════════════════════════════════════════════
async function analyzeWithRD(fileBuf, filename, fileMime, isVideo) {
  try {
    const bj = JSON.stringify({ fileName: filename });
    const pr = await httpsReq({
      hostname:RD_HOST, path:'/api/files/aws-presigned', method:'POST',
      headers:{
        'X-API-KEY':RD_API_KEY,'Authorization':`Bearer ${RD_API_KEY}`,
        'Content-Type':'application/json','Content-Length':Buffer.byteLength(bj),
        'User-Agent':'Mozilla/5.0','Accept':'application/json'
      }
    }, bj);

    console.log(`[RD] presigned HTTP ${pr.status}`);
    if (pr.status!==200&&pr.status!==201) {
      const msg = `RD presigned 실패 (HTTP ${pr.status}): ${pr.raw.slice(0,300)}`;
      lastDebug.rdError = msg; console.error('[RD]', msg); return null;
    }

    let d = pr.data;
    if (typeof d==='string') { try{d=JSON.parse(d);}catch{d={};} }
    const signedUrl=(d.response&&d.response.signedUrl)||d.signedUrl;
    const requestId=d.requestId||d.mediaId;
    if (!signedUrl||!requestId) {
      const msg = `RD signedUrl/requestId 없음. 응답: ${JSON.stringify(d).slice(0,200)}`;
      lastDebug.rdError = msg; console.error('[RD]', msg); return null;
    }

    const up = await uploadS3(signedUrl, fileBuf, fileMime);
    if (up.status>=400) {
      const msg = `RD S3 업로드 실패 (HTTP ${up.status})`;
      lastDebug.rdError = msg; console.error('[RD]', msg); return null;
    }

    const raw = await pollRD(requestId, isVideo?300000:90000);
    lastDebug.rdRaw = raw;
    return parseRD(raw);

  } catch(e) {
    const msg = `RD 예외: ${e.message}`;
    lastDebug.rdError = msg; console.error('[RD]', msg); return null;
  }
}

async function pollRD(rid, maxMs, interval=3000) {
  const start=Date.now(); let n=0;
  while(Date.now()-start<maxMs) {
    await new Promise(r=>setTimeout(r,interval)); n++;
    try {
      const r=await httpsReq({
        hostname:RD_HOST,path:`/api/media/users/${rid}`,method:'GET',
        headers:{'X-API-KEY':RD_API_KEY,'Authorization':`Bearer ${RD_API_KEY}`,'Accept':'application/json','User-Agent':'Mozilla/5.0'}
      });
      const d=r.data;
      if(n<=3) console.log(`  [RD폴링${n}] 전체응답:`, JSON.stringify(d).slice(0,400));
      const st=(d.status||d.requestStatus||d.data?.status||d.data?.requestStatus||'').toLowerCase();
      const models=d.models||d.data?.models||d.response?.models||[];
      console.log(`  [RD폴링${n}] status="${st}" models=${models.length}`);
      if(st==='done'||st==='completed'||st==='success'||st==='complete') return d;
      if(models.length>0) return d;
      if(st==='error'||st==='failed') throw new Error('RD 분석 실패: '+JSON.stringify(d).slice(0,200));
      if(n>=15 && st==='' && models.length===0) {
        console.warn('[RD] 15번 폴링 후에도 status 없음 — free tier 제한 가능성');
        throw new Error('RD free tier 미지원: 이 이미지 유형은 분석 불가');
      }
    } catch(e){ if(e.message.includes('RD 분석 실패')||e.message.includes('RD free tier'))throw e; }
  }
  throw new Error('RD 시간 초과');
}

function parseRD(data) {
  const raw = data.models||data.data?.models||[];
  console.log('[RD] 모델:', raw.map(m=>`${m.name||m.modelName}=${((m.score||0)*100).toFixed(1)}%`).join(', ')||'없음');
  const models = raw.map(m=>({
    name:  m.name||m.modelName||'unknown',
    score: typeof m.score==='number'?m.score:parseFloat(m.score)||0,
    type:  rdType(m.name||m.modelName||'')
  }));
  const valid = models.filter(m=>m.score>=0&&m.score<=1);
  const hasRealData = valid.some(m=>m.score>0.01);
  const dfM = valid.filter(m=>m.type==='deepfake');
  const agM = valid.filter(m=>m.type==='aigen');
  const deepfakeScore = dfM.length>0 ? Math.round(dfM.reduce((s,m)=>s+m.score,0)/dfM.length*100) : null;
  const aiGenScore    = agM.length>0 ? Math.round(agM.reduce((s,m)=>s+m.score,0)/agM.length*100) : null;
  const score = valid.length>0 ? Math.round(valid.reduce((s,m)=>s+m.score,0)/valid.length*100) : 0;
  console.log(`[RD] 파싱 → score=${score}% hasData=${hasRealData}`);
  return { score, models, deepfakeScore, aiGenScore, hasRealData };
}

function rdType(name) {
  const n=name.toLowerCase();
  if(n.includes('context')||n.includes('genai')||n.includes('gen-')||n.includes('llm')) return 'aigen';
  if(n.includes('oak')||n.includes('elm')||n.includes('cedar')||n.includes('full')||
     n.includes('ensemble')||n.includes('img')||n.includes('vid')) return 'deepfake';
  return 'other';
}

// ═══════════════════════════════════════════════════════════════
// Hive Moderation
// ═══════════════════════════════════════════════════════════════
async function analyzeWithHive(fileBuf, filename, fileMime) {
  if (!HIVE_API_KEY) return null;
  let result = await hiveMultipart(fileBuf, filename, fileMime);
  if (result) return result;
  console.log('[Hive] 방식1 실패 → 방식2(base64 JSON) 시도');
  result = await hiveBase64(fileBuf, fileMime);
  if (result) return result;
  console.warn('[Hive] 두 방식 모두 실패');
  return null;
}

async function hiveMultipart(fileBuf, filename, fileMime) {
  const boundary = 'Unveil' + Date.now().toString(36);
  const body = buildMp(fileBuf, filename, fileMime, boundary, 'image');
  // 방식 A: Token 헤더
  let res;
  try {
    res = await httpsReq({
      hostname: HIVE_HOST, path: '/api/v2/task/sync', method: 'POST',
      headers: {
        'Authorization': `Token ${HIVE_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
  } catch(e) { console.warn('[Hive/mp] 연결 오류:', e.message); return null; }

  // Token 헤더가 403이면 api_key 쿼리파라미터 방식 재시도
  if (res.status === 403) {
    console.log('[Hive/mp] Token 헤더 403 → api_key 쿼리파라미터 방식 시도');
    try {
      const r2 = await httpsReq({
        hostname: HIVE_HOST,
        path: `/api/v2/task/sync?api_key=${encodeURIComponent(HIVE_API_KEY)}`,
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, body);
      console.log(`[Hive/mp-qp] HTTP ${r2.status}`);
      if (r2.status === 200) res = r2;
      else console.warn(`[Hive/mp-qp] RAW: ${r2.raw.slice(0,300)}`);
    } catch(e2) { console.warn('[Hive/mp-qp] 오류:', e2.message); }
  }

  lastDebug.hiveStatus = res.status;
  lastDebug.hiveRaw    = res.raw;
  console.log(`[Hive/mp] HTTP ${res.status}`);
  console.log(`[Hive/mp] RAW(앞500자): ${res.raw.slice(0, 500)}`);
  if (res.status !== 200) { lastDebug.hiveError = `HTTP ${res.status}: ${res.raw.slice(0,200)}`; return null; }
  return parseHive(res.data, 'mp');
}

async function hiveBase64(fileBuf, fileMime) {
  const b64 = fileBuf.toString('base64');
  const payload = JSON.stringify({ image: { data: b64 } });
  let res;
  try {
    res = await httpsReq({
      hostname: HIVE_HOST, path: '/api/v2/task/sync', method: 'POST',
      headers: {
        'Authorization': `Token ${HIVE_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, payload);
  } catch(e) { console.warn('[Hive/b64] 연결 오류:', e.message); return null; }

  // Token 헤더가 403이면 api_key 쿼리파라미터 방식 재시도
  if (res.status === 403) {
    console.log('[Hive/b64] Token 헤더 403 → api_key 쿼리파라미터 방식 시도');
    try {
      const payload2 = JSON.stringify({ image: { data: b64 } });
      const r2 = await httpsReq({
        hostname: HIVE_HOST,
        path: `/api/v2/task/sync?api_key=${encodeURIComponent(HIVE_API_KEY)}`,
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload2)
        }
      }, payload2);
      console.log(`[Hive/b64-qp] HTTP ${r2.status}`);
      if (r2.status === 200) res = r2;
      else console.warn(`[Hive/b64-qp] RAW: ${r2.raw.slice(0,300)}`);
    } catch(e2) { console.warn('[Hive/b64-qp] 오류:', e2.message); }
  }

  lastDebug.hiveStatus = res.status;
  lastDebug.hiveRaw    = res.raw;
  console.log(`[Hive/b64] HTTP ${res.status}`);
  console.log(`[Hive/b64] RAW(앞500자): ${res.raw.slice(0, 500)}`);
  if (res.status !== 200) { lastDebug.hiveError = `HTTP ${res.status}: ${res.raw.slice(0,200)}`; return null; }
  return parseHive(res.data, 'b64');
}

function parseHive(data, method) {
  try {
    const output =
      data?.status?.[0]?.response?.output?.[0]?.classes ||
      data?.status?.[0]?.response?.output?.classes ||
      data?.output?.[0]?.classes ||
      data?.classes || [];

    if (output.length === 0) {
      console.warn(`[Hive/${method}] classes 없음. 전체구조:`, JSON.stringify(data).slice(0,300));
      return null;
    }
    console.log(`[Hive/${method}] 클래스:`, output.map(c=>`${c.class}=${(c.score*100).toFixed(1)}%`).join(', '));

    const FAKE_CLS = ['deepfake','face_swap','manipulated','ai_generated','ai_generated_image',
                      'ai_generated_video','synthetic','generated','yes','fake'];
    const REAL_CLS = ['real','not_ai_generated','authentic','original','no','human','genuine'];

    let fakeScore=0, realScore=0, foundFake=false, foundReal=false;
    for (const c of output) {
      const cls = (c.class||'').toLowerCase().replace(/[_\-\s]+/g,'_');
      if (FAKE_CLS.some(f => cls===f||cls.includes(f))) { if(c.score>fakeScore){fakeScore=c.score;} foundFake=true; }
      if (REAL_CLS.some(r => cls===r||cls.includes(r))) { if(c.score>realScore){realScore=c.score;} foundReal=true; }
    }
    if (!foundFake && foundReal) fakeScore = 1 - realScore;
    if (!foundFake && !foundReal) {
      fakeScore = Math.max(...output.map(c=>c.score||0));
      console.warn(`[Hive/${method}] 알 수 없는 클래스 — 최고점수를 fake로 처리`);
    }
    const score = Math.round(fakeScore * 100);
    console.log(`[Hive/${method}] fake score: ${score}%`);
    return { score, classes: output };
  } catch(e) { console.warn(`[Hive/${method}] 파싱 오류:`, e.message); return null; }
}

// ═══════════════════════════════════════════════════════════════
// AI or Not (aiornot.com) — AI 이미지/딥페이크 탐지 전문
// ═══════════════════════════════════════════════════════════════
async function analyzeWithAION(fileBuf, filename, fileMime) {
  if (!AION_API_KEY) return null;

  // 방식 1: multipart form-data (object 필드)
  let result = await aionMultipart(fileBuf, filename, fileMime);
  if (result) return result;

  // 방식 2: JSON + base64
  console.log('[AION] 방식1 실패 → 방식2(base64) 시도');
  result = await aionBase64(fileBuf, fileMime);
  if (result) return result;

  console.warn('[AION] 두 방식 모두 실패');
  return null;
}

async function aionMultipart(fileBuf, filename, fileMime) {
  const boundary = 'UnveilAION' + Date.now().toString(36);
  const body = buildMp(fileBuf, filename, fileMime, boundary, 'object');
  let res;
  try {
    res = await httpsReq({
      hostname: AION_HOST, path: '/v1/reports/image', method: 'POST',
      headers: {
        'Authorization': `Bearer ${AION_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
  } catch(e) { console.warn('[AION/mp] 연결 오류:', e.message); return null; }

  lastDebug.aionStatus = res.status;
  lastDebug.aionRaw    = res.raw;
  console.log(`[AION/mp] HTTP ${res.status}`);
  console.log(`[AION/mp] RAW(앞500자): ${res.raw.slice(0, 500)}`);
  if (res.status !== 200 && res.status !== 201) {
    lastDebug.aionError = `HTTP ${res.status}: ${res.raw.slice(0,200)}`; return null;
  }
  return parseAION(res.data, 'mp');
}

async function aionBase64(fileBuf, fileMime) {
  const b64 = `data:${fileMime};base64,` + fileBuf.toString('base64');
  const payload = JSON.stringify({ object: b64 });
  let res;
  try {
    res = await httpsReq({
      hostname: AION_HOST, path: '/v1/reports/image', method: 'POST',
      headers: {
        'Authorization': `Bearer ${AION_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, payload);
  } catch(e) { console.warn('[AION/b64] 연결 오류:', e.message); return null; }

  lastDebug.aionStatus = res.status;
  lastDebug.aionRaw    = res.raw;
  console.log(`[AION/b64] HTTP ${res.status}`);
  console.log(`[AION/b64] RAW(앞500자): ${res.raw.slice(0, 500)}`);
  if (res.status !== 200 && res.status !== 201) {
    lastDebug.aionError = `HTTP ${res.status}: ${res.raw.slice(0,200)}`; return null;
  }
  return parseAION(res.data, 'b64');
}

function parseAION(data, method) {
  try {
    console.log(`[AION/${method}] 전체 응답:`, JSON.stringify(data).slice(0, 500));

    // 구조: { report: { verdict: "ai"|"human", ai: { is_detected, confidence }, generator: {...} } }
    const report = data?.report || data;

    const verdict  = (report?.verdict || '').toLowerCase();
    // confidence가 실제 필드명 (score는 없음)
    const aiScore  = report?.ai?.confidence ?? report?.ai?.score ?? report?.score ?? null;
    const isAI     = report?.ai?.is_detected ?? (verdict === 'ai');

    let fakeScore;
    if (aiScore !== null) {
      fakeScore = verdict === 'ai' ? aiScore : 1 - aiScore;
    } else if (verdict === 'ai') {
      fakeScore = 0.85;
    } else if (verdict === 'human') {
      fakeScore = 0.10;
    } else {
      console.warn(`[AION/${method}] 알 수 없는 verdict:`, verdict);
      return null;
    }

    const score = Math.round(Math.max(0, Math.min(1, fakeScore)) * 100);
    const generator = report?.generator?.name || null;

    console.log(`[AION/${method}] verdict="${verdict}" score=${score}% generator=${generator||'없음'}`);
    return { score, verdict, generator, isAI, rawReport: report };

  } catch(e) { console.warn(`[AION/${method}] 파싱 오류:`, e.message); return null; }
}

// ═══════════════════════════════════════════════════════════════
// 음성 딥페이크 분석 — Hive audio + AION audio
// ═══════════════════════════════════════════════════════════════
async function analyzeAudioWithHive(fileBuf, filename, fileMime) {
  if (!HIVE_API_KEY) return null;
  const boundary = 'UnveilAudio' + Date.now().toString(36);
  // Hive audio deepfake endpoint: audio 필드명으로 multipart 전송
  const body = buildMp(fileBuf, filename, fileMime, boundary, 'audio');
  try {
    const res = await httpsReq({
      hostname: HIVE_HOST, path: '/api/v2/task/sync', method: 'POST',
      headers: {
        'Authorization': `Token ${HIVE_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
    console.log(`[Hive/audio] HTTP ${res.status} RAW: ${res.raw.slice(0,400)}`);
    if (res.status !== 200) return null;
    // 오디오 응답은 이미지와 동일 구조
    return parseHive(res.data, 'audio');
  } catch(e) { console.warn('[Hive/audio] 오류:', e.message); return null; }
}

async function analyzeAudioWithAION(fileBuf, filename, fileMime) {
  if (!AION_API_KEY) return null;
  const boundary = 'UnveilAIONAudio' + Date.now().toString(36);
  // AION audio endpoint: /v1/reports/audio
  const body = buildMp(fileBuf, filename, fileMime, boundary, 'object');
  try {
    const res = await httpsReq({
      hostname: AION_HOST, path: '/v1/reports/audio', method: 'POST',
      headers: {
        'Authorization': `Bearer ${AION_API_KEY}`,
        'Accept': 'application/json',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
    console.log(`[AION/audio] HTTP ${res.status} RAW: ${res.raw.slice(0,400)}`);
    if (res.status !== 200 && res.status !== 201) return null;
    return parseAION(res.data, 'audio');
  } catch(e) { console.warn('[AION/audio] 오류:', e.message); return null; }
}

// ═══════════════════════════════════════════════════════════════
// 결과 병합 — 3중 API + 로컬 모델 + EXIF + 이미지 통계
// 기본 가중치: RD 35% + Hive 30% + AION 20% + LocalModel 15%
// 로컬 모델 없을 때: RD 40% + Hive 35% + AION 25% (자동 재분배)
// 컨센서스 보정: 전원 동의 시 ±보정
// ═══════════════════════════════════════════════════════════════
function mergeResults(rd, hive, aion, exif, imageStats, localResult) {
  const rdScore    = rd          ? rd.score          : null;
  const hiveScore  = hive        ? hive.score        : null;
  const aionScore  = aion        ? aion.score        : null;
  const localScore = (localResult && localResult.score !== null) ? localResult.score : null;

  // 가중 평균 — 활성 API만으로 재계산
  // 로컬 모델 있을 때: RD 35% + Hive 30% + AION 20% + Local 15%
  // 로컬 모델 없을 때: RD 40% + Hive 35% + AION 25%
  const rdHasData = rd && rd.hasRealData;
  const hasLocal  = localScore !== null;
  const parts = [];
  if (rdScore    !== null && rdHasData) parts.push({ s: rdScore,    w: hasLocal ? 0.35 : 0.40 });
  if (hiveScore  !== null)              parts.push({ s: hiveScore,  w: hasLocal ? 0.30 : 0.35 });
  if (aionScore  !== null)              parts.push({ s: aionScore,  w: hasLocal ? 0.20 : 0.25 });
  if (localScore !== null)              parts.push({ s: localScore, w: 0.15 });
  // 가중치 합이 1이 안 될 때 자동 정규화 → totalW로 나누므로 별도 조정 불필요

  let score;
  if (parts.length === 0) {
    // API 없을 때 EXIF + 이미지통계를 기본 점수로 사용
    const exifBase  = exif       ? exif.suspicionScore       : 0;
    const statsBase = imageStats ? imageStats.suspicionScore : 0;
    score = Math.round(Math.max(exifBase, statsBase) * 0.7 + Math.min(exifBase, statsBase) * 0.3);
  } else {
    const totalW = parts.reduce((a,p)=>a+p.w, 0);
    score = Math.round(parts.reduce((a,p)=>a + p.s * (p.w/totalW), 0));
  }

  // FAKE 판정 시 표시 점수는 최고 점수(가장 위험한 신호)로 표시
  const maxScore = Math.max(
    rdScore   !== null ? rdScore   : 0,
    hiveScore !== null ? hiveScore : 0,
    aionScore !== null ? aionScore : 0
  );

  const rdHasNoData = rd && !rd.hasRealData;

  const rdFake    = rdScore    !== null && rdHasData && rdScore    >= FAKE_THRESHOLD;
  const hiveFake  = hiveScore  !== null && hiveScore  >= FAKE_THRESHOLD;
  const aionFake  = aionScore  !== null && aionScore  >= FAKE_THRESHOLD;
  const localFake = localScore !== null && localScore >= FAKE_THRESHOLD;

  const rdReal    = rdScore    === null || !rdHasData || rdScore    < UNCERTAIN_THRESHOLD;
  const hiveReal  = hiveScore  === null || hiveScore  < UNCERTAIN_THRESHOLD;
  const aionReal  = aionScore  === null || aionScore  < UNCERTAIN_THRESHOLD;
  const localReal = localScore === null || localScore < UNCERTAIN_THRESHOLD;

  // 유효한 응답이 있는 소스 수
  const respondedCount = [
    rdScore    !== null && rdHasData,
    hiveScore  !== null,
    aionScore  !== null,
    localScore !== null
  ].filter(Boolean).length;

  const fakeCount = [rdFake, hiveFake, aionFake, localFake].filter(Boolean).length;

  // ── EXIF 신호 통합 ─────────────────────────────────────────
  const exifAiDetected  = exif && (exif.aiSoftware || exif.hasAiPrompt);
  const exifSuspicion   = exif ? exif.suspicionScore : 0;
  if (exifAiDetected) {
    // API 있으면 15% 반영, API 없으면 더 강하게 반영
    const exifW = parts.length > 0 ? 0.15 : 0.40;
    score = Math.round(score * (1 - exifW) + exifSuspicion * exifW);
  }

  // ── 이미지 통계 신호 통합 ──────────────────────────────────
  const imgStatsSuspicion = imageStats ? imageStats.suspicionScore : 0;
  const imgThumbMismatch  = imageStats ? imageStats.thumbnailMismatch : false;
  if (imgStatsSuspicion > 20) {
    // API 있으면 10% 반영, API 없으면 더 강하게 반영
    const statsW = parts.length > 0 ? 0.10 : 0.25;
    score = Math.round(score * (1 - statsW) + imgStatsSuspicion * statsW);
  }

  // ── 컨센서스 보정 ──────────────────────────────────────────
  // 전원 FAKE 동의 → +15%, 전원 REAL 동의 → -10%
  // 로컬 모델 포함 시 더 강한 합의 신호
  if (respondedCount >= 3) {
    const realVotes = [rdReal, hiveReal, aionReal, localReal].filter(Boolean).length;
    if (fakeCount === respondedCount) {
      score = Math.min(score + 15, 99);
      console.log(`[컨센서스] 전원(${respondedCount}개) FAKE 동의 → +15% → ${score}%`);
    }
    if (realVotes === respondedCount) {
      score = Math.max(score - 10, 1);
      console.log(`[컨센서스] 전원(${respondedCount}개) REAL 동의 → -10% → ${score}%`);
    }
  }
  // 썸네일 불일치는 강력한 조작 신호 → 단독으로 UNCERTAIN 격상 가능
  if (imgThumbMismatch && fakeCount === 0) {
    console.log(`[이미지통계] 썸네일-본문 불일치 탐지 → UNCERTAIN 격상 고려`);
  }

  // FAKE 판정: 2개 이상 API 동의 OR 1개 API가 90% 이상 극확신
  // EXIF AI 소프트웨어 감지 시: 단일 API 확신만으로도 FAKE 가능
  const highConfidenceFake = maxScore >= 90 && fakeCount >= 1;
  const exifBoostedFake    = exifAiDetected && fakeCount >= 1;
  const statsBoostedFake   = imgThumbMismatch && fakeCount >= 1;
  // API 없어도 EXIF 확신 시 FAKE 판정 (AI 소프트웨어가 명시적으로 감지됨)
  const exifAloneFake      = exifAiDetected && exifSuspicion >= 75 && respondedCount === 0;
  // API 없어도 이미지통계가 강한 신호 시 UNCERTAIN
  const statsAloneUncertain = imgStatsSuspicion >= 45 && respondedCount === 0;

  let verdict;
  if (fakeCount >= 2 || highConfidenceFake || exifBoostedFake || statsBoostedFake || exifAloneFake) verdict = 'FAKE';
  else if (rdHasNoData && !hiveScore && !aionScore && !exifAiDetected && !statsAloneUncertain) verdict = 'INSUFFICIENT';
  else if (fakeCount === 1 && respondedCount <= 1)             verdict = 'REAL';
  else if (fakeCount === 1)                                    verdict = 'UNCERTAIN';
  else if (imgThumbMismatch)                                   verdict = 'UNCERTAIN';
  else if (exifAiDetected)                                     verdict = 'UNCERTAIN'; // EXIF 단독 (API 유무 무관)
  else if (statsAloneUncertain)                                verdict = 'UNCERTAIN'; // 이미지통계 단독 강신호
  else if (rdReal && hiveReal && aionReal)                     verdict = 'REAL';
  else                                                         verdict = 'UNCERTAIN';

  // FAKE면 최고 위험 점수, REAL이면 실제 가중평균 표시 (0으로 내리지 않음)
  const displayScore = verdict === 'FAKE'
    ? Math.max(maxScore, exifSuspicion, imgStatsSuspicion)
    : score;

  const verdictKo = {
    FAKE:'딥페이크 의심', UNCERTAIN:'판별 불확실',
    REAL:'진짜로 보임', INSUFFICIENT:'데이터 불충분'
  }[verdict];

  const exifLog   = exif        ? ` EXIF=${exifSuspicion}%(${exif.aiSoftware||'없음'})` : '';
  const statsLog  = imageStats  ? ` Stats=${imgStatsSuspicion}%(thumb=${imgThumbMismatch},gan=${imageStats.ganFrequencyScore})` : '';
  const localLog  = localScore  !== null ? ` Local=${localScore}%` : '';
  console.log(`[병합] RD=${rdScore??'N/A'}% Hive=${hiveScore??'N/A'}% AION=${aionScore??'N/A'}%${localLog}${exifLog}${statsLog} → 표시:${displayScore}% ${verdict}`);

  return {
    score: displayScore, verdict, verdictKo,
    rdScore, hiveScore, aionScore,
    exifScore:     exif ? exifSuspicion : null,
    exifAiTool:    exif?.aiSoftware || null,
    exifHasPrompt: exif?.hasAiPrompt || false,
    exifDetails:   exif?.details || [],
    // 로컬 EfficientNet 모델
    localScore:   localScore,
    localVerdict: localResult?.verdict || null,
    localLoaded:  localResult?.loaded  || false,
    // 이미지 통계 신호
    imgStatsSuspicion: imageStats ? imageStats.suspicionScore : null,
    imgThumbnailMismatch: imageStats ? imageStats.thumbnailMismatch : false,
    imgGanScore:   imageStats ? imageStats.ganFrequencyScore : null,
    imgStatsDetails: imageStats ? imageStats.details : [],
    models:        rd?.models||[],
    deepfakeScore: rd?.deepfakeScore??null,
    aiGenScore:    rd?.aiGenScore??null,
    hiveClasses:   hive?.classes||[],
    aionGenerator: aion?.generator||null,
    aionVerdict:   aion?.verdict||null
  };
}

// ─── 정적 파일 ───────────────────────────────────────────────
function serveStatic(res, fp) {
  const pub = path.resolve(__dirname,'public'), rp = path.resolve(fp);
  if (!rp.startsWith(pub)) { res.writeHead(403); res.end('Forbidden'); return; }
  const mt = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml' };
  fs.readFile(fp,(err,data)=>{
    if(err){res.writeHead(404);res.end('Not Found');return;}
    res.writeHead(200,{'Content-Type':mt[path.extname(fp)]||'text/plain','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN'});
    res.end(data);
  });
}

function jsonRes(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type':'application/json','Content-Length':Buffer.byteLength(b),'X-Content-Type-Options':'nosniff' });
  res.end(b);
}

// ─── 분석 핸들러 ─────────────────────────────────────────────
async function handleAnalyze(req, res) {
  const ip = req.socket.remoteAddress||'unknown';
  if (!checkRL(ip)) return jsonRes(res, 429, { error:'요청이 너무 많습니다.' });

  const cl = parseInt(req.headers['content-length']||'0',10);
  if (cl > MAX_REQ_BYTES) return jsonRes(res, 413, { error:`파일이 너무 큽니다 (최대 ${MAX_FILE_MB}MB).` });

  const chunks=[]; let total=0;
  req.on('data', c=>{ total+=c.length; if(total>MAX_REQ_BYTES){req.destroy();return;} chunks.push(c); });
  req.on('end', async()=>{
    const body = Buffer.concat(chunks);
    const bm = (req.headers['content-type']||'').match(/boundary=(.+)$/);
    if (!bm) return jsonRes(res, 400, { error:'잘못된 요청' });

    const parts = parseMultipart(body, bm[1]);
    const fp = parts.find(p=>(p.name==='image'||p.name==='media')&&p.filename);
    if (!fp) return jsonRes(res, 400, { error:'파일 없음' });

    const { filename, contentType:fileMime, data:fileBuf } = fp;
    const v = validateFile(filename, fileMime, fileBuf);
    if (!v.ok) { console.warn(`[보안] 거부: ${v.reason}`); return jsonRes(res, 400, { error:v.reason }); }

    const isAudio = fileMime.startsWith('audio/')||/\.(mp3|wav|m4a|ogg|aac|flac|weba)$/i.test(filename);
    const isVideo = !isAudio && (fileMime.startsWith('video/')||/\.(mp4|mov|avi|webm)$/i.test(filename));

    // 증거 해시 (블록체인 준비) — SHA-256(파일+이름+타임스탬프)
    const evidenceTimestamp = new Date().toISOString();
    const evidenceHash = computeEvidenceHash(fileBuf, filename, evidenceTimestamp);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[분석 시작] "${filename}" ${(fileBuf.length/1024/1024).toFixed(1)}MB audio=${isAudio} video=${isVideo}`);
    console.log(`[증거 해시] SHA-256: ${evidenceHash}`);
    console.log(`${'═'.repeat(60)}`);

    lastDebug = { rdRaw:null, rdError:null, hiveRaw:null, hiveStatus:null, hiveError:null, aionRaw:null, aionStatus:null, aionError:null };

    try {
      let rd=null, hive=null, aion=null;

      if (isAudio) {
        // ── 음성 딥페이크 분석 경로 ────────────────────────────
        const [hiveRaw, aionRaw] = await Promise.allSettled([
          analyzeAudioWithHive(fileBuf, filename, fileMime),
          analyzeAudioWithAION(fileBuf, filename, fileMime)
        ]);
        hive = hiveRaw.status==='fulfilled' ? hiveRaw.value : null;
        aion = aionRaw.status==='fulfilled' ? aionRaw.value : null;
        if (!hive && !aion) throw new Error('음성 분석 실패 — Hive/AION API 확인 필요');
      } else {
        // ── 이미지/영상 분석 경로 ──────────────────────────────
        const [rdRaw, hiveRaw, aionRaw] = await Promise.allSettled([
          analyzeWithRD(fileBuf, filename, fileMime, isVideo),
          analyzeWithHive(fileBuf, filename, fileMime),
          analyzeWithAION(fileBuf, filename, fileMime)
        ]);
        rd   = rdRaw.status  ==='fulfilled' ? rdRaw.value   : null;
        hive = hiveRaw.status==='fulfilled' ? hiveRaw.value : null;
        aion = aionRaw.status==='fulfilled' ? aionRaw.value : null;
        if (rdRaw.status  ==='rejected') { lastDebug.rdError   = rdRaw.reason?.message; }
        if (hiveRaw.status==='rejected') { lastDebug.hiveError = hiveRaw.reason?.message; }
        if (aionRaw.status==='rejected') { lastDebug.aionError = aionRaw.reason?.message; }
        // API 전부 실패해도 로컬 분석은 계속 진행 (API 오류 나중에 처리)
        const allApiFailed = !rd && !hive && !aion;
        if (allApiFailed) {
          console.log(`[경고] 모든 외부 API 실패 — 로컬 분석만으로 계속 진행`);
        }
      }

      // EXIF/C2PA/이미지통계/로컬모델 (이미지만) — API 실패와 무관하게 항상 실행
      const isImg  = !isVideo && !isAudio;
      const exif        = isImg ? analyzeExifMetadata(fileBuf, fileMime) : null;
      const c2pa        = isImg ? checkC2PA(fileBuf, fileMime) : null;
      const imageStats  = isImg ? analyzeImageStatistics(fileBuf, fileMime) : null;
      const localResult = isImg ? await localModel.analyzeWithLocalModel(fileBuf, fileMime) : null;

      // API + 로컬 분석 모두 아무 결과도 없을 때만 에러
      const hasAnyResult = rd || hive || aion || exif?.suspicionScore > 0 ||
                           imageStats?.suspicionScore > 0 || localResult?.loaded;
      if (!rd && !hive && !aion && !hasAnyResult) {
        throw new Error(`분석 실패\n▸ RD: ${lastDebug.rdError||'결과 없음'}\n▸ Hive: ${lastDebug.hiveError||'결과 없음'}\n▸ AION: ${lastDebug.aionError||'결과 없음'}`);
      }

      if (exif?.details?.length)       console.log(`[EXIF]`,  exif.details.join(' | '));
      if (c2pa?.hasC2PA)               console.log(`[C2PA]`,  c2pa.details.join(' | '));
      if (imageStats?.details?.length) console.log(`[Stats]`, imageStats.details.join(' | '));

      if (isAudio) {
        // ── 음성 전용 응답 ──────────────────────────────────
        const hiveAudioScore = hive ? Math.round((hive.score||0) * 100) : null;
        const aionAudioScore = aion ? Math.round((aion.score||0) * 100) : null;
        const scores = [hiveAudioScore, aionAudioScore].filter(s => s !== null);
        const audioScore = scores.length > 0 ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
        const audioVerdict = audioScore >= 40 ? (audioScore >= 70 ? 'FAKE' : 'UNCERTAIN') : 'REAL';
        const verdictKoMap = { FAKE:'음성 딥페이크 의심', UNCERTAIN:'판별 불확실', REAL:'진짜 음성으로 보임' };
        jsonRes(res, 200, {
          success:true, isVideo:false, isAudio:true,
          evidenceHash, evidenceTimestamp,
          score:audioScore, verdict:audioVerdict, verdictKo:verdictKoMap[audioVerdict],
          hiveAudioScore, aionAudioScore,
          rdScore:null, hiveScore:null, aionScore:null,
          models:[], deepfakeScore:null, aiGenScore:null,
          c2paStatus:null, c2paHasCredentials:false, c2paSynthId:false, c2paDetails:[],
          exifScore:null, exifAiTool:null, exifHasPrompt:false, exifDetails:[],
          imgStatsSuspicion:null, imgThumbnailMismatch:false, imgGanScore:null, imgStatsDetails:[],
        });
      } else {
        const merged = mergeResults(rd, hive, aion, exif, imageStats, localResult);
        jsonRes(res, 200, {
          success:true, isVideo, isAudio:false,
          evidenceHash, evidenceTimestamp,
          score:merged.score, verdict:merged.verdict, verdictKo:merged.verdictKo,
          rdScore:merged.rdScore, hiveScore:merged.hiveScore, aionScore:merged.aionScore,
          localScore:merged.localScore, localVerdict:merged.localVerdict, localLoaded:merged.localLoaded,
          exifScore:merged.exifScore, exifAiTool:merged.exifAiTool,
          exifHasPrompt:merged.exifHasPrompt, exifDetails:merged.exifDetails,
          imgStatsSuspicion:merged.imgStatsSuspicion, imgThumbnailMismatch:merged.imgThumbnailMismatch,
          imgGanScore:merged.imgGanScore, imgStatsDetails:merged.imgStatsDetails,
          c2paStatus: c2pa?.c2paStatus||null, c2paHasCredentials: c2pa?.hasC2PA||false,
          c2paSynthId: c2pa?.hasSynthId||false, c2paDetails: c2pa?.details||[],
          models:merged.models, deepfakeScore:merged.deepfakeScore, aiGenScore:merged.aiGenScore,
          hiveClasses:merged.hiveClasses,
          aionGenerator:merged.aionGenerator, aionVerdict:merged.aionVerdict,
          hiveAudioScore:null, aionAudioScore:null,
          _debug:{ rdModels:rd?.models, hiveClasses:hive?.classes, aionReport:aion?.rawReport }
        });
      }
    } catch(e) {
      console.error('[오류]', e.message);
      jsonRes(res, 500, { error:e.message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 유출 탐색 — Bing Visual Search + 의심 도메인 분류
// ═══════════════════════════════════════════════════════════════

// 의심 도메인 패턴 (무료, 외부 API 불필요)
const SUSPICIOUS_PATTERNS = [
  // 딥페이크/성인 전문 사이트 패턴
  'deepfake','deep-fake','deepnude','mrdeepfakes',
  'faceswap','face-swap','nudify','undress',
  // 성인 콘텐츠 TLD/도메인 패턴
  'pornhub','xvideos','xhamster','redtube','youporn',
  'spankbang','xnxx','tnaflix','tube8','drtuber',
  'camwhores','nudogram','reddxxx',
  // 불법 공유 사이트 패턴
  'leaksnude','nude-leak','leaked','celeb-jihad',
  'icloud-leak','fappening','thefappening',
  // 한국 관련 불법 사이트 패턴
  'soranet','n번방','godgirls','tumblnbi',
  'ilbe','exploited','molka','spycam'
];

// 한국 SNS 프로필 이미지 URL 추출 시도
function extractProfileImageUrl(input) {
  if (!input) return null;
  const t = input.trim();
  // 이미 이미지 URL이면 그대로
  if (/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(t)) return t;
  // 인스타그램 프로필
  if (t.includes('instagram.com/')) {
    const m = t.match(/instagram\.com\/([^/?#]+)/);
    if (m) return { platform: 'instagram', username: m[1] };
  }
  // 트위터/X 프로필
  if (t.includes('twitter.com/') || t.includes('x.com/')) {
    const m = t.match(/(?:twitter|x)\.com\/([^/?#]+)/);
    if (m) return { platform: 'twitter', username: m[1] };
  }
  return null;
}

function classifyUrl(rawUrl) {
  if (!rawUrl) return 'unknown';
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    const full = rawUrl.toLowerCase();
    for (const pat of SUSPICIOUS_PATTERNS) {
      if (hostname.includes(pat) || full.includes(pat)) return 'suspicious';
    }
    // 주요 정상 플랫폼
    const safe = ['google.','bing.','instagram.','twitter.','x.com','youtube.',
                  'tiktok.','naver.','kakao.','facebook.','wikipedia.','news.'];
    if (safe.some(s => hostname.includes(s))) return 'safe';
    return 'unknown';
  } catch { return 'unknown'; }
}

// Bing Visual Search API — 이미지 바이트로 직접 검색 (무료 1,000회/월)
async function searchWithBing(imageBuf, filename, mime) {
  if (!BING_KEY) return null;
  const boundary = 'UnveilVS' + Date.now().toString(36);
  const knReq = JSON.stringify({ imageInfo: {}, knowledgeRequest: { invokedSkills: ['SimilarImages','RelatedSearches'] } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="knowledgeRequest"\r\n\r\n${knReq}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    imageBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  try {
    const res = await httpsReq({
      hostname: BING_HOST,
      path: '/bing/v7.0/images/visualsearch',
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': BING_KEY,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
    console.log(`[Bing/VS] HTTP ${res.status}`);
    if (res.status !== 200) return null;
    const data = res.data;
    const hits = [];
    if (Array.isArray(data.tags)) {
      for (const tag of data.tags) {
        for (const action of (tag.actions || [])) {
          if (action.actionType === 'PagesIncluding' && action.data?.value) {
            for (const item of action.data.value.slice(0, 20)) {
              hits.push({
                type: 'page',
                title: item.name || '',
                pageUrl: item.hostPageUrl || item.contentUrl || '',
                imageUrl: item.contentUrl || '',
                thumbnailUrl: item.thumbnailUrl || '',
              });
            }
          }
          if (action.actionType === 'VisualSearch' && action.data?.value) {
            for (const item of action.data.value.slice(0, 15)) {
              hits.push({
                type: 'image',
                title: item.name || '',
                pageUrl: item.hostPageUrl || '',
                imageUrl: item.contentUrl || '',
                thumbnailUrl: item.thumbnailUrl || '',
              });
            }
          }
        }
      }
    }
    return hits;
  } catch(e) { console.warn('[Bing/VS] 오류:', e.message); return null; }
}

// 유출 탐색 핸들러
async function handleReverseSearch(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '로그인 필요' });

  const { contentType, fileBuf, filename, fileMime } = await parseMultipart(req);
  if (!fileBuf || fileBuf.length === 0) return jsonRes(res, 400, { ok: false, error: '파일 없음' });
  if (!fileMime.startsWith('image/')) return jsonRes(res, 400, { ok: false, error: '이미지 파일만 지원합니다' });
  if (fileBuf.length > 4 * 1024 * 1024) return jsonRes(res, 400, { ok: false, error: '이미지 4MB 이하로 업로드해주세요' });

  console.log(`[유출탐색] "${filename}" ${(fileBuf.length/1024).toFixed(0)}KB — userId=${user.id}`);

  // Bing Visual Search 시도
  const bingHits = await searchWithBing(fileBuf, filename, fileMime);

  // 결과 분류
  const results = (bingHits || []).map(h => ({
    ...h,
    risk: classifyUrl(h.pageUrl || h.imageUrl)
  }));

  const suspicious = results.filter(r => r.risk === 'suspicious');
  const unknown    = results.filter(r => r.risk === 'unknown');
  const safe       = results.filter(r => r.risk === 'safe');

  const hasBing = !!BING_KEY;
  const totalFound = results.length;
  const riskLevel = suspicious.length > 0 ? 'HIGH'
                  : unknown.length > 3    ? 'MEDIUM'
                  : totalFound === 0      ? 'NONE'
                  : 'LOW';

  // 이미지 SHA-256 핑거프린트
  const fingerprint = crypto.createHash('sha256').update(fileBuf).digest('hex');

  jsonRes(res, 200, {
    ok: true,
    hasBingSearch: hasBing,
    fingerprint,
    totalFound,
    riskLevel,
    suspicious,
    unknown,
    safe,
    // Bing 없을 때 수동 검색 링크 (브라우저에서 직접 활용)
    manualLinks: {
      google: 'https://images.google.com/',
      yandex: 'https://yandex.com/images/',
      tineye: 'https://tineye.com/',
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// URL 분석 API  — /api/analyze-url
// ═══════════════════════════════════════════════════════════════
// SSRF 방어: 사설 IP 차단
function isPrivateIp(hostname) {
  if (hostname === 'localhost') return true;
  const parts = hostname.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  return false;
}

function fetchUrl(rawUrl, maxBytes = 20 * 1024 * 1024, redirects = 3) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error('URL 형식 오류')); }
    if (!['http:', 'https:'].includes(parsed.protocol))
      return reject(new Error('http/https URL만 지원합니다'));
    if (isPrivateIp(parsed.hostname))
      return reject(new Error('내부 네트워크 URL은 사용 불가합니다'));

    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(rawUrl, { timeout: 15000 }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        return fetchUrl(res.headers.location, maxBytes, redirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200)
        return reject(new Error(`URL 응답 오류: HTTP ${res.statusCode}`));

      const ct = (res.headers['content-type'] || '').split(';')[0].trim();
      const chunks = []; let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > maxBytes) { req.destroy(); return reject(new Error('이미지가 너무 큽니다 (최대 20MB)')); }
        chunks.push(c);
      });
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), ct }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('URL 요청 시간 초과 (15초)')); });
    req.on('error', e => reject(new Error('URL 요청 실패: ' + e.message)));
    req.end();
  });
}

// MIME → 확장자
const MIME_TO_EXT = {
  'image/jpeg':'jpg','image/jpg':'jpg','image/png':'png',
  'image/webp':'webp','image/gif':'gif'
};

async function handleAnalyzeUrl(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!checkRL(ip)) return jsonRes(res, 429, { error:'요청이 너무 많습니다.' });
  try {
    const body = await readJsonBody(req);
    const rawUrl = (body.url || '').trim();
    if (!rawUrl) return jsonRes(res, 400, { error: 'url 파라미터 없음' });

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[URL 분석] ${rawUrl.slice(0, 120)}`);

    let buf, ct;
    try {
      ({ buf, ct } = await fetchUrl(rawUrl));
    } catch(e) {
      return jsonRes(res, 400, { error: e.message });
    }

    // MIME 결정 (Content-Type 우선, 실패 시 URL 확장자)
    let mime = ct;
    if (!ALLOWED_MIME.has(mime)) {
      const extM = rawUrl.split('?')[0].match(/\.(jpe?g|png|webp|gif|mp4|mov|avi|webm)$/i);
      if (extM) {
        const extMap = { jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',
          webp:'image/webp',gif:'image/gif',mp4:'video/mp4',
          mov:'video/quicktime',avi:'video/x-msvideo',webm:'video/webm' };
        mime = extMap[extM[1].toLowerCase()] || mime;
      }
    }
    const ext = MIME_TO_EXT[mime] || 'jpg';
    const filename = 'url_image.' + ext;
    const v = validateFile(filename, mime, buf);
    if (!v.ok) return jsonRes(res, 400, { error: v.reason });

    const isVideo = mime.startsWith('video/');
    console.log(`[URL 분석] MIME: ${mime}  크기: ${(buf.length/1024).toFixed(0)}KB`);
    console.log(`${'═'.repeat(60)}`);

    lastDebug = { rdRaw:null, rdError:null, hiveRaw:null, hiveStatus:null, hiveError:null, aionRaw:null, aionStatus:null, aionError:null };

    const [rdRaw, hiveRaw, aionRaw] = await Promise.allSettled([
      analyzeWithRD(buf, filename, mime, isVideo),
      analyzeWithHive(buf, filename, mime),
      analyzeWithAION(buf, filename, mime)
    ]);
    const rd   = rdRaw.status  === 'fulfilled' ? rdRaw.value   : null;
    const hive = hiveRaw.status === 'fulfilled' ? hiveRaw.value : null;
    const aion = aionRaw.status === 'fulfilled' ? aionRaw.value : null;
    if (rdRaw.status  === 'rejected') lastDebug.rdError   = rdRaw.reason?.message;
    if (hiveRaw.status === 'rejected') lastDebug.hiveError = hiveRaw.reason?.message;
    if (aionRaw.status === 'rejected') lastDebug.aionError = aionRaw.reason?.message;
    if (!rd && !hive && !aion)
      throw new Error('모든 API 분석 실패 — API 키 및 네트워크 확인');

    const exif        = !isVideo ? analyzeExifMetadata(buf, mime) : null;
    const imageStats  = !isVideo ? analyzeImageStatistics(buf, mime) : null;
    const localResult = !isVideo ? await localModel.analyzeWithLocalModel(buf, mime) : null;
    if (exif?.details?.length)       console.log(`[EXIF]`,  exif.details.join(' | '));
    if (imageStats?.details?.length) console.log(`[Stats]`, imageStats.details.join(' | '));

    const merged = mergeResults(rd, hive, aion, exif, imageStats, localResult);
    jsonRes(res, 200, {
      success:true, isVideo, sourceUrl: rawUrl,
      score:merged.score, verdict:merged.verdict, verdictKo:merged.verdictKo,
      rdScore:merged.rdScore, hiveScore:merged.hiveScore, aionScore:merged.aionScore,
      localScore:merged.localScore, localVerdict:merged.localVerdict, localLoaded:merged.localLoaded,
      exifScore:merged.exifScore, exifAiTool:merged.exifAiTool,
      exifHasPrompt:merged.exifHasPrompt, exifDetails:merged.exifDetails,
      imgStatsSuspicion:merged.imgStatsSuspicion, imgThumbnailMismatch:merged.imgThumbnailMismatch,
      imgGanScore:merged.imgGanScore, imgStatsDetails:merged.imgStatsDetails,
      models:merged.models, deepfakeScore:merged.deepfakeScore, aiGenScore:merged.aiGenScore,
      hiveClasses:merged.hiveClasses,
      aionGenerator:merged.aionGenerator, aionVerdict:merged.aionVerdict,
      _debug:{ rdModels:rd?.models, hiveClasses:hive?.classes, aionReport:aion?.rawReport }
    });
  } catch(e) {
    console.error('[URL 분석 오류]', e.message);
    jsonRes(res, 500, { error: e.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// 탐지 결과 저장 API  — /api/detection/save
// ═══════════════════════════════════════════════════════════════
async function handleDetectionSave(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  try {
    const body = await readJsonBody(req);
    const { verdict, score, rdScore, hiveScore, aionScore, filename, sourceUrl, isVideo } = body;
    if (!verdict) return jsonRes(res, 400, { ok: false, error: '필수 필드 없음' });

    const detId = crypto.randomBytes(6).toString('hex');
    const det = {
      id: detId,
      userId: user.id,
      source: 'direct',
      filename: filename || '직접업로드',
      sourceUrl: sourceUrl || null,
      isVideo: !!isVideo,
      verdict, score: score || 0,
      rdScore: rdScore ?? null,
      hiveScore: hiveScore ?? null,
      aionScore: aionScore ?? null,
      timestamp: new Date().toISOString()
    };
    const detections = db.getDetections();
    detections.unshift(det);
    // 사용자당 최대 200건 보관
    const filtered = detections.filter(d => d.userId === user.id);
    if (filtered.length > 200) {
      const oldest = filtered[filtered.length - 1].id;
      const idx = detections.findIndex(d => d.id === oldest);
      if (idx > -1) detections.splice(idx, 1);
    }
    db.saveDetections(detections);
    jsonRes(res, 201, { ok: true, id: detId });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

// ═══════════════════════════════════════════════════════════════
// JSON 바디 파서 (인증/대시보드 API용)
// ═══════════════════════════════════════════════════════════════
function readJsonBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', c => { total += c.length; if (total > maxBytes) reject(new Error('바디 너무 큼')); else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(new Error('JSON 파싱 오류')); } });
    req.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════
// 인증 API 핸들러
// ═══════════════════════════════════════════════════════════════
async function handleAuthRegister(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = auth.register(body);
    if (!result.ok) return jsonRes(res, 400, result);
    // 얼굴 descriptor가 있으면 저장
    if (body.faceDescriptor && Array.isArray(body.faceDescriptor)) {
      const users = db.getUsers();
      if (users[result.userId]) {
        users[result.userId].faceDescriptor = body.faceDescriptor;
        db.saveUsers(users);
      }
    }
    jsonRes(res, 201, { ok: true, message: '회원가입 완료', userId: result.userId });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

async function handleAuthLogin(req, res) {
  try {
    const body   = await readJsonBody(req);
    const result = auth.login(body);
    if (!result.ok) return jsonRes(res, 401, result);
    // 쿠키 설정 (httpOnly)
    res.setHeader('Set-Cookie', `unveil_session=${result.token}; Path=/; HttpOnly; Max-Age=${7*24*3600}; SameSite=Strict`);
    jsonRes(res, 200, { ok: true, token: result.token, user: result.user });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

function handleAuthLogout(req, res) {
  const token = auth.getToken(req);
  if (token) auth.logout(token);
  res.setHeader('Set-Cookie', 'unveil_session=; Path=/; Max-Age=0');
  jsonRes(res, 200, { ok: true });
}

function handleAuthMe(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  jsonRes(res, 200, { ok: true, user: auth.safeUser(user) });
}

// ═══════════════════════════════════════════════════════════════
// 얼굴 API 핸들러
// ═══════════════════════════════════════════════════════════════
async function handleFaceRegister(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  try {
    const body = await readJsonBody(req);
    if (!body.descriptor || !Array.isArray(body.descriptor))
      return jsonRes(res, 400, { ok: false, error: 'descriptor 없음' });
    const users = db.getUsers();
    users[user.id].faceDescriptor = body.descriptor;
    db.saveUsers(users);
    jsonRes(res, 200, { ok: true, message: '얼굴 등록 완료' });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

function handleFaceDescriptor(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  jsonRes(res, 200, { ok: true, descriptor: user.faceDescriptor || null });
}

// ═══════════════════════════════════════════════════════════════
// 대시보드 API 핸들러
// ═══════════════════════════════════════════════════════════════
function handleDashboardDetections(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  // 내 탐지 결과만 반환 (userId 일치 또는 userId 없는 기존 전체 탐지)
  const all = db.getDetections();
  const detections = all.filter(d => !d.userId || d.userId === user.id);
  jsonRes(res, 200, { ok: true, detections });
}

// ═══════════════════════════════════════════════════════════════
// 텔레그램 연동 API
// ═══════════════════════════════════════════════════════════════
async function handleUserTelegram(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  try {
    const body = await readJsonBody(req);
    if (!body.chatId) return jsonRes(res, 400, { ok: false, error: 'chatId 없음' });
    const users = db.getUsers();
    users[user.id].telegramChatId = String(body.chatId).trim();
    db.saveUsers(users);
    jsonRes(res, 200, { ok: true, message: '텔레그램 연동 완료' });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

// ── 이메일 알림 주소 저장 ──────────────────────────────────────
async function handleNotifyEmail(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  try {
    const body = await readJsonBody(req);
    const email = (body.email || '').trim();
    if (!email) return jsonRes(res, 400, { ok: false, error: '이메일을 입력해주세요' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return jsonRes(res, 400, { ok: false, error: '이메일 형식이 올바르지 않습니다' });
    const users = db.getUsers();
    users[user.id].notifyEmail = email;
    db.saveUsers(users);
    jsonRes(res, 200, { ok: true, message: '이메일 저장 완료' });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

// ── 알림 설정 저장 (자동 신고서 초안 등) ───────────────────────
async function handleNotifySettings(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  try {
    const body = await readJsonBody(req);
    const users = db.getUsers();
    if (typeof body.autoReport === 'boolean') users[user.id].autoReport = body.autoReport;
    db.saveUsers(users);
    jsonRes(res, 200, { ok: true, message: '알림 설정 저장 완료' });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

// ── 텔레그램 봇 토큰 .env 저장 ────────────────────────────────
async function handleSaveBotToken(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  try {
    const body     = await readJsonBody(req);
    const botToken = (body.botToken || '').trim();
    if (!botToken) return jsonRes(res, 400, { ok: false, error: '봇 토큰을 입력해주세요' });
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(botToken))
      return jsonRes(res, 400, { ok: false, error: '봇 토큰 형식 오류 (123456:ABCdef... 형태여야 합니다)' });

    const envPath = path.join(__dirname, '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (/^TELEGRAM_BOT_TOKEN=/m.test(envContent)) {
      envContent = envContent.replace(/^TELEGRAM_BOT_TOKEN=.*$/m, `TELEGRAM_BOT_TOKEN=${botToken}`);
    } else {
      envContent += `\nTELEGRAM_BOT_TOKEN=${botToken}`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env.TELEGRAM_BOT_TOKEN = botToken;
    console.log(`[설정] TELEGRAM_BOT_TOKEN 업데이트 완료`);
    jsonRes(res, 200, { ok: true, message: '봇 토큰이 저장되었습니다.' });
  } catch(e) { jsonRes(res, 500, { ok: false, error: e.message }); }
}

// ── 모니터링 중인 채널 목록 ────────────────────────────────────
async function handleMonitorChannels(req, res) {
  const token = auth.getToken(req);
  const user  = auth.validate(token);
  if (!user) return jsonRes(res, 401, { ok: false, error: '인증 필요' });
  try {
    // monitor.js가 기록한 채널 목록을 data/channels.json에서 읽음
    const channelFile = path.join(db.DATA_DIR, 'channels.json');
    let channels = [];
    if (fs.existsSync(channelFile)) {
      try { channels = JSON.parse(fs.readFileSync(channelFile, 'utf8')); } catch {}
    }
    jsonRes(res, 200, { ok: true, channels });
  } catch(e) { jsonRes(res, 500, { ok: false, error: e.message }); }
}

// ═══════════════════════════════════════════════════════════════
// 내부 API — monitor.js가 탐지 결과를 저장하는 엔드포인트
// (INTERNAL_SECRET으로 보호)
// ═══════════════════════════════════════════════════════════════
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || crypto.randomBytes(16).toString('hex');
console.log(`[내부 API] INTERNAL_SECRET: ${INTERNAL_SECRET} (monitor.js용)`);

// ── 얼굴 유사도 비교 (유클리디안 거리, threshold 기본 0.55) ──────
function euclideanDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}
function isFaceMatch(desc1, desc2, threshold = 0.55) {
  return euclideanDistance(desc1, desc2) < threshold;
}

async function handleInternalDetection(req, res) {
  const secret = req.headers['x-internal-secret'];
  if (secret !== INTERNAL_SECRET)
    return jsonRes(res, 403, { ok: false, error: '내부 전용 API' });
  try {
    const body  = await readJsonBody(req, 10 * 1024 * 1024); // 이미지 포함 최대 10MB
    const detId = crypto.randomBytes(6).toString('hex');

    // 이미지 저장 (있을 경우)
    let hasImage = false;
    if (body.imageB64) {
      try {
        const imgDir = path.join(db.DATA_DIR, 'images');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        const imgBuf = Buffer.from(body.imageB64, 'base64');
        if (imgBuf.length < 10 * 1024 * 1024) { // 10MB 초과 방지
          fs.writeFileSync(path.join(imgDir, `${detId}.jpg`), imgBuf);
          hasImage = true;
        }
      } catch(e) { console.warn('[서버] 이미지 저장 실패:', e.message); }
    }

    const det = db.addDetection({
      id:           detId,
      timestamp:    body.timestamp    || new Date().toISOString(),
      source:       body.source       || 'telegram',
      chatTitle:    body.chatTitle    || null,
      senderName:   body.senderName   || null,
      filename:     body.filename     || null,
      verdict:      body.verdict      || 'UNKNOWN',
      score:        body.score        || 0,
      rdScore:      body.rdScore      ?? null,
      hiveScore:    body.hiveScore    ?? null,
      aionScore:    body.aionScore    ?? null,
      aionGenerator:body.aionGenerator || null,
      msgLink:      body.msgLink      || null,
      hasImage,
    });

    // ── 얼굴 매칭: 이미지 descriptor가 제공된 경우 일치 사용자만 알림 ──
    // monitor.js가 얼굴 descriptor를 함께 전송하면 해당 사용자만 alertList에 포함
    // 없으면 telegramChatId 등록 사용자 전체 (fallback)
    const users = db.getUsers();
    const detectedDescriptors = body.faceDescriptors || []; // Array of Float32Array-like arrays

    let alertList;
    if (detectedDescriptors.length > 0) {
      // 얼굴 매칭 모드: 내 얼굴이 있는 사람에게만 알림
      alertList = Object.values(users)
        .filter(u => {
          if (!u.telegramChatId || !u.faceDescriptor) return false;
          return detectedDescriptors.some(d => isFaceMatch(d, u.faceDescriptor));
        })
        .map(u => ({ chatId: u.telegramChatId, username: u.username, faceMatched: true }));
    } else {
      // fallback: 모든 등록 사용자에게 알림 (descriptor 없을 때)
      alertList = Object.values(users)
        .filter(u => u.telegramChatId)
        .map(u => ({ chatId: u.telegramChatId, username: u.username, faceMatched: false }));
    }

    jsonRes(res, 201, { ok: true, id: det.id, alertList });
  } catch(e) { jsonRes(res, 400, { ok: false, error: e.message }); }
}

// 탐지 이미지 서빙 엔드포인트
function handleDetectionImage(req, res, detId) {
  const imgPath = path.join(db.DATA_DIR, 'images', `${detId}.jpg`);
  if (!fs.existsSync(imgPath)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', 'image/jpeg');
  fs.createReadStream(imgPath).pipe(res);
}

// monitor.js가 INTERNAL_SECRET을 읽을 수 있도록 엔드포인트 제공
function handleInternalSecret(req, res) {
  // 로컬호스트에서만 허용
  const ip = req.socket.remoteAddress || '';
  if (ip !== '::1' && ip !== '127.0.0.1' && !ip.includes('::ffff:127.'))
    return jsonRes(res, 403, { ok: false, error: '로컬호스트 전용' });
  jsonRes(res, 200, { secret: INTERNAL_SECRET });
}

// ─── HTTP 서버 ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', `http://localhost:${PORT}`);

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Secret');
    res.writeHead(204); res.end(); return;
  }

  const p = url.parse(req.url);

  // ── 분석 API ─────────────────────────────────────────────
  if (req.method==='POST' && p.pathname==='/api/analyze')        return handleAnalyze(req, res);
  if (req.method==='POST' && p.pathname==='/api/analyze-url')    return handleAnalyzeUrl(req, res);
  if (req.method==='POST' && p.pathname==='/api/search/reverse') return handleReverseSearch(req, res);
  if (req.method==='POST' && p.pathname==='/api/detection/save') return handleDetectionSave(req, res);

  if (req.method==='GET' && p.pathname==='/api/debug') {
    return jsonRes(res, 200, {
      message:        '마지막 분석의 raw API 응답',
      rdError:        lastDebug.rdError,
      rdRaw:          lastDebug.rdRaw    ? JSON.stringify(lastDebug.rdRaw).slice(0,2000) : null,
      hiveHttpStatus: lastDebug.hiveStatus,
      hiveError:      lastDebug.hiveError,
      hiveRaw:        lastDebug.hiveRaw  ? lastDebug.hiveRaw.slice(0,2000) : null,
      aionHttpStatus: lastDebug.aionStatus,
      aionError:      lastDebug.aionError,
      aionRaw:        lastDebug.aionRaw  ? lastDebug.aionRaw.slice(0,2000) : null,
    });
  }

  // ── 인증 API ────────────────────────────────────────────
  if (req.method==='POST' && p.pathname==='/api/auth/register') return handleAuthRegister(req, res);
  if (req.method==='POST' && p.pathname==='/api/auth/login')    return handleAuthLogin(req, res);
  if (req.method==='POST' && p.pathname==='/api/auth/logout')   return handleAuthLogout(req, res);
  if (req.method==='GET'  && p.pathname==='/api/auth/me')       return handleAuthMe(req, res);

  // ── 얼굴 API ────────────────────────────────────────────
  if (req.method==='POST' && p.pathname==='/api/face/register')   return handleFaceRegister(req, res);
  if (req.method==='GET'  && p.pathname==='/api/face/descriptor') return handleFaceDescriptor(req, res);

  // ── 대시보드 / 모니터링 API ──────────────────────────────
  if (req.method==='GET'  && p.pathname==='/api/dashboard/detections') return handleDashboardDetections(req, res);
  if (req.method==='POST' && p.pathname==='/api/user/telegram')        return handleUserTelegram(req, res);
  if (req.method==='POST' && p.pathname==='/api/user/notify-email')    return handleNotifyEmail(req, res);
  if (req.method==='POST' && p.pathname==='/api/user/notify-settings') return handleNotifySettings(req, res);
  if (req.method==='GET'  && p.pathname==='/api/monitor/channels')     return handleMonitorChannels(req, res);
  if (req.method==='POST' && p.pathname==='/api/settings/bot-token')   return handleSaveBotToken(req, res);

  // ── 탐지 이미지 ─────────────────────────────────────────
  const imgMatch = p.pathname.match(/^\/api\/detection\/([a-f0-9]{12})\/image$/);
  if (req.method==='GET' && imgMatch) return handleDetectionImage(req, res, imgMatch[1]);

  // ── 내부 API (monitor.js용) ──────────────────────────────
  if (req.method==='POST' && p.pathname==='/api/internal/detection') return handleInternalDetection(req, res);
  if (req.method==='GET'  && p.pathname==='/api/internal/secret')    return handleInternalSecret(req, res);

  // ── 정적 파일 ────────────────────────────────────────────
  const fp = p.pathname==='/'||p.pathname===''
    ? path.join(__dirname,'public','index.html')
    : path.join(__dirname,'public',p.pathname);
  serveStatic(res, fp);
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🛡️  Unveil - 딥페이크 탐지 시스템 v3');
  console.log(`  ▶  서비스:   http://localhost:${PORT}`);
  console.log(`  🔬 디버그:   http://localhost:${PORT}/api/debug`);
  console.log(`  📡 RD:       ✅ 활성`);
  console.log(`  📡 Hive:     ${HIVE_API_KEY ? '✅ 활성' : '❌ 비활성 (키 없음)'}`);
  console.log(`  📡 AI or Not:${AION_API_KEY ? ' ✅ 활성' : ' ❌ 비활성 (키 없음)'}`);
  console.log(`  🔍 유출탐색: ${BING_KEY     ? '✅ Bing 자동검색 활성' : '⚠️  수동검색 모드 (BING_SEARCH_KEY 없음)'}`);

  // 로컬 모델 초기화 (비동기, 없으면 자동 스킵)
  await localModel.initModel();
  const lm = localModel.getModelStatus();
  if (lm.ready) {
    const acc = lm.metadata ? ` (정확도 ${(lm.metadata.valAccuracy*100).toFixed(1)}%)` : '';
    console.log(`  🤖 로컬 모델: ✅ EfficientNetB4${acc}`);
    console.log(`  🎯 가중치:   RD 35% + Hive 30% + AION 20% + Local 15%`);
  } else {
    console.log(`  🤖 로컬 모델: ⚪ 미설치 (train_deepfake_detector.py로 훈련 후 model/ 배치)`);
    console.log(`  🎯 가중치:   RD 40% + Hive 35% + AION 25%`);
  }
  console.log(`  🎯 FAKE≥${FAKE_THRESHOLD}%  UNCERTAIN≥${UNCERTAIN_THRESHOLD}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
