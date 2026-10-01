ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON suppliers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON receipts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON sales
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON sale_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE credit_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON credit_payments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON returns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON return_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE day_closings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON day_closings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Run order in Supabase SQL editor:
-- 1. schema.sql
-- 2. functions.sql  (not yet written)
-- 3. policies.sql
