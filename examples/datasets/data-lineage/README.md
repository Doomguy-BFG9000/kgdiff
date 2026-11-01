# data-lineage · dbt project refactor

The lineage DAG of `shop`, a dbt e-commerce project, at two commits. Nodes are dbt resources
(`source.*`, `seed.*`, `model.*`, `exposure.*`, keyed by their `unique_id`); every edge is
`child –depends_on→ parent`. Data teams review this kind of diff before merging a refactor: which
models moved, what got split, which dashboards now read from a different table.

| | `main@4f2c9e1` | `main@b81d07a` |
| --- | --- | --- |
| nodes | 43 | 44 |
| edges | 49 | 50 |

## What it models

`sources` (Shopify, Stripe, GA4, Google Ads, ERP, Zendesk) → `staging` views → `intermediate`
ephemeral / table models → `marts` (facts and dimensions in `analytics`) → `exposures` (Looker
dashboards, an ML churn model, an internal app, a notebook). Attributes: `layer`,
`materialization`, `schema`, `tags`, `owner`, `columns_count` for models; `loader`, `freshness`
for sources; `exposure_type`, `owner`, `maturity`, `tool` for exposures.

## Changes

| Change | Resources | kgdiff reports |
| --- | --- | --- |
| Model renamed, so its `unique_id` changes | `model.shop.stg_orders` → `model.shop.stg_orders_v2` (+3 columns) | similarity match under `auto` (score ≈ 0.92) → `rekey` + `rename` + attrs; its edges stay unchanged |
| Model split in two (`replaces` hint on both) | `int_marketing_attribution` → `int_web_sessions` + `int_order_touchpoints` | split; its 3 edges carried (retarget, cause split); new edge `int_order_touchpoints → int_web_sessions` |
| Model removed | `int_legacy_discounts` (discount logic folded into `stg_orders_v2`) | removed node + 2 edges |
| New mart | `fct_customer_ltv` ← `dim_customers`, `fct_orders` | added node + 2 edges |
| Dependency retargets | `fct_daily_revenue`: `fct_orders` → `fct_payments`; `exposure.shop.customer_churn_model`: `fct_orders` → `fct_customer_ltv` | retarget (cause edit) |
| Materialization | `fct_orders`: `table` → `incremental` | attrs |
| Tags | `dim_customers` +`gdpr`; `fct_channel_performance` +`daily` | attrs |
| Owner | `fct_support_tickets`, `exposure.shop.support_ops_report`: `support-analytics` → `cx-analytics` | attrs |

The removed edge of `int_legacy_discounts` is reported in union-id space, i.e. pointing at
`model.shop.stg_orders_v2`. The split pair shares only the `int` token with the old model, so no
similarity match or suggestion competes with the `replaces` hint.

## Files

- `before.json`, `after.json`: kgdiff native JSON, as a `manifest.json` → graph exporter would write it.
- `meta.json`: options `{ "match": { "strategy": "auto" } }`.
- `expected.json`: exact changes.

The project is fictional. License: CC0-1.0.
