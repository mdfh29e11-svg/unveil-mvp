/**
 * ═══════════════════════════════════════════════════════════════
 *  Unveil Protocol — XRPL API Routes
 *  server.js에 아래 코드를 추가하세요.
 * ═══════════════════════════════════════════════════════════════
 *
 *  STEP 1: server.js 상단 require 섹션에 추가:
 *    const xrpl = require('./unveil-xrpl');
 *
 *  STEP 2: 이 파일의 라우트 코드를 server.js 라우트 섹션에 붙여넣기
 *
 *  STEP 3: Render 환경변수 추가:
 *    XRPL_SEED   = (테스트넷 지갑 시드, 없으면 매번 새 지갑 생성)
 *    XRPL_MAINNET = 1  (메인넷 사용 시, 기본값은 testnet)
 * ═══════════════════════════════════════════════════════════════
 */

// ─── server.js 상단에 추가 ───────────────────────────────────────────────────
// const xrplModule = require('./unveil-xrpl');
// ────────────────────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// [GET] /api/xrpl/wallet
// 서비스 지갑 주소 조회 (사용자에게 "이 주소로 XRP를 보내세요" 표시)
// ══════════════════════════════════════════════════════════════════════════════
/*
app.get('/api/xrpl/wallet', async (req, res) => {
  try {
    const useMainnet = process.env.XRPL_MAINNET === '1';
    const info = await xrplModule.getServiceWalletInfo(useMainnet);
    res.json({ success: true, ...info });
  } catch (err) {
    console.error('[XRPL wallet]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
*/


// ══════════════════════════════════════════════════════════════════════════════
// [POST] /api/xrpl/mint
// 검증 완료 후 Evidence NFT 발행
//
// Body:
//   fileHash        {string}  - 파일 SHA-256 해시
//   verdict         {string}  - "PASS" | "FAIL"
//   confidence      {number}  - 신뢰도 (0~1)
//   c2paResult      {string}  - C2PA 결과 (선택)
//   recipientAddress {string} - NFT 받을 사용자 지갑 (선택)
// ══════════════════════════════════════════════════════════════════════════════
/*
app.post('/api/xrpl/mint', async (req, res) => {
  const { fileHash, verdict, confidence, c2paResult, recipientAddress } = req.body;

  if (!fileHash || !verdict || confidence === undefined) {
    return res.status(400).json({
      success: false,
      error: 'fileHash, verdict, confidence 필드가 필요합니다.',
    });
  }

  if (!['PASS', 'FAIL'].includes(verdict)) {
    return res.status(400).json({
      success: false,
      error: 'verdict는 "PASS" 또는 "FAIL"이어야 합니다.',
    });
  }

  try {
    const useMainnet = process.env.XRPL_MAINNET === '1';
    const result = await xrplModule.mintEvidenceNFT({
      fileHash,
      verdict,
      confidence,
      c2paResult:       c2paResult || 'not-checked',
      recipientAddress: recipientAddress || undefined,
      useMainnet,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[XRPL mint]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
*/


// ══════════════════════════════════════════════════════════════════════════════
// [POST] /api/xrpl/verify-trigger
// NFT 판정 결과로 결제 실행 여부 결정 (PASS → 허용, FAIL → 차단)
//
// Body:
//   verdict   {string}  - "PASS" | "FAIL"
//   txHash    {string}  - NFT 발행 트랜잭션 해시 (온체인 검증 선택)
// ══════════════════════════════════════════════════════════════════════════════
/*
app.post('/api/xrpl/verify-trigger', async (req, res) => {
  const { verdict, txHash } = req.body;

  if (!verdict && !txHash) {
    return res.status(400).json({
      success: false,
      error: 'verdict 또는 txHash가 필요합니다.',
    });
  }

  try {
    let finalVerdict = verdict;

    // txHash가 있으면 XRPL 온체인에서 실제 verdict 조회 (더 신뢰성 높음)
    if (txHash) {
      const useMainnet  = process.env.XRPL_MAINNET === '1';
      const memoData    = await xrplModule.fetchNFTVerdict(txHash, useMainnet);
      if (memoData?.verdict) finalVerdict = memoData.verdict;
    }

    const decision = xrplModule.evaluatePaymentTrigger(finalVerdict);

    res.status(decision.http).json({
      success:  decision.decision === 'ALLOW',
      decision: decision.decision,
      action:   decision.action,
      message:  decision.message,
      verdict:  finalVerdict,
    });
  } catch (err) {
    console.error('[XRPL trigger]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
*/


// ══════════════════════════════════════════════════════════════════════════════
// [POST] /api/xrpl/compliance/freeze
// UNVEIL 토큰 트러스트라인 동결 (관리자 전용)
// ══════════════════════════════════════════════════════════════════════════════
/*
app.post('/api/xrpl/compliance/freeze', async (req, res) => {
  // 관리자 인증 (예시: 환경변수 ADMIN_KEY 비교)
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: '관리자 인증 필요' });
  }

  const { userAddress, currency = 'UNVEIL' } = req.body;
  if (!userAddress) {
    return res.status(400).json({ success: false, error: 'userAddress 필요' });
  }

  try {
    const useMainnet = process.env.XRPL_MAINNET === '1';
    const result = await xrplModule.freezeUserTrustline({ userAddress, currency, useMainnet });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[XRPL freeze]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
*/


// ══════════════════════════════════════════════════════════════════════════════
// [POST] /api/xrpl/compliance/burn-nft
// 결함 AI 모델로 발급된 NFT 소각 (관리자 전용)
// ══════════════════════════════════════════════════════════════════════════════
/*
app.post('/api/xrpl/compliance/burn-nft', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: '관리자 인증 필요' });
  }

  const { nftId, ownerAddress } = req.body;
  if (!nftId) {
    return res.status(400).json({ success: false, error: 'nftId 필요' });
  }

  try {
    const useMainnet = process.env.XRPL_MAINNET === '1';
    const result = await xrplModule.burnInvalidNFT({ nftId, ownerAddress, useMainnet });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[XRPL burn]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
*/
