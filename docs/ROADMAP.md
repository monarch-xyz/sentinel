# 🧭 Sentinel Roadmap

This roadmap is MVP-focused. Items are ordered by impact and dependency.

## Now (MVP Hardening)
- Finish RPC/Envio test coverage (unit + small integration)
- Add smart query batching across signals (reduce Envio load)
- Add basic operational metrics (latency + success rates)
- Ship Railway deploy guide + schema bootstrap command

## Next (Productization)
- Add tenant-level rate limiting with Redis (shared across instances)
- Add notification retry policies per-signal
- Add basic admin views/exports for evaluation history

## Later (Monetization)
- x402 payments to gate `/auth/register`
- API key tiering and quotas
