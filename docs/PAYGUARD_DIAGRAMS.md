## 1. Entire PayGuard system

```mermaid
flowchart TD
    O["👤 Owner"] -->|"Defines spending authority"| P["PayGuard Policy"]

    M["🏪 Merchant"] -->|"Signs invoice"| A["🤖 AI Agent"]
    A -->|"Signs PaymentIntent"| PG["🛡️ PayGuard"]

    P --> PG

    PG --> E{"Policy Decision"}

    E -->|"ALLOW"| EXEC["Execute Payment"]
    E -->|"ESCALATE"| APPROVAL["👤 Owner Approval"]
    E -->|"BLOCK"| STOP["❌ Stop<br/>No funds moved"]

    APPROVAL -->|"Exact EIP-712 approval"| EXEC

    EXEC --> V["🔐 PayGuardVault"]

    V --> ROUTE{"Authorized Settlement Route"}

    ROUTE -->|"Direct"| D["Direct Transfer"]
    ROUTE -->|"Uniswap v4"| U["🦄 Uniswap v4<br/>Exact Output"]
    ROUTE -->|"1inch"| AQ["💧 Aqua / SwapVM<br/>Exact Output"]

    D --> OUT["Exact settlement token"]
    U --> OUT
    AQ --> OUT

    OUT --> MERCHANT["🏪 Merchant receives<br/>exact invoice amount"]

    MERCHANT --> RECEIPT["✅ Canonical Payment Receipt"]
    RECEIPT --> UI["PayGuard UI<br/>Activity + Settlement Detail"]
```

The main mental model is:

> **AI proposes → PayGuard authorizes → settlement protocol executes.**

Uniswap and Aqua **do not decide whether the agent is allowed to spend**. PayGuard does.

---

# 2. ALLOW vs ESCALATE vs BLOCK

This is the actual heart of the product.

```mermaid
flowchart TD
    START["Agent proposes payment"] --> INV{"Valid merchant invoice?"}

    INV -->|"No"| BLOCK1["❌ BLOCK"]
    INV -->|"Yes"| MERCHANT{"Merchant allowed?"}

    MERCHANT -->|"No"| BLOCK2["❌ BLOCK"]
    MERCHANT -->|"Yes"| ROUTE{"Token + route allowed?"}

    ROUTE -->|"No"| BLOCK3["❌ BLOCK"]
    ROUTE -->|"Yes"| HARD{"Within hard budgets<br/>and input limits?"}

    HARD -->|"No"| BLOCK4["❌ BLOCK"]
    HARD -->|"Yes"| AUTO{"Amount <= automatic cap?"}

    AUTO -->|"Yes"| ALLOW["✅ ALLOW<br/>Agent can execute"]

    AUTO -->|"No"| ESC{"Amount <= escalation ceiling?"}

    ESC -->|"No"| BLOCK5["❌ BLOCK"]
    ESC -->|"Yes"| WAIT["⚠️ ESCALATE<br/>Wait for owner"]

    WAIT --> OWNER["Owner reviews exact payment"]

    OWNER -->|"No approval"| PENDING["No payment"]
    OWNER -->|"Signs exact intent"| APPROVED["✅ Authorized exception"]

    APPROVED --> EXEC["Execute same PaymentIntent"]

    ALLOW --> EXEC

    EXEC --> SETTLE["Settlement"]
```

So with the demo policy:

```text
Total budget:          300 mUSDC
Automatic limit:       100 mUSDC
Approval ceiling:      200 mUSDC
```

you get:

```mermaid
flowchart LR
    A["0.50 mUSDC<br/>Compute"] -->|"within auto cap"| AA["✅ ALLOW"]

    B["180 mUSDC<br/>Hotel"] -->|"above auto cap<br/>below 200"| BB["⚠️ ESCALATE"]

    C["500 mUSDC<br/>Attack"] -->|"above hard authority"| CC["❌ BLOCK"]
```

That is basically your entire hackathon story.

---

# 3. Who signs what?

This is especially important.

```mermaid
sequenceDiagram
    actor Owner
    participant Merchant
    participant Agent
    participant API as PayGuard API
    participant Worker
    participant Vault as PayGuardVault
    participant Protocol as Settlement Protocol

    Owner->>Vault: Create bounded policy

    Merchant->>Merchant: Create invoice
    Merchant->>API: Signed Invoice

    Agent->>Agent: Decide to purchase
    Agent->>API: Signed PaymentIntent

    API->>Vault: Evaluate payment

    alt Payment is automatically allowed
        Vault-->>API: ALLOW
    else Human approval required
        Vault-->>API: ESCALATE
        API-->>Owner: Exact payment details
        Owner->>API: Signed ExceptionApproval
    else Policy violation
        Vault-->>API: BLOCK
    end

    API->>Worker: Queue authorized payment
    Worker->>Vault: executePayment(...)

    Vault->>Protocol: Bounded settlement
    Protocol-->>Vault: Exact output

    Vault->>Merchant: Exact invoice amount
```

And the roles are:

```text
Merchant → signs Invoice

Agent → signs PaymentIntent

Owner → signs ExceptionApproval when necessary

Relayer/Worker → signs the blockchain transaction
                 but does NOT receive spending authority
```

That separation is intentional in the final architecture.

---

# 4. Uniswap v4 route

Suppose:

```text
Merchant wants: 0.50 mUSDC
Owner holds:    mRWA
```

```mermaid
flowchart TD
    AUTH["✅ PayGuard authorization passed"] --> VAULT["PayGuardVault"]

    VAULT -->|"Need exactly<br/>0.50 mUSDC"| ADAPTER["PayGuardV4Adapter"]

    ADAPTER -->|"Exact-output swap"| PM["Uniswap v4<br/>PoolManager"]

    PM --> POOL["mRWA / mUSDC Pool"]

    POOL -->|"Determine required input"| PM

    PM -->|"0.500000 mUSDC"| ADAPTER

    ADAPTER --> CHECK{"Actual mRWA input<br/><= signed maxInput?"}

    CHECK -->|"No"| REVERT["❌ Revert entire payment<br/>Invoice remains unpaid<br/>Budget not consumed"]

    CHECK -->|"Yes"| BACK["Output returned to Vault"]

    BACK --> VERIFY["Vault independently<br/>verifies balances"]

    VERIFY --> PAY["Transfer exactly<br/>0.500000 mUSDC"]

    PAY --> MERCHANT["🏪 Merchant"]

    MERCHANT --> SUCCESS["✅ PaymentExecuted"]
```

### Example

```text
Merchant requested       0.500000 mUSDC

Agent authorized max     0.00230 mRWA

Uniswap actually needs   0.00214 mRWA

✓ 0.00214 <= 0.00230

Merchant receives        0.500000 mUSDC
```

But:

```text
Uniswap needs            0.00260 mRWA

Agent authorized max     0.00230 mRWA

✗ exceeds limit
```

Then the **whole payment fails**.

That is the important integration: Uniswap liquidity **cannot enlarge the agent's authorization**. The plan requires the vault to verify the actual amount and exact merchant output.

---

# 5. Aqua / SwapVM route

The second route looks similar from PayGuard's perspective, but the settlement machinery is different.

```mermaid
flowchart TD
    PG["✅ PayGuard authorization"] --> VAULT["PayGuardVault"]

    VAULT -->|"Exact output + max input"| ADAPTER["PayGuardAquaAdapter"]

    MAKER["Liquidity Maker"] -->|"Ship strategy"| AQUA["💧 Aqua"]

    AQUA --> STRATEGY["Aqua Strategy<br/>mRWA ↔ mUSDC"]

    ADAPTER --> SWAPVM["1inch SwapVM"]

    SWAPVM --> STRATEGY

    STRATEGY -->|"Maker liquidity"| SWAPVM

    SWAPVM -->|"Exact mUSDC output"| ADAPTER

    ADAPTER --> CHECK{"Input <=<br/>maxInput?"}

    CHECK -->|"No"| FAIL["❌ Full rollback"]
    CHECK -->|"Yes"| RETURN["Return exact output<br/>to PayGuardVault"]

    RETURN --> PAY["Vault pays merchant"]

    PAY --> MERCHANT["🏪 Merchant"]

    MERCHANT --> RECEIPT["✅ PayGuard + Aqua receipt"]
```

The Aqua integration is **not just calling a quote API**.

For the sponsor demo, we want to show:

```text
Strategy maker       0x...
Strategy hash        0x...
Strategy status      SHIPPED

Requested output     2.000000 mUSDC
Maximum input        0.0090 mRWA
Actual input         0.0081 mRWA

SwapVM execution     ✓
Aqua token movement  ✓
Merchant received    2.000000 mUSDC
```

The selected Aqua design uses a separate maker strategy, exact-output execution, a max-input threshold, and an independently authorized PayGuard route.

And this satisfies the direction of the 1inch track much better because official Aqua/SwapVM use and actual token transfers are part of its published requirements.

---

# 6. Uniswap and Aqua are parallel, not chained

This distinction is crucial.

### ❌ We are NOT doing this

```mermaid
flowchart LR
    PG["PayGuard"] --> Aqua["Aqua"]
    Aqua --> VM["Custom SwapVM"]
    VM --> Uni["Uniswap v4"]
    Uni --> Hook["Custom Hook"]
    Hook --> M["Merchant"]
```

Too many dependencies.

---

### ✅ We are doing this

```mermaid
flowchart TD
    PG["🛡️ PayGuard Authorization"]

    PG --> ROUTE{"Policy-fixed route"}

    ROUTE -->|"Route A"| DIRECT["Direct Transfer"]

    ROUTE -->|"Route B"| UNI["🦄 Uniswap v4"]

    ROUTE -->|"Route C"| AQUA["💧 Aqua / SwapVM"]

    DIRECT --> MERCHANT["Merchant"]
    UNI --> MERCHANT
    AQUA --> MERCHANT
```

One payment uses **one** fixed route.

The final plan explicitly excludes serial Aqua → v4 composition.

---

# 7. Full technical flow from browser to blockchain

```mermaid
flowchart TD
    UI["🖥️ PayGuard UI"] --> API["Fastify API"]

    API --> DB[("PostgreSQL")]

    API -->|"Create/validate invoice<br/>intent / approval"| DOMAIN["PayGuard Domain Logic"]

    DOMAIN --> DB

    API -->|"Submit payment"| OUTBOX["Durable Outbox"]

    OUTBOX --> DB

    WORKER["Worker"] -->|"Claim work"| OUTBOX

    WORKER --> JOURNAL["Transaction Journal"]
    JOURNAL --> DB

    WORKER -->|"Persist raw signed tx<br/>before broadcast"| DB

    WORKER --> RPC["Ethereum RPC"]

    RPC --> VAULT["PayGuardVault"]

    VAULT --> ROUTE{"Settlement"}

    ROUTE --> UNI["Uniswap v4"]
    ROUTE --> AQUA["Aqua / SwapVM"]
    ROUTE --> DIRECT["Direct"]

    UNI --> VAULT
    AQUA --> VAULT
    DIRECT --> VAULT

    VAULT --> MERCHANT["Merchant"]

    RPC --> INDEXER["Indexer"]

    INDEXER -->|"Receipt + events"| DB

    DB --> API

    API -->|"Payment / operation / timeline"| UI
```

This is why a random returned transaction hash is **not** displayed as “Paid”.

The actual state is more like:

```mermaid
stateDiagram-v2
    [*] --> CREATED

    CREATED --> QUEUED
    QUEUED --> SUBMITTED

    SUBMITTED --> UNKNOWN: RPC response uncertain

    SUBMITTED --> INCLUDED: transaction observed
    UNKNOWN --> INCLUDED: same transaction recovered

    INCLUDED --> SUCCEEDED: canonical receipt + correct event
    INCLUDED --> REVERTED: failed receipt

    SUCCEEDED --> [*]
    REVERTED --> [*]
```

So:

```text
SUBMITTED ≠ paid
tx hash ≠ paid
API 202 ≠ paid

Canonical successful receipt
+
correct PayGuard event
=
paid
```

---

# 8. Browser/UI journey

This is the human-facing product.

```mermaid
flowchart TD
    LOGIN["1️⃣ Connect Wallet<br/>SIWE Login"]

    LOGIN --> DASH["2️⃣ Overview"]

    DASH --> POLICY["3️⃣ Create / Inspect Policy"]

    POLICY --> FUND["4️⃣ Fund Vault"]

    FUND --> AGENT["5️⃣ Agent Demo"]

    AGENT --> DECISION{"PayGuard decision"}

    DECISION -->|"ALLOW"| SETTLEMENT["Automatic Settlement"]

    DECISION -->|"ESCALATE"| APPROVAL["6️⃣ Approval Queue"]

    DECISION -->|"BLOCK"| FIREWALL["7️⃣ Firewall Activity"]

    APPROVAL -->|"Owner signs exact approval"| SETTLEMENT

    SETTLEMENT --> RECEIPT["8️⃣ Settlement Receipt"]

    FIREWALL --> ACTIVITY["Activity History"]
    RECEIPT --> ACTIVITY

    ACTIVITY --> DASH
```

The final UI is intentionally product-looking without becoming seven independent products: overview, policy, approvals, activity, demo workspace, vault controls and receipt details.

---

# 9. The hackathon demo flow

This is probably the single most useful Mermaid diagram for your pitch.

```mermaid
flowchart LR
    A["👤 Show Policy<br/>300 total<br/>100 auto<br/>200 approval"]

    B["🤖 Compute invoice<br/>0.50 mUSDC"]

    C["✅ ALLOW"]

    D["🦄 Uniswap v4<br/>mRWA → mUSDC"]

    E["🏪 Merchant gets<br/>exactly 0.50"]

    F["😈 Attack invoice<br/>500 mUSDC"]

    G["❌ BLOCK<br/>0 funds moved"]

    H["🏨 Hotel invoice<br/>180 mUSDC"]

    I["⚠️ ESCALATE"]

    J["👤 Owner signs<br/>exact approval"]

    K["✅ Settlement"]

    L["💧 Aqua scenario<br/>different invoice"]

    M["✅ SwapVM + Aqua<br/>real token movement"]

    N["📜 Receipt<br/>real hashes + amounts"]

    A --> B --> C --> D --> E

    E --> F --> G

    G --> H --> I --> J --> K

    K --> L --> M --> N
```

That gives you:

**Autonomy → Firewall → Human control → Sponsor interoperability → Proof.**

Those are exactly the five ideas I would want a judge to remember after seeing PayGuard. The final plan's intended demonstration follows essentially this sequence.

## The simplest diagram to remember

```mermaid
flowchart LR
    HUMAN["👤 Human<br/>sets limits"] --> AI["🤖 AI Agent<br/>proposes spend"]

    AI --> PG["🛡️ PayGuard"]

    PG -->|"Safe"| AUTO["✅ Autonomous"]
    PG -->|"Needs human"| HUMAN2["⚠️ Approval"]
    PG -->|"Unsafe"| BLOCK["❌ Block"]

    HUMAN2 --> PG

    AUTO --> RAIL["🦄 Uniswap v4<br/>or<br/>💧 Aqua / SwapVM"]

    RAIL --> MERCHANT["🏪 Merchant<br/>gets exact payment"]
```
