/**
 * ═══════════════════════════════════════════════════════════════
 *  Unveil Protocol — XRPL Integration Module
 *  "Pre-Chain Verification Layer on XRPL"
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. NFT Minting (XLS-20)     — "Evidence as Financial Asset"
 *  2. Payment Flow             — XRP / RLUSD execution layer
 *  3. Payment Trigger Logic    — PASS / FAIL decision gate
 *  4. Wallet Flow              — User wallet ↔ Unveil wallet
 *  5. Compliance Design        — Freeze / Clawback (AI model defect scenario)
 *
 *  Network: XRPL Testnet (default) | XRPL Mainnet (XRPL_MAINNET=1)
 *  Requires: npm install xrpl
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const crypto = require('crypto');

// ── XRPL Network Config ─────────────────────────────────────────────────────
const NETWORK = {
  testnet: {
    server:      'wss://s.altnet.rippletest.net:51233',
    explorer_tx: 'https://testnet.xrpl.org/transactions/',
    explorer_ac: 'https://testnet.xrpl.org/accounts/',
    faucet:      true,
  },
  mainnet: {
    server:      'wss://xrplcluster.com',
    explorer_tx: 'https://xrpscan.com/tx/',
    explorer_ac: 'https://xrpscan.com/account/',
    faucet:      false,
  },
};

// RLUSD — Ripple의 공식 스테이블코인 (2024년 출시, 달러 연동)
// 트러스트라인 설정 후 결제/수령 가능
const RLUSD = {
  currency: 'RLUSD',
  // 테스트넷 RLUSD 발행자 (실제 주소는 네트워크마다 다를 수 있음)
  issuer_testnet: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
  // 메인넷 RLUSD 발행자 (Ripple 공식)
  issuer_mainnet: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
};

function getNet(useMainnet) {
  return useMainnet ? NETWORK.mainnet : NETWORK.testnet;
}

// ── XRPL 클라이언트 헬퍼 ────────────────────────────────────────────────────
async function getClient(useMainnet = false) {
  let xrpl;
  try { xrpl = require('xrpl'); }
  catch (e) { throw new Error('[Unveil] xrpl package not found. Run: npm install xrpl'); }
  const client = new xrpl.Client(getNet(useMainnet).server);
  await client.connect();
  return { client, xrpl };
}

async function getWallet(xrpl, client, useMainnet) {
  const seed = process.env.XRPL_SEED;
  if (seed) return xrpl.Wallet.fromSeed(seed);
  if (!useMainnet) {
    console.log('[Unveil XRPL] Testnet 지갑 생성 중 (faucet)...');
    const funded = await client.fundWallet();
    console.log('[Unveil XRPL] 새 지갑:', funded.wallet.address);
    return funded.wallet;
  }
  throw new Error('메인넷 사용 시 XRPL_SEED 환경변수가 필요합니다.');
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 : NFT Minting (XLS-20) — "Evidence as Financial Asset"
// ══════════════════════════════════════════════════════════════════════════════

/**
 * NFT URI 생성
 * URI = SHA-256(originalFileHash + ":" + verdict + ":" + c2paResult)
 * → 원본 파일 + 판정 결과 + C2PA 출처 정보를 하나의 불변 URI로 고정
 */
function buildNFTUri(fileHash, verdict, c2paResult) {
  const raw  = `${fileHash}:${verdict}:${c2paResult || 'none'}`;
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  const uri  = `unveil://${hash}`;
  return {
    uriHex:    Buffer.from(uri, 'utf8').toString('hex').toUpperCase(),
    uriHash:   hash,
    uriString: uri,
  };
}

/**
 * Memo 데이터 구조 (법적 증거 규격 준수)
 * - standard:  FRE 902 (연방 증거 규칙 — 자기 인증 문서)
 * - algorithm: SHA-256 (해시 알고리즘 명시)
 * - provider:  Unveil Protocol (서비스 제공자 명시)
 */
function buildMemoData(verdict, confidence, timestamp, extras = {}) {
  return {
    verdict,                        // "PASS" | "FAIL"
    confidence,                     // 0.00 ~ 1.00 (예: 0.98)
    timestamp,                      // Unix timestamp (초 단위)
    standard:  'FRE_902',           // Federal Rules of Evidence §902 — 자기 인증
    algorithm: 'SHA-256',           // 사용 해시 알고리즘
    provider:  'Unveil Protocol',   // 검증 서비스 제공자
    ...extras,                      // 추가 필드 (c2pa, modelVersion 등)
  };
}

/**
 * XRPL Memo 인코딩 (모든 필드는 UTF-8 → HEX 변환 필수)
 */
function encodeMemos(memoData) {
  return [{
    Memo: {
      MemoType:   toHex('application/json; schema=Unveil-Certificate-v1'),
      MemoData:   toHex(JSON.stringify(memoData)),
      MemoFormat: toHex('UTF-8'),
    },
  }];
}

function toHex(str) {
  return Buffer.from(str, 'utf8').toString('hex').toUpperCase();
}

/**
 * NFT 발행 (XLS-20 표준)
 *
 * ┌─────────────────────────────────────────────────────┐
 * │  NFT = "Digital Certificate of Truth"               │
 * │  = Financial Trigger Asset (보험, 법적 집행의 전제) │
 * └─────────────────────────────────────────────────────┘
 *
 * @param {object} params
 * @param {string} params.fileHash        - 원본 파일 SHA-256
 * @param {string} params.verdict         - 'PASS' | 'FAIL'
 * @param {number} params.confidence      - 신뢰도 (0~1)
 * @param {string} [params.c2paResult]    - C2PA 출처 결과
 * @param {string} [params.recipientAddress] - NFT 받을 사용자 지갑 주소
 * @param {boolean} [params.useMainnet]   - 메인넷 여부 (기본: testnet)
 * @returns {Promise<{txHash, nftId, walletAddress, explorerUrl, memoData}>}
 */
async function mintEvidenceNFT({
  fileHash,
  verdict,
  confidence,
  c2paResult,
  recipientAddress,
  useMainnet = false,
}) {
  const { client, xrpl } = await getClient(useMainnet);
  const net = getNet(useMainnet);

  try {
    const issuerWallet = await getWallet(xrpl, client, useMainnet);
    const timestamp    = Math.floor(Date.now() / 1000);

    // URI 구성
    const { uriHex, uriHash, uriString } = buildNFTUri(fileHash, verdict, c2paResult);

    // Memo 구성 (법적 증거 메타데이터)
    const memoData = buildMemoData(verdict, confidence, timestamp, {
      c2pa:         c2paResult || 'not-checked',
      issuer:       issuerWallet.address,
      fileHash,
      network:      useMainnet ? 'XRPL Mainnet' : 'XRPL Testnet',
    });
    const memos = encodeMemos(memoData);

    // NFTokenMint 트랜잭션
    // - Flags: tfTransferable  → 사용자에게 전송 가능
    // - NFTokenTaxon: 1        → 카테고리: Evidence Certificate
    // - TransferFee: 0         → 로열티 없음 (법적 증거는 무료 이전)
    const mintTx = {
      TransactionType: 'NFTokenMint',
      Account:         issuerWallet.address,
      URI:             uriHex,
      Flags:           xrpl.NFTokenMintFlags.tfTransferable,
      TransferFee:     0,
      NFTokenTaxon:    1,
      Memos:           memos,
    };

    const prepared = await client.autofill(mintTx);
    const signed   = issuerWallet.sign(prepared);
    const result   = await client.submitAndWait(signed.tx_blob);

    if (result.result.meta.TransactionResult !== 'tesSUCCESS') {
      throw new Error(`NFT 발행 실패: ${result.result.meta.TransactionResult}`);
    }

    const nftId = extractNFTId(result.result.meta);
    console.log(`[Unveil XRPL] ✅ NFT 발행 완료: ${nftId}`);

    // 사용자 지갑이 별도 지정된 경우 → NFT 전송 오퍼 생성
    let transferInfo = null;
    if (recipientAddress && recipientAddress !== issuerWallet.address) {
      transferInfo = await createNFTTransferOffer(
        client, xrpl, issuerWallet, nftId, recipientAddress
      );
    }

    return {
      txHash:           result.result.hash,
      nftId,
      walletAddress:    issuerWallet.address,
      recipientAddress: recipientAddress || issuerWallet.address,
      explorerUrl:      net.explorer_tx + result.result.hash,
      uriHash,
      uriString,
      memoData,
      transferOffer:    transferInfo,
      network:          useMainnet ? 'XRPL Mainnet' : 'XRPL Testnet',
      status:           'minted',
      mintedAt:         new Date().toISOString(),
      legalNote: [
        '✅ Unveil Protocol — Digital Certificate of Truth',
        `Verdict: ${verdict} (confidence: ${(confidence * 100).toFixed(1)}%)`,
        `Standard: FRE_902 | Algorithm: SHA-256`,
        `XRPL TxHash: ${result.result.hash}`,
        `NFT ID: ${nftId}`,
        `Issued by: Unveil Protocol (${issuerWallet.address})`,
        `Timestamp: ${new Date(timestamp * 1000).toISOString()}`,
      ].join('\n'),
    };

  } finally {
    await client.disconnect();
  }
}

/** 메타데이터에서 NFT ID 추출 */
function extractNFTId(meta) {
  if (!meta?.AffectedNodes) return null;
  for (const node of meta.AffectedNodes) {
    const obj   = node.CreatedNode || node.ModifiedNode;
    if (!obj) continue;
    const final = obj.NewFields || obj.FinalFields;
    if (final?.NFTokens?.length) {
      return final.NFTokens[final.NFTokens.length - 1].NFToken.NFTokenID;
    }
  }
  return null;
}

/** XLS-20: 발행자 → 사용자 NFT 전송 오퍼 생성 */
async function createNFTTransferOffer(client, xrpl, issuerWallet, nftId, recipientAddress) {
  const offerTx = {
    TransactionType: 'NFTokenCreateOffer',
    Account:         issuerWallet.address,
    NFTokenID:       nftId,
    Amount:          '0',            // 무료 이전
    Destination:     recipientAddress,
    Flags:           xrpl.NFTokenCreateOfferFlags.tfSellNFToken,
  };

  const prepared = await client.autofill(offerTx);
  const signed   = issuerWallet.sign(prepared);
  const result   = await client.submitAndWait(signed.tx_blob);

  const offerIndex = extractOfferIndex(result.result.meta);
  console.log(`[Unveil XRPL] NFT 전송 오퍼 생성: ${offerIndex}`);

  return {
    offerTxHash: result.result.hash,
    offerIndex,
    note: '수신자는 NFTokenAcceptOffer로 NFT를 최종 수령합니다.',
    // 프론트엔드: GemWallet / Xumm 지갑으로 offerIndex 수락
  };
}

function extractOfferIndex(meta) {
  if (!meta?.AffectedNodes) return null;
  for (const node of meta.AffectedNodes) {
    if (node.CreatedNode?.LedgerEntryType === 'NFTokenOffer') {
      return node.CreatedNode.LedgerIndex;
    }
  }
  return null;
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 : Payment Flow — "Execution Layer"
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 결제 감지 리스너 시작
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  User Wallet → XRP 결제 → Unveil Wallet                     │
 * │  → 결제 확인 → 검증 실행 → NFT 발행 → User Wallet          │
 * └─────────────────────────────────────────────────────────────┘
 *
 * CRITICAL LOGIC:
 *   IF payment_received == true:
 *       run_verification()
 *       mint_nft()
 *
 * 이것이 "단순 AI API"가 아닌 "금융 시스템"임을 증명하는 핵심 로직
 *
 * @param {object}   params
 * @param {Function} params.onPaymentReceived  - 결제 확인 후 실행할 검증 콜백
 *                   async ({ paymentTxHash, senderAddress, amount })
 *                   → { fileHash, verdict, confidence, c2paResult }
 * @param {boolean}  [params.useMainnet]
 * @returns {Promise<xrpl.Client>}  호출자가 직접 disconnect() 가능
 */
async function startPaymentListener({ onPaymentReceived, useMainnet = false }) {
  const { client, xrpl } = await getClient(useMainnet);
  const serviceWallet    = await getWallet(xrpl, client, useMainnet);

  console.log(`[Unveil XRPL] 결제 감지 시작 → ${serviceWallet.address}`);
  console.log(`[Unveil XRPL] 네트워크: ${useMainnet ? 'Mainnet' : 'Testnet'}`);

  // ── RLUSD 트러스트라인 설정 (RLUSD 수령 위한 사전 조건) ──────
  // RLUSD = Ripple의 달러 연동 스테이블코인 (2024년 출시)
  // 수령하려면 반드시 TrustSet 트랜잭션으로 트러스트라인 설정 필요
  // 실서비스에서는 아래 주석을 해제하고 실행 (1회만 필요):
  //
  // const rlusdIssuer = useMainnet ? RLUSD.issuer_mainnet : RLUSD.issuer_testnet;
  // await client.submitAndWait(serviceWallet.sign(await client.autofill({
  //   TransactionType: 'TrustSet',
  //   Account: serviceWallet.address,
  //   LimitAmount: { currency: 'RLUSD', issuer: rlusdIssuer, value: '100000' },
  // })).tx_blob);
  // console.log('[Unveil XRPL] RLUSD 트러스트라인 설정 완료');

  // XRPL 계정 트랜잭션 구독
  await client.request({
    command:  'subscribe',
    accounts: [serviceWallet.address],
  });

  client.on('transaction', async (event) => {
    const tx   = event.transaction;
    const meta = event.meta;

    // 조건 필터: Payment, 수신처가 서비스 지갑, 성공 여부
    if (tx.TransactionType !== 'Payment')             return;
    if (tx.Destination     !== serviceWallet.address) return;
    if (meta?.TransactionResult !== 'tesSUCCESS')     return;

    // ── 결제 유형 판별 ──────────────────────────────────────────
    // XRP:   tx.Amount = "1000000" (drops 단위, 1 XRP = 1,000,000 drops)
    // RLUSD: tx.Amount = { currency: "RLUSD", issuer: "...", value: "5.00" }
    const isXRP   = typeof tx.Amount === 'string';
    const isRLUSD = typeof tx.Amount === 'object' && tx.Amount?.currency === 'RLUSD';

    if (!isXRP && !isRLUSD) return; // XRP / RLUSD 외 결제 무시

    const amountDisplay = isXRP
      ? `${(parseInt(tx.Amount) / 1_000_000).toFixed(6)} XRP`
      : `${tx.Amount.value} RLUSD`;

    console.log(`[Unveil XRPL] 💰 결제 수신: ${tx.Account} → ${amountDisplay}`);

    // ── 핵심 로직: payment_received → run_verification() → mint_nft() ──
    try {
      const paymentInfo = {
        paymentTxHash: tx.hash,
        senderAddress: tx.Account,
        amount: isXRP
          ? { currency: 'XRP',   value: parseInt(tx.Amount) / 1_000_000 }
          : { currency: 'RLUSD', value: parseFloat(tx.Amount.value) },
        receivedAt: new Date().toISOString(),
      };

      // 1. 검증 실행 (server.js가 주입한 콜백)
      const verificationResult = await onPaymentReceived(paymentInfo);

      // 2. NFT 발행
      const nftResult = await mintEvidenceNFT({
        fileHash:         verificationResult.fileHash,
        verdict:          verificationResult.verdict,
        confidence:       verificationResult.confidence,
        c2paResult:       verificationResult.c2paResult,
        recipientAddress: tx.Account,  // 결제자에게 NFT 반환
        useMainnet,
      });

      console.log(`[Unveil XRPL] ✅ 전체 플로우 완료`);
      console.log(`  payment_tx: ${paymentInfo.paymentTxHash}`);
      console.log(`  nft_tx:     ${nftResult.txHash}`);
      console.log(`  verdict:    ${verificationResult.verdict}`);

      return {
        payment_tx:           paymentInfo.paymentTxHash,
        verification_started: true,
        nft_tx:               nftResult.txHash,
        nft_id:               nftResult.nftId,
        verdict:              verificationResult.verdict,
      };

    } catch (err) {
      console.error('[Unveil XRPL] ❌ 결제 플로우 오류:', err.message);
    }
  });

  // client는 호출자가 관리 (서버 종료 시 disconnect)
  return client;
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3 : Payment Trigger Logic — CORE DIFFERENTIATOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * NFT 판정 결과 기반 결제 실행/차단 결정
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  IF NFT.verdict == "PASS" → allow_payment_execution()           │
 * │  IF NFT.verdict == "FAIL" → block_payment()                     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 활용 주체: 보험사, AI 에이전트, 법적 집행 시스템
 *
 * 예시:
 *   const nft = await fetchNFTVerdict(nftId);
 *   const gate = evaluatePaymentTrigger(nft.verdict);
 *   if (gate.decision === 'ALLOW') {
 *     await executeInsurancePayout(claimId, amount); // 보험금 지급
 *   } else {
 *     await flagClaim(claimId, gate.message);        // 청구 보류
 *   }
 *
 * → "Unveil = Pre-condition layer for financial transactions"
 */
function evaluatePaymentTrigger(nftVerdict) {
  if (nftVerdict === 'PASS') {
    return {
      decision: 'ALLOW',
      action:   'allow_payment_execution',
      message:  '✅ 딥페이크 미탐지 — 결제 실행 승인 (Unveil Protocol)',
      http:     200,
    };
  }

  if (nftVerdict === 'FAIL') {
    return {
      decision: 'BLOCK',
      action:   'block_payment',
      message:  '🚫 딥페이크/위변조 탐지 — 결제 차단 (Unveil Protocol)',
      http:     403,
    };
  }

  return {
    decision: 'PENDING',
    action:   'hold_payment',
    message:  '⏳ 검증 대기 중 — 결제 보류',
    http:     202,
  };
}

/**
 * XRPL에서 NFT 메모 조회 → verdict 추출
 * (서버사이드 검증용: 실제 온체인 데이터 기반 판단)
 */
async function fetchNFTVerdict(txHash, useMainnet = false) {
  const { client } = await getClient(useMainnet);
  try {
    const result = await client.request({
      command: 'tx',
      transaction: txHash,
    });

    const memos = result.result.Memos;
    if (!memos?.length) return null;

    const memoData = JSON.parse(
      Buffer.from(memos[0].Memo.MemoData, 'hex').toString('utf8')
    );
    return memoData; // { verdict, confidence, timestamp, standard, ... }
  } finally {
    await client.disconnect();
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4 : Wallet Flow
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 서비스 지갑 정보 조회
 * 프론트엔드에 "이 주소로 XRP를 보내면 검증 + NFT 발급이 시작됩니다" 표시용
 *
 * 전체 흐름:
 *   User Wallet → [XRP 결제] → Unveil Wallet
 *   → run_verification() → mintEvidenceNFT()
 *   → [NFT 전송 오퍼] → User Wallet
 */
async function getServiceWalletInfo(useMainnet = false) {
  const { client, xrpl } = await getClient(useMainnet);
  const net = getNet(useMainnet);
  try {
    const wallet = await getWallet(xrpl, client, useMainnet);
    return {
      address:     wallet.address,
      network:     useMainnet ? 'XRPL Mainnet' : 'XRPL Testnet',
      explorerUrl: net.explorer_ac + wallet.address,
      paymentInstructions: {
        xrp: {
          currency:    'XRP',
          destination: wallet.address,
          minAmount:   '1',
          unit:        'XRP',
          note:        '1 XRP 이상 전송 시 자동으로 검증 및 NFT 발급이 시작됩니다.',
        },
        rlusd: {
          // RLUSD = Ripple 공식 달러 스테이블코인 (2024년 출시)
          // XRPL DEX에서 XRP ↔ RLUSD 스왑 가능, 리플 생태계 핵심 자산
          currency:    'RLUSD',
          destination: wallet.address,
          minAmount:   '1',
          unit:        'RLUSD',
          note:        '수신 전 서비스 지갑에 RLUSD 트러스트라인 설정 필요.',
          trustlineNote: '트러스트라인 설정 후 1 RLUSD 이상 전송 시 동일하게 동작합니다.',
        },
      },
    };
  } finally {
    await client.disconnect();
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5 : Compliance Design — Freeze / Clawback
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  시나리오:                                                                 │
 * │  Unveil이 검증에 사용한 AI 모델(예: Aion v1.2)에서 치명적 결함 발견.     │
 * │  해당 모델로 발급된 "PASS" 증거 NFT들이 실제로는 딥페이크를 통과시킨     │
 * │  것으로 판명. → 해당 NFT들의 법적 효력을 즉시 정지해야 함.              │
 * │                                                                            │
 * │  XLS-20 NFT는 직접 Freeze 불가 → 대안:                                   │
 * │    1. 발행자 Burn (NFT를 영구 소각)                                        │
 * │    2. UNVEIL 유틸리티 토큰 Freeze (해당 사용자 액세스 차단)               │
 * │    3. 온체인 Revocation Registry (별도 트랜잭션으로 무효화 기록)          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * [방법 1] NFT 소각 (발행자 권한)
 * 사용 시점: AI 모델 결함으로 발급된 PASS NFT의 법적 효력 즉시 무효화
 * 제어 주체: Unveil Protocol (발행자)
 *
 * ⚠️  주의: NFT가 이미 사용자에게 전송된 경우,
 *     발행자가 소각하려면 먼저 NFTokenCreateOffer → Owner 필드 지정 필요
 */
async function burnInvalidNFT({ nftId, ownerAddress, useMainnet = false }) {
  const { client, xrpl } = await getClient(useMainnet);
  try {
    const issuerWallet = await getWallet(xrpl, client, useMainnet);

    const burnTx = {
      TransactionType: 'NFTokenBurn',
      Account:         issuerWallet.address,
      NFTokenID:       nftId,
      // NFT가 다른 사람 지갑에 있는 경우: Owner 필드 추가
      ...(ownerAddress && ownerAddress !== issuerWallet.address
        ? { Owner: ownerAddress }
        : {}),
    };

    const prepared = await client.autofill(burnTx);
    const signed   = issuerWallet.sign(prepared);
    const result   = await client.submitAndWait(signed.tx_blob);

    return {
      txHash:   result.result.hash,
      burned:   true,
      nftId,
      reason:   'AI 모델 결함 발견 — 해당 증거 NFT 소각 (Unveil Protocol)',
      scenario: 'Aion AI v1.x 모델 결함으로 발급된 PASS 판정 NFT 무효화',
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * [방법 2] UNVEIL 유틸리티 토큰 트러스트라인 동결
 * 사용 시점: 결함 모델을 사용한 사용자 계정의 토큰 액세스 일시 차단
 * 제어 주체: Unveil Protocol (토큰 발행자) ↔ 개별 사용자 (트러스트라인 보유자)
 *
 * 실행 후: 해당 사용자는 UNVEIL 토큰 전송/수신 불가
 * 해제 방법: 동일 TrustSet에 tfClearFreeze 플래그 사용
 */
async function freezeUserTrustline({ userAddress, currency = 'UNVEIL', useMainnet = false }) {
  const { client, xrpl } = await getClient(useMainnet);
  try {
    const issuerWallet = await getWallet(xrpl, client, useMainnet);

    // TrustSet + tfSetFreeze: 특정 사용자의 트러스트라인을 발행자가 동결
    const freezeTx = {
      TransactionType: 'TrustSet',
      Account:         issuerWallet.address,
      LimitAmount: {
        currency: currency,
        issuer:   userAddress,  // 동결 대상 (카운터파티)
        value:    '0',
      },
      Flags: xrpl.TrustSetFlags.tfSetFreeze,
    };

    const prepared = await client.autofill(freezeTx);
    const signed   = issuerWallet.sign(prepared);
    const result   = await client.submitAndWait(signed.tx_blob);

    return {
      txHash:          result.result.hash,
      frozen:          true,
      targetAddress:   userAddress,
      currency,
      scenario:        'AI 모델 결함 발견 → 해당 사용자 UNVEIL 토큰 트러스트라인 동결',
      unfreezeMethod:  'TrustSet + tfClearFreeze 플래그로 동결 해제 가능',
      controlledBy:    'Unveil Protocol (발행자) — Global Freeze는 모든 사용자에게 적용',
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * [방법 3] UNVEIL 토큰 강제 회수 (Clawback)
 * 사용 시점: 결함 판정으로 부당하게 취득된 토큰 강제 회수
 * 제어 주체: Unveil Protocol (발행자) — 단, 계정에 lsfAllowTrustLineClawback 활성화 필수
 *
 * ⚠️  lsfAllowTrustLineClawback은 AccountSet으로 한 번 활성화하면 영구 적용
 *     (비활성화 불가 — 사용자에게 사전 공지 필요)
 */
async function clawbackTokens({ userAddress, amount, currency = 'UNVEIL', useMainnet = false }) {
  const { client, xrpl } = await getClient(useMainnet);
  try {
    const issuerWallet = await getWallet(xrpl, client, useMainnet);

    // Clawback: 발행자가 사용자의 IOU 토큰을 강제 회수
    // 전제조건: issuer 계정에 AccountSet { SetFlag: asfAllowTrustLineClawback } 실행 필요
    const clawbackTx = {
      TransactionType: 'Clawback',
      Account:         issuerWallet.address,
      Amount: {
        currency: currency,
        issuer:   userAddress,  // 토큰 보유자 (Amount.issuer = holder)
        value:    String(amount),
      },
    };

    const prepared = await client.autofill(clawbackTx);
    const signed   = issuerWallet.sign(prepared);
    const result   = await client.submitAndWait(signed.tx_blob);

    return {
      txHash:      result.result.hash,
      clawedBack:  true,
      fromAddress: userAddress,
      amount,
      currency,
      scenario:    'AI 모델 결함 발견 → 결함 판정으로 발행된 UNVEIL 토큰 강제 회수',
      controlledBy: 'Unveil Protocol (발행자) — asfAllowTrustLineClawback 활성화 계정만 가능',
    };
  } finally {
    await client.disconnect();
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Section 1: NFT
  mintEvidenceNFT,
  buildNFTUri,
  buildMemoData,
  burnInvalidNFT,

  // Section 2: Payment
  startPaymentListener,

  // Section 3: Trigger Logic
  evaluatePaymentTrigger,
  fetchNFTVerdict,

  // Section 4: Wallet
  getServiceWalletInfo,

  // Section 5: Compliance
  freezeUserTrustline,
  clawbackTokens,

  // Utilities
  encodeMemos,
  RLUSD,
};
