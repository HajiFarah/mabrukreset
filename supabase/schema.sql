-- Mabruk GS food store schema

CREATE TABLE suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
    receipt_date DATE,
    note TEXT,
    total_cost NUMERIC(12,2),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('pieces', 'carton', 'packet', 'bag')),
    size_value NUMERIC,
    size_unit VARCHAR(10),
    pieces_per_carton NUMERIC,
    packets_per_box NUMERIC,
    bag_weight NUMERIC,
    cost_price NUMERIC(12,2),
    sell_price NUMERIC(12,2),
    carton_sell_price NUMERIC(12,2),
    stock_qty NUMERIC(12,3),
    receipt_id UUID REFERENCES receipts(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    size_value NUMERIC,
    size_unit VARCHAR(10),
    qty NUMERIC NOT NULL,
    cost_price NUMERIC,
    sell_price NUMERIC,
    carton_sell_price NUMERIC,
    line_total NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name TEXT,
    client_phone TEXT,
    total NUMERIC(12,2),
    paid_cash NUMERIC(12,2) DEFAULT 0,
    paid_mpesa NUMERIC(12,2) DEFAULT 0,
    balance NUMERIC(12,2),
    status TEXT CHECK (status IN ('paid', 'credit', 'settled')),
    has_return BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    product_name TEXT,
    unit_sold TEXT,
    qty NUMERIC(12,3),
    unit_price NUMERIC(12,2),
    unit_cost NUMERIC(12,2),
    line_total NUMERIC(12,2),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE credit_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2),
    method TEXT CHECK (method IN ('cash', 'mpesa')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
    type TEXT CHECK (type IN ('swap', 'refund')),
    cash_in NUMERIC(12,2) DEFAULT 0,
    cash_out NUMERIC(12,2) DEFAULT 0,
    method TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID REFERENCES returns(id) ON DELETE RESTRICT,
    sale_item_id UUID REFERENCES sale_items(id) ON DELETE RESTRICT,
    old_product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    new_product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    qty NUMERIC(12,3),
    new_qty NUMERIC(12,3),
    price_difference NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS public.deleted_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_by UUID DEFAULT auth.uid(),
    snapshot JSONB NOT NULL
);
ALTER TABLE public.deleted_sales ENABLE ROW LEVEL SECURITY;
-- The live USING clause was not captured; "true" is assumed.
DROP POLICY IF EXISTS deleted_sales_read ON public.deleted_sales;
CREATE POLICY deleted_sales_read ON public.deleted_sales
    FOR SELECT TO authenticated USING (true);

CREATE TABLE day_closings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closing_date DATE UNIQUE,
    system_sales NUMERIC(12,2),
    system_cogs NUMERIC(12,2),
    system_profit NUMERIC(12,2),
    expected_cash NUMERIC(12,2),
    expected_mpesa NUMERIC(12,2),
    actual_cash NUMERIC(12,2),
    actual_mpesa NUMERIC(12,2),
    diff_cash NUMERIC(12,2),
    diff_mpesa NUMERIC(12,2),
    closed_at TIMESTAMPTZ
);

CREATE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Foreign key indexes
CREATE INDEX receipts_supplier_id_idx ON receipts (supplier_id);
CREATE INDEX products_receipt_id_idx ON products (receipt_id);
CREATE INDEX products_supplier_id_idx ON products (supplier_id);
CREATE INDEX sale_items_sale_id_idx ON sale_items (sale_id);
CREATE INDEX sale_items_product_id_idx ON sale_items (product_id);
CREATE INDEX credit_payments_sale_id_idx ON credit_payments (sale_id);
CREATE INDEX returns_sale_id_idx ON returns (sale_id);
CREATE INDEX return_items_return_id_idx ON return_items (return_id);
CREATE INDEX return_items_sale_item_id_idx ON return_items (sale_item_id);
CREATE INDEX return_items_old_product_id_idx ON return_items (old_product_id);
CREATE INDEX return_items_new_product_id_idx ON return_items (new_product_id);
CREATE INDEX IF NOT EXISTS receipt_items_receipt_id_idx ON public.receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS receipt_items_product_id_idx ON public.receipt_items (product_id);

-- Case-insensitive product lookup and uniqueness by name/category/size.
CREATE INDEX products_lower_name_idx ON products (lower(name));
CREATE UNIQUE INDEX products_name_category_size_key
    ON products (lower(name), category, size_value, size_unit);
