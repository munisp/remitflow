# Plan — RemitFlow Business Plan: Nigeria/Africa Market Variant

Task: user asked "assume the market is Nigeria/Africa — how does it impact the plan?"
Deliverable: `/mnt/agents/output/remitflow-business-plan-africa.md` + `.docx` — an addendum/variant
that re-derives the market-dependent chapters of the US-centric plan, keeping unchanged platform
capabilities as-is. Quality bar: same T1-sourced, citation-disciplined pipeline as the base plan.

## Stage 1 — Research (parallel explore agents)
- R1 (Market & competitors): Nigeria/Africa remittance flows & costs (World Bank RPW SSA 8.46%,
  Nigeria inflows ~$20B), mobile money scale (GSMA 2025), SME base (SMEDAN), competitive set and
  exact pricing — Moniepoint, OPay, PalmPay, Flutterwave, Paystack, LemFi, Nala, Chipper, Yellow Card,
  Onafriq; NGN card/POS economics; naira FX official vs parallel; Wise coverage gaps in Africa.
  → /mnt/agents/output/research/remitflow_africa_dim01.md
- R2 (Regulation & rails): CBN license taxonomy + capital requirements (IMTO, MMO, PSSP, PSB,
  Switching), NIBSS NIP fees, e-levy/stamp duty, NDPA, SEC digital-asset rules, stablecoin usage
  (Chainalysis), agent banking, open banking, Kenya/Ghana expansion licensing, accounting software
  usage (Odoo/local) among Nigerian SMEs.
  → /mnt/agents/output/research/remitflow_africa_dim02.md
- Orchestrator: cross-verification + insight synthesis files.

## Stage 2 — Writing (bp_writer role, consulting style, MORANDI palette)
Addendum chapters (file `remitflow-africa_secNN.md`):
1. Exec summary of the pivot impact (what changes / what doesn't)
2. Nigeria/Africa market opportunity (replaces base Ch.2)
3. African competitive landscape & pricing benchmarks (replaces base Ch.3)
4. Revenue model & pricing re-derivation for NGN economics (replaces base Ch.4/5)
5. Regulatory path — CBN + regional licenses (replaces base Ch.9)
6. GTM + revised 0–90–180 path + unit economics (replaces base Ch.6/7/8)
Round dispatch: R1 round = 2,3,5 (independent given outline); R2 round = 4,6; R3 = 1.

## Stage 3 — Review → assemble → docx
Section editor + transition editor (consistency vs base-plan platform facts), citation manager,
assembly to `remitflow-business-plan-africa.agent.final.md`, docx via /app/.agents/skills/docx/SKILL.md.
