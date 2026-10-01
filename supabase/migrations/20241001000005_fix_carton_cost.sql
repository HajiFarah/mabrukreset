-- Fix carton products where cost_price was stored as cost-per-carton instead of cost-per-piece.
-- This happened before the buildPayloadItem fix in stockIn.js.
-- Symptom: cost_price (e.g. 500) > sell_price (e.g. 65) → false "loss" on the Products page.
-- Safe condition: only touches carton rows where stored cost_price exceeds sell_price.
UPDATE products
SET cost_price = ROUND(cost_price / pieces_per_carton::numeric, 4)
WHERE category = 'carton'
  AND pieces_per_carton > 0
  AND cost_price > sell_price;
