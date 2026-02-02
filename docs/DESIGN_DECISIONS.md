# Flare Design Decisions

This document tracks high-level architectural decisions for Flare.

## 📌 Core Architecture

### 1. Unified Data Source (Envio)
Flare uses the existing **Envio Indexer** (GraphQL) as its single source of truth. This eliminates the need to maintain multiple indexing stacks and ensures data consistency across the Monarch ecosystem.

### 2. Composable DSL
We use a primitive-based tree DSL instead of hardcoded metrics.
- **Primitives:** `EventRef`, `StateRef`, `Expression`, and `Condition`.
- **Benefit:** Decouples the backend from protocol-specific logic. Complex monitoring rules can be defined entirely via JSON without changing service code.

### 3. Stateless Snapshots (Time-Travel)
Instead of storing state snapshots in our database, Flare leverages Envio's **Time-Travel Queries** (`block: { number: ... }`). We resolve timestamps to block heights to query historical state directly from the indexer.

### 4. Job Queue Scaling
Flare uses **BullMQ (Redis)** for job distribution from day one. This allows the service to scale horizontally and ensures that long-running evaluations do not block the event loop or other signals.

### 5. Webhook-First Notifications
Flare follows a strict "Everything is a Webhook" architecture. Integrations with specific platforms (Telegram, Discord) are handled via external notification tunnels, keeping the core engine agnostic.
