# Unveil

## Current Direction (2026)

**Financial Event Infrastructure for Institutional Finance.**

Previous iterations explored trust verification for digital content and blockchain ecosystems.

Through customer validation with financial operations professionals, Unveil evolved toward verifying and reconstructing Financial Events across institutional finance.

---

> _Archived below: previous iteration (Unveil Protocol — XRPL/blockchain trust verification)._

---

# UNVEIL PROTOCOL

**The Digital Customs of the Blockchain Era**

*GitHub Repository — KFIP / XRPL Evaluation*

---

> **An insurer receives a suspicious claim image just before payout.**

| Step | Description |
|------|------|
| ① Upload | User uploads an image / video / document |
| ② AI Triple Verification | Independent analysis by Reality Defender + Hive Moderation + AI or Not, followed by a Fail-Safe consensus |
| ③ Fund Lock | A CryptoCondition Escrow is created — funds cannot move mathematically without Unveil's approval |
| ④ On-Chain Record | A verification certificate is issued via NFTokenMint, with the verdict result + SHA-256 stored in the Memo Field |
| ⑤ Execute or Block | AUTHENTIC → Fulfillment is revealed and funds are released via EscrowFinish / FAKE → the Preimage is discarded and the mathematical lock is permanently maintained |

**RESULT**
- On-chain verifiable evidence (txid, NFT ID)
- Automatically generated AI-based verification report
- A safe payout-decision environment for insurers and AI agents

> **We build a structure where only verified data becomes the standard for financial execution.**

---

## 1. XRPL Feature Utilization

XRPL natively provides the features required for transaction approval and verification data recording — SignerListSet, Multi-signing, Escrow, Credentials, Memo, and more — and Unveil uses XRPL as the trust infrastructure layer for recording and settling verified transaction data.

### 1. Native Multi-signing (SignerListSet, 2-of-2)
The Unveil verification node is registered as a co-signer on the user's account. A transaction cannot be executed by the user alone or by an AI agent alone; only transactions that satisfy the Unveil verification node's approval conditions are designed to meet the XRPL multi-sig requirement.

### 2. CryptoCondition Escrow (PREIMAGE-SHA-256)
Asset movement is designed to execute conditionally based on the AI verification result. EscrowFinish only executes through Preimage disclosure when the verification result is AUTHENTIC.

### 3. NFTokenMint (XLS-20) & Integrity Evidence
Deepfake and data-manipulation detection results are issued as XLS-20-based NFTs, recording the transaction verification history on-chain.

### 4. Credentials (XLS-70) — Verifiable AI Attestation
Unveil Protocol uses the XLS-70 Credentials amendment to issue AI verification results as on-chain certificates (Credentials). For content that passes verification, the Unveil verification node issues a `UNVEIL_AI_AUTHENTIC` Credential to the user's wallet, and the validity of this Credential is linked to the Escrow execution condition. If fraud is detected, the Credential can be immediately revoked (CredentialDelete) to block that account's transaction approval.

While existing NFT (XLS-20)-based evidence specializes in preserving immutable records, Credentials (XLS-70) function as a dynamic authorization token that can expire or be revoked, and is used directly in transaction approval conditions. By using both primitives together, Unveil provides permanent audit trail (NFT) and real-time access control (Credential) simultaneously.

### 5. Structured Memos (FRE-902 Verification Schema)
Every security transaction records the verification engine, verdict result, trust score, timestamp, and SHA-256 hash as structured Memo data. The FRE-902 Verification Schema links transactions to verification data and increases their usability for security audits.

---

## 2. The Problem: "Immutable Lie" in the AI Era

Today's blockchain ecosystem faces a structural gap between technical integrity and data authenticity. As generative AI advances, AI-driven data fraud — deepfakes, synthetic identities, fabricated financial documentation — is rapidly growing more sophisticated. In Hong Kong, a deepfake video-conference scam resulted in a fraudulent transfer of roughly $25 million, and existing Web3 security remains defenseless against AI-driven fraud that contaminates input data before it ever reaches the wallet.

Unveil Protocol provides a **Pre-chain Security Layer** — multi-AI consensus verification and native XRPL approval control applied before a transaction is ever recorded on-chain.

---

## 3. Our Solution: Pre-Chain Verification Layer

### 1. Multi-Engine AI Consensus
Rather than relying on a single AI model, Unveil orchestrates multiple AI verification engines specialized for images, audio, documents, and more, performing cross-verification across them.

### 2. Real-time Enforcement on XRPL
Verification results are linked directly to XRPL's native features and reflected directly in the transaction approval process. Whether a transaction executes is controlled by the verification result, through a CryptoCondition-based conditional execution structure and Credentials (XLS-70) authorization tokens.

### 3. Structured Verification & Audit Trail
Key metadata generated during verification — score, verdict, timestamp, hash, and more — is recorded as structured Memo data.

---

## 4. Why XRPL

### 1. Native Security Features
XRPL provides native security features such as SignerListSet and Multi-signing. By minimizing reliance on smart contracts and using ledger-level features directly, a simple and predictable security structure can be implemented.

### 2. Conditional Asset Control
We designed a conditional-approval structure using XRPL's CryptoCondition Escrow, controlling whether a transaction executes based on the AI verification result.

### 3. Verifiable Credential Infrastructure (XLS-70)
XRPL's Credentials (XLS-70) amendment provides a native structure for issuing, accepting, and revoking verification certificates on-chain. Unveil uses this to convert AI verification results into conditional authorization tokens — something other chains cannot implement without smart contracts.

### 4. Performance & Compliance Readiness
XRPL's low latency and Memo-field-based structured data recording provide a foundation for real-time verification and future security audits.

---

## 5. Business Model: Digital Toll Gate

**1. API-Based Real-Time Verification Fee (Transaction-Based Fee)**
A per-transaction verification fee is charged for the multi-AI verification and XRPL approval-linking process performed before a transaction executes.

**2. Institutional Security Subscription Service (Tiered SaaS Subscription)**
A subscription model offering differentiated security features based on asset scale and security requirements.

**3. Enterprise Compliance & Audit Solutions**
An enterprise solution extensible to support security audits and regulatory response, built on structured verification data.

---

## 6. The Vision: Beyond Blockchains

| Phase | Timeline | Focus Area | Key Deliverables |
|-------|----------|------------|------------------|
| **Phase 1** | Present (Q2 2026) | Validation & MVP | AI verification engine MVP · XRPL Testnet prototype · XLS-70 Credentials integration |
| **Phase 2** | H2 2026 | Protocol Integration | XRPL Mainnet integration · Expanded NFToken + Credentials verification evidence · B2B API service |
| **Phase 3** | 2027+ | Ecosystem Expansion | Cross-chain integration review · Audit solution expansion |
| **Phase 4** | Long-term (2028+) | Standardization & Scale | Verification Schema standardization · Establishing global trust infrastructure |

---

## 7. XRPL Integration Plan

1. **AI Analysis & Verification** — Multiple AI models cross-verify to generate a verdict and a trust score.
2. **Evidence Hash Generation** — The original data and the verification result are combined to generate a unique cryptographic hash (Evidence Hash).
3. **On-Chain Record (NFTokenMint)** — The generated evidence hash is recorded via the XRP Ledger's NFTokenMint feature.
4. **Credential Issuance (XLS-70)** — On an AUTHENTIC verdict, the Unveil verification node issues a CredentialCreate transaction to the user's wallet. This Credential is a dynamic authorization token valid for 30 days, linked to the Escrow execution condition.
5. **Structured Metadata Record** — Key information such as the verdict, trust score, and timestamp is stored in the Memo field of the XRPL transaction.

**Key Features**
- **Integrity Assurance**: Verification results are recorded on-chain and cannot be altered afterward
- **Traceability**: Every verification result is linked at the transaction level and can be re-verified
- **Dynamic Access Control**: Real-time issuance and revocation of XLS-70 Credentials allows transaction approval rights to be adjusted immediately

---

## 8. Current Stack

### 8.1. Current Tech Stack

- **Runtime**: Node.js v18 (High-performance Async Processing)
- **AI Detection**: Reality Defender, Hive Moderation, AI or Not API
- **Blockchain**: XRPL (XRP Ledger) Native Features — XLS-20, XLS-70, MultiSig, CryptoCondition Escrow
- **Dev Suite**: UnveilSDK (Custom API Abstraction Layer)

### 8.2. System Implementation Status

| Category | Technology / Feature | Status |
|------|--------------|------|
| **AI Detection Engine** | Multi-engine integration (Reality Defender, Hive, AI or Not) | ✅ Completed |
| | Fail-Safe Default Deny consensus | ✅ Completed |
| **XRPL Features** | NFT issuance via NFTokenMint (XLS-20) | 🔄 Testnet |
| | JSON + SHA-256 Structured Memo recording | ✅ Completed |
| | SignerListSet (2-of-2 MultiSig) approval structure | ✅ Completed |
| | CryptoCondition Escrow asset lock/release | ✅ Completed |
| | **Credentials (XLS-70) AI verification certificate issuance** | ✅ Mainnet |
| **Infrastructure** | Node.js v18 backend + Demo Mode | ✅ Completed |
| | UnveilSDK — unified API abstraction layer | ✅ Completed |
| **Verification Status** | XRPL Testnet on-chain log tracking | ✅ Verified |
| | NFT Evidence Record integrity verification | ✅ Verified |

---

> *"The Digital Customs every piece of data must pass before entering the blockchain."*
>
> **Unveil is not competing in the verification market.
> We are defining the infrastructure layer that the market will depend on.**

---

*Shin Jihee · Founder, Unveil Protocol · olivia040614@naver.com · April 2026*
