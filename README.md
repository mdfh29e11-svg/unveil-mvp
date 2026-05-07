# UNVEIL PROTOCOL

**The Digital Customs of the Blockchain Era**

*GitHub Repository — KFIP / XRPL Evaluation*

---

> **An insurer receives a suspicious claim image just before payout.**

| 단계 | 내용 |
|------|------|
| ① 업로드 | 사용자가 이미지 / 영상 / 문서 업로드 |
| ② AI 3중 검증 | Reality Defender + Hive Moderation + AI or Not 독립 분석 후 Fail-Safe 컨센서스 |
| ③ 자금 잠금 | CryptoCondition Escrow 생성 — Unveil 미승인 시 수학적으로 자금 이동 불가 |
| ④ 온체인 기록 | NFTokenMint로 검증 증명서 발급, Memo Field에 판정 결과 + SHA-256 저장 |
| ⑤ 실행 또는 차단 | AUTHENTIC → Fulfillment 공개, EscrowFinish로 자금 해제 / FAKE → Preimage 폐기, 수학적 잠금 영구 유지 |

**RESULT**
- 온체인 검증 가능한 증거 (txid, NFT ID)
- AI 기반 검증 리포트 자동 생성
- 보험사 및 AI 에이전트의 안전한 지급 판단 환경 제공

> **검증된 데이터만이 금융 실행의 기준이 되는 구조를 만듭니다.**

---

## 1. XRPL Feature Utilization

XRPL은 SignerListSet, Multi-signing, Escrow, Credentials, Memo 등 거래 승인 및 검증 데이터 기록에 필요한 기능을 네이티브 수준에서 제공하며, Unveil은 XRPL을 검증된 거래 데이터의 기록 및 정산을 위한 신뢰 인프라 레이어로 활용합니다.

### 1. Native Multi-signing (SignerListSet, 2-of-2)
사용자 계정에 Unveil 검증 노드를 공동 서명자(Co-signer)로 등록합니다. 사용자 단독 또는 AI 에이전트 단독 서명만으로는 트랜잭션 실행이 불가능하며, Unveil 검증 노드의 승인 조건을 충족한 거래만 XRPL 멀티시그 조건을 만족하도록 설계했습니다.

### 2. CryptoCondition Escrow (PREIMAGE-SHA-256)
자산 이동이 AI 검증 결과에 따라 조건부로 실행되도록 설계했습니다. 검증 결과가 AUTHENTIC일 경우에만 Preimage 공개를 통해 EscrowFinish가 실행됩니다.

### 3. NFTokenMint (XLS-20) & Integrity Evidence
딥페이크 및 데이터 조작 탐지 결과를 XLS-20 기반 NFT로 발행하여 거래 검증 이력을 온체인에 기록합니다.

### 4. Credentials (XLS-70) — Verifiable AI Attestation
Unveil Protocol은 XLS-70 Credentials amendment를 활용하여 AI 검증 결과를 온체인 인증서(Credential)로 발급합니다. 검증을 통과한 콘텐츠에 대해 Unveil 검증 노드가 사용자 지갑에 `UNVEIL_AI_AUTHENTIC` Credential을 발급하고, 이 Credential의 유효성이 Escrow 실행 조건과 연동됩니다. 사기 탐지 시에는 Credential을 즉시 폐기(CredentialDelete)하여 해당 계정의 거래 승인을 차단할 수 있습니다.

기존 NFT(XLS-20) 기반 증빙이 불변 기록 보존에 특화된 반면, Credentials(XLS-70)는 만료·취소가 가능한 동적 인가 토큰으로서 거래 승인 조건에 직접 활용됩니다. 두 primitive를 함께 사용함으로써 Unveil은 영구 감사 추적(NFT)과 실시간 접근 통제(Credential)를 동시에 제공합니다.

### 5. Structured Memos (FRE-902 Verification Schema)
모든 보안 트랜잭션에 검증 엔진, 판정 결과, 신뢰 점수, timestamp, SHA-256 hash를 구조화된 Memo 데이터로 기록합니다. FRE-902 Verification Schema를 통해 거래와 검증 데이터를 연결하고 보안 감사(Audit) 활용 가능성을 높입니다.

---

## 2. The Problem: "Immutable Lie" in the AI Era

오늘날 블록체인 생태계는 기술적 무결성(Integrity)과 데이터 진위성(Authenticity) 사이의 구조적 간극에 직면해 있습니다. 생성형 AI의 발전으로 딥페이크, 합성 신원, 조작된 금융 증빙 문서 등 AI 기반 데이터 사기가 빠르게 고도화되고 있습니다. 실제로 홍콩에서는 딥페이크 화상회의를 통해 약 2,500만 달러 규모의 송금 사고가 발생했으며, 기존 Web3 보안은 지갑 외부에서 유입되는 입력 데이터 자체를 오염시키는 AI 사기에 무방비 상태입니다.

Unveil Protocol은 거래가 온체인에 기록되기 전, 다중 AI 합의 검증과 XRPL 네이티브 승인 통제를 통해 **Pre-chain Security Layer**를 제공합니다.

---

## 3. Our Solution: Pre-Chain Verification Layer

### 1. Multi-Engine AI Consensus
Unveil은 단일 AI 모델에 의존하지 않고, 이미지·음성·문서 등 각 영역에 특화된 다중 AI 검증 엔진을 오케스트레이션하여 교차 검증을 수행합니다.

### 2. Real-time Enforcement on XRPL
검증 결과는 XRPL의 네이티브 기능과 연동되어 거래 승인 과정에 직접 반영됩니다. CryptoCondition 기반 조건부 실행 구조와 Credentials(XLS-70) 인가 토큰을 통해 검증 결과에 따라 거래 실행 여부를 통제합니다.

### 3. Structured Verification & Audit Trail
검증 과정에서 생성된 score, verdict, timestamp, hash 등 주요 메타데이터는 구조화된 Memo 데이터로 기록됩니다.

---

## 4. Why XRPL

### 1. Native Security Features
XRPL은 SignerListSet 및 Multi-signing 네이티브 보안 기능을 제공합니다. 스마트컨트랙트 의존도를 최소화하고 원장 레벨 기능을 직접 활용함으로써 단순하고 예측 가능한 보안 구조를 구현할 수 있습니다.

### 2. Conditional Asset Control
XRPL의 CryptoCondition Escrow로 AI 검증 결과에 따라 거래 실행 여부를 통제하는 조건부 승인 구조를 설계했습니다.

### 3. Verifiable Credential Infrastructure (XLS-70)
XRPL의 Credentials(XLS-70) amendment는 검증 인증서를 온체인에서 발급·수락·폐기할 수 있는 네이티브 구조를 제공합니다. Unveil은 이를 활용해 AI 검증 결과를 조건부 인가 토큰으로 변환하며, 다른 체인에서는 스마트컨트랙트 없이 이를 구현할 수 없습니다.

### 4. Performance & Compliance Readiness
XRPL의 낮은 지연 시간과 Memo 필드 기반 구조화 데이터 기록은 실시간 검증과 향후 보안 감사(Audit)를 위한 기반을 제공합니다.

---

## 5. Business Model: Digital Toll Gate

**1. API 기반 실시간 검증 수수료 (Transaction-based Fee)**
거래 실행 전 수행되는 AI 다중 검증 및 XRPL 승인 연동 프로세스에 대해 건당 검증 수수료를 부과합니다.

**2. 기관용 보안 구독 서비스 (Tiered SaaS Subscription)**
자산 규모 및 보안 요구 수준에 따라 차별화된 보안 기능을 제공하는 구독형 모델입니다.

**3. 엔터프라이즈 컴플라이언스 및 Audit 솔루션**
구조화 검증 데이터를 기반으로 보안 감사 및 규제 대응을 지원하는 엔터프라이즈 솔루션으로 확장 가능합니다.

---

## 6. The Vision: Beyond Blockchains

| Phase | Timeline | Focus Area | Key Deliverables |
|-------|----------|------------|------------------|
| **Phase 1** | 현재 (Q2 2026) | Validation & MVP | AI 검증 엔진 MVP · XRPL Testnet 프로토타입 · XLS-70 Credentials 통합 |
| **Phase 2** | 2026 하반기 | Protocol Integration | XRPL Mainnet 연동 · NFToken + Credentials 검증 증빙 확장 · B2B API 서비스 |
| **Phase 3** | 2027+ | Ecosystem Expansion | Cross-chain 연동 검토 · Audit 솔루션 확장 |
| **Phase 4** | 장기 (2028+) | Standardization & Scale | Verification Schema 표준화 · 글로벌 신뢰 인프라 확립 |

---

## 7. XRPL Integration Plan

1. **AI 분석 및 검증** — 다중 AI 모델이 교차 검증하여 판정 결과(Verdict)와 신뢰도(Score)를 생성합니다.
2. **증거 해시 생성** — 원본 데이터와 검증 결과를 결합하여 고유한 암호학적 해시(Evidence Hash)를 생성합니다.
3. **온체인 기록 (NFTokenMint)** — 생성된 증거 해시는 XRP Ledger의 NFTokenMint 기능을 통해 기록됩니다.
4. **Credential 발급 (XLS-70)** — AUTHENTIC 판정 시 Unveil 검증 노드가 사용자 지갑에 CredentialCreate 트랜잭션을 발행합니다. 이 Credential은 30일 유효 기간을 갖는 동적 인가 토큰으로, Escrow 실행 조건과 연동됩니다.
5. **구조화된 메타데이터 기록** — 판정 결과, 신뢰도, 타임스탬프 등 주요 정보는 XRPL 트랜잭션의 Memo 필드에 저장됩니다.

**핵심 특징**
- **무결성 보장**: 검증 결과가 온체인에 기록되어 이후 변경 불가
- **추적 가능성**: 모든 검증 결과는 트랜잭션 단위로 연결되어 재검증 가능
- **동적 접근 통제**: XLS-70 Credential의 실시간 발급·폐기로 거래 승인 권한을 즉시 조정

---

## 8. Current Stack

### 8.1. Current Tech Stack

- **Runtime**: Node.js v18 (High-performance Async Processing)
- **AI Detection**: Reality Defender, Hive Moderation, AI or Not API
- **Blockchain**: XRPL (XRP Ledger) Native Features — XLS-20, XLS-70, MultiSig, CryptoCondition Escrow
- **Dev Suite**: UnveilSDK (Custom API Abstraction Layer)

### 8.2. System Implementation Status

| 구분 | 기술/기능 항목 | 상태 |
|------|--------------|------|
| **AI 탐지 엔진** | 다중 엔진 연동 (Reality Defender, Hive, AI or Not) | ✅ Completed |
| | Fail-Safe Default Deny 컨센서스 | ✅ Completed |
| **XRPL 기능** | NFTokenMint (XLS-20) 기반 NFT 발행 | 🔄 Testnet |
| | JSON + SHA-256 Structured Memo 기록 | ✅ Completed |
| | SignerListSet (2-of-2 MultiSig) 승인 구조 | ✅ Completed |
| | CryptoCondition Escrow 자산 잠금/해제 | ✅ Completed |
| | **Credentials (XLS-70) AI 검증 인증서 발급** | 🔄 Testnet |
| **인프라** | Node.js v18 백엔드 + Demo Mode | ✅ Completed |
| | UnveilSDK — 통합 API 추상화 레이어 | ✅ Completed |
| **검증 상태** | XRPL Testnet 온체인 로그 추적 | ✅ Verified |
| | NFT Evidence Record 무결성 검증 | ✅ Verified |

---

> *"디지털 데이터가 블록체인에 올라가기 전, 반드시 거쳐야 하는 디지털 세관."*
>
> *"The Digital Customs every piece of data must pass before entering the blockchain."*
>
> **Unveil is not competing in the verification market.
> We are defining the infrastructure layer that the market will depend on.**

---

*Shin Jihee · Founder, Unveil Protocol · olivia040614@naver.com · April 2026*
