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

기존 Web3 보안 솔루션은 주로 키 보호, 피싱 탐지, 스마트컨트랙트 리스크 분석에 집중합니다. 반면 Unveil Protocol은 거래 실행 이전 단계에서 AI 생성 및 변질 데이터 자체를 검증하고, XRPL 네이티브 승인 구조와 연동하여 실질적인 사전 통제 레이어를 제공합니다.

XRPL은 SignerListSet, Multi-signing, Escrow, Memo 등 거래 승인 및 검증 데이터 기록에 필요한 기능을 네이티브 수준에서 제공하며, 낮은 지연 시간과 예측 가능한 비용 구조를 지원합니다. Unveil은 XRPL을 단순 블록체인 네트워크가 아닌, 검증된 거래 데이터의 기록 및 정산을 위한 신뢰 인프라 레이어로 활용합니다.
### 1. Native Multi-signing (SignerListSet, 2-of-2)
사용자 계정에 Unveil 검증 노드를 공동 서명자(Co-signer)로 등록합니다. 사용자 단독 또는 AI 에이전트 단독 서명만으로는 트랜잭션 실행이 불가능하며, Unveil 검증 노드의 승인 조건을 충족한 거래만 XRPL 멀티시그 조건을 만족하도록 설계했습니다.

### 2. CryptoCondition Escrow (PREIMAGE-SHA-256)
단순 서명 제어를 넘어, 자산 이동이 AI 검증 결과에 따라 조건부로 실행되도록 설계했습니다. 검증 결과가 AUTHENTIC일 경우에만 Preimage 공개를 통해 EscrowFinish가 실행됩니다.

### 3. NFTokenMint (XLS-20) & Integrity Evidence
딥페이크 및 데이터 조작 탐지 결과를 XLS-20 기반 NFT로 발행하여 거래 검증 이력을 온체인에 기록합니다.

### 4. Structured Memos (FRE-902 Verification Schema)
모든 보안 트랜잭션에 검증 엔진(engine), 판정 결과(verdict), 신뢰 점수(score), timestamp, SHA-256 hash 정보를 구조화된 Memo 데이터로 기록합니다.

---

## 2. The Problem: "Immutable Lie" in the AI Era

오늘날 블록체인 생태계는 기술적 무결성(Integrity)과 데이터 진위성(Authenticity) 사이의 구조적 간극에 직면해 있습니다. AI가 생성하거나 변질시킨 정교한 허위 데이터가 거래 승인 과정에 유입될 경우, 블록체인은 이를 검증하지 못한 채 영구적으로 기록할 수 있습니다.

생성형 AI의 발전으로 단순 딥페이크를 넘어, 합성 신원(Synthetic Identity), 조작된 금융 증빙 문서, 변질된 음성 데이터 등 AI 기반 데이터 사기가 빠르게 고도화되고 있습니다. 실제로 홍콩에서는 딥페이크 화상회의를 통해 약 2,500만 달러 규모의 송금 사고가 발생했습니다.

기존 Web3 보안은 키 중심 보안에 집중합니다. 그러나 AI는 지갑 외부에서 유입되는 입력 데이터 자체를 오염시키므로, 정상적인 서명 절차조차 사기 거래 실행 도구로 악용될 수 있습니다.

Unveil Protocol은 거래가 온체인에 기록되기 전, 다중 AI 합의 검증과 XRPL 네이티브 승인 통제를 통해 **Pre-chain Security Layer**를 제공합니다.

---

## 3. Our Solution: Pre-Chain Verification Layer

### 1. Multi-Engine AI Consensus
Unveil은 단일 AI 모델에 의존하지 않고, 이미지·음성·문서 등 각 영역에 특화된 다중 AI 검증 엔진을 오케스트레이션하여 교차 검증을 수행합니다.

### 2. Real-time Enforcement on XRPL
검증 결과는 XRPL의 네이티브 기능과 연동되어 거래 승인 과정에 직접 반영됩니다. CryptoCondition 기반 조건부 실행 구조를 통해 검증 결과에 따라 거래 실행 여부를 통제합니다.

### 3. Structured Verification & Audit Trail
검증 과정에서 생성된 score, verdict, timestamp, hash 등 주요 메타데이터는 구조화된 Memo 데이터로 기록됩니다.

---

## 4. Why XRPL

### 1. Native Security Features
XRPL은 SignerListSet 및 Multi-signing과 같은 네이티브 보안 기능을 제공합니다. 스마트컨트랙트 의존도를 최소화하고 원장 레벨 기능을 직접 활용함으로써, 보다 단순하고 예측 가능한 보안 구조를 구현할 수 있습니다.

### 2. Conditional Asset Control
XRPL의 CryptoCondition Escrow 기능으로 AI 검증 결과에 따라 거래 실행 여부를 통제하는 조건부 승인 구조를 설계했습니다.

### 3. Performance & Compliance Readiness
XRPL은 낮은 지연 시간과 안정적인 트랜잭션 처리 환경을 제공하며, Memo 필드를 통해 구조화된 검증 데이터를 기록할 수 있습니다.

---

## 5. Business Model: Digital Toll Gate

**1. API 기반 실시간 검증 수수료 (Transaction-based Fee)**
거래 실행 전 수행되는 AI 다중 검증 및 XRPL 승인 연동 프로세스에 대해 건당 검증 수수료를 부과하는 모델입니다.

**2. 기관용 보안 구독 서비스 (Tiered SaaS Subscription)**
자산 규모 및 보안 요구 수준에 따라 차별화된 보안 기능을 제공하는 구독형 모델입니다.

**3. 엔터프라이즈 컴플라이언스 및 Audit 솔루션**
거래와 연동된 구조화 검증 데이터를 기반으로 엔터프라이즈 솔루션으로 확장 가능합니다.

---

## 6. The Vision: Beyond Blockchains

| Phase | Timeline | Focus Area | Key Deliverables |
|-------|----------|------------|------------------|
| **Phase 1** | 현재 (Q2 2026) | Validation & MVP | AI 검증 엔진 MVP 고도화 · XRPL Testnet 프로토타입 운영 |
| **Phase 2** | 2026 하반기 | Protocol Integration | XRPL Mainnet 연동 · NFToken 검증 증빙 확장 · B2B API 서비스 |
| **Phase 3** | 2027+ | Ecosystem Expansion | Cross-chain 연동 (Ethereum, Solana) · Audit 솔루션 확장 |
| **Phase 4** | 장기 (2028+) | Standardization & Scale | Verification Schema 표준화 · 글로벌 신뢰 인프라 확립 |

---

## 7. XRPL Integration Plan

**1. AI 분석 및 검증** — 다중 AI 모델이 교차 검증하여 판정 결과(Verdict)와 신뢰도(Score)를 생성합니다.

**2. 증거 해시 생성** — 원본 데이터와 검증 결과를 결합하여 고유한 암호학적 해시(Evidence Hash)를 생성합니다.

**3. 온체인 기록 (NFTokenMint)** — 생성된 증거 해시는 XRP Ledger의 NFTokenMint 기능을 통해 기록됩니다.

**4. 구조화된 메타데이터 기록** — 판정 결과, 신뢰도, 타임스탬프 등 주요 정보는 XRPL 트랜잭션의 Memo 필드에 저장됩니다.

**핵심 특징**
- **무결성 보장**: 검증 결과가 온체인에 기록되어 이후 변경 불가
- **추적 가능성**: 모든 검증 결과는 트랜잭션 단위로 연결되어 재검증 가능
- **구조화된 기록**: AI 검증 데이터를 표준화된 형태로 저장

---

## 8. Current Stack

### 8.1. Current Tech Stack

- **Runtime**: Node.js v18 (High-performance Async Processing)
- **AI Detection**: Reality Defender, Hive Moderation, AI or Not API
- **Blockchain**: XRPL (XRP Ledger) Native Features
- **Dev Suite**: UnveilSDK (Custom API Abstraction Layer)

### 8.2. System Implementation Status

현재 Unveil Protocol은 핵심 보안 로직의 구현을 완료하였으며, **XRPL Testnet** 상에서 모든 주요 워크플로우를 즉시 검증할 수 있습니다.

| 구분 | 기술/기능 항목 | 상태 |
|------|--------------|------|
| **AI 탐지 엔진** | 다중 엔진 연동 (Reality Defender, Hive, AI or Not) | ✅ Completed |
| | Fail-Safe Default Deny 컨센서스 | ✅ Completed |
| **XRPL 기능** | NFTokenMint (XLS-20) 기반 NFT 발행 | 🔄 Testnet |
| | JSON + SHA-256 Structured Memo 기록 | ✅ Completed |
| | SignerListSet (2-of-2 MultiSig) 승인 구조 | ✅ Completed |
| | CryptoCondition Escrow 자산 잠금/해제 | ✅ Completed |
| **인프라** | Node.js v18 백엔드 + Demo Mode | ✅ Completed |
| | UnveilSDK — 통합 API 추상화 레이어 | ✅ Completed |
| **검증 상태** | XRPL Testnet 온체인 로그 추적 | ✅ Verified |
| | NFT Evidence Record 무결성 검증 | ✅ Verified |

---

> *"디지털 데이터가 블록체인에 올라가기 전, 반드시 거쳐야 하는 디지털 세관."*
>
> *"The Digital Customs every piece of data must pass before entering the blockchain."*
>
> **Unveil is not competing in the verification market. We are defining the infrastructure layer that the market will depend on.**

---

*Shin Jihee · Founder, Unveil Protocol · olivia040614@naver.com · April 2026*
