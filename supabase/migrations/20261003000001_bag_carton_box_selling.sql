-- Allow carton_box category in products table
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check
  CHECK (category IN ('pieces', 'carton', 'packet', 'bag', 'carton_box'));

-- Update create_sale to handle:
--   unit_sold = 'bag'  → deduct qty × bag_weight   from stock_qty (which is in kg/L)
--   unit_sold = 'box'  → deduct qty × (pieces_per_carton / packets_per_box) from stock_qty
--   unit_sold = 'carton' (existing) → deduct qty × pieces_per_carton
--   everything else   → deduct qty as-is (pieces / kg direct)
CREATE OR REPLACE FUNCTION create_sale(
    p_client_name TEXT,
    p_client_phone TEXT,
    p_items JSONB,
    p_paid_cash NUMERIC,
    p_paid_mpesa NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sale_id UUID;
    v_item JSONB;
    v_product_id UUID;
    v_product_name TEXT;
    v_unit_sold TEXT;
    v_qty NUMERIC(12,3);
    v_stock_deduction NUMERIC(12,3);
    v_stock_qty NUMERIC(12,3);
    v_unit_price NUMERIC(12,2);
    v_unit_cost NUMERIC(12,2);
    v_line_total NUMERIC(12,2);
    v_total NUMERIC(12,2) := 0;
    v_balance NUMERIC(12,2);
    v_paid_cash NUMERIC(12,2) := COALESCE(p_paid_cash, 0);
    v_paid_mpesa NUMERIC(12,2) := COALESCE(p_paid_mpesa, 0);
    v_pieces_per_carton NUMERIC;
    v_packets_per_box NUMERIC;
    v_bag_weight NUMERIC;
    v_status TEXT;
BEGIN
    -- Pass 1: lock rows, validate stock, accumulate total
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id  := (v_item ->> 'product_id')::UUID;
        v_qty         := (v_item ->> 'qty')::NUMERIC(12,3);
        v_unit_sold   := v_item ->> 'unit_sold';
        v_unit_price  := (v_item ->> 'unit_price')::NUMERIC(12,2);
        v_unit_cost   := (v_item ->> 'unit_cost')::NUMERIC(12,2);

        SELECT name, stock_qty, pieces_per_carton, packets_per_box, bag_weight
          INTO v_product_name, v_stock_qty, v_pieces_per_carton, v_packets_per_box, v_bag_weight
          FROM products
         WHERE id = v_product_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found', v_product_id;
        END IF;

        v_stock_deduction := CASE
            WHEN v_unit_sold = 'carton'
                THEN v_qty * COALESCE(v_pieces_per_carton, 0)
            WHEN v_unit_sold = 'bag'
                THEN v_qty * COALESCE(v_bag_weight, 1)
            WHEN v_unit_sold = 'box'
                THEN v_qty * COALESCE(v_pieces_per_carton / NULLIF(v_packets_per_box, 0), 0)
            ELSE v_qty
        END;

        IF COALESCE(v_stock_qty, 0) < v_stock_deduction THEN
            RAISE EXCEPTION 'Insufficient stock for product %', v_product_name;
        END IF;

        v_total := v_total + (v_qty * v_unit_price);
    END LOOP;

    v_balance := v_total - (v_paid_cash + v_paid_mpesa);

    IF v_balance > 0 AND (p_client_name IS NULL OR trim(p_client_name) = '') THEN
        RAISE EXCEPTION 'Client name required for credit sales';
    END IF;

    v_status := CASE WHEN v_balance > 0 THEN 'credit' ELSE 'paid' END;

    INSERT INTO sales (
        client_name, client_phone, total, paid_cash, paid_mpesa, balance, status
    ) VALUES (
        p_client_name, p_client_phone, v_total, v_paid_cash, v_paid_mpesa, v_balance, v_status
    )
    RETURNING id INTO v_sale_id;

    -- Pass 2: deduct stock and insert sale_items
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id  := (v_item ->> 'product_id')::UUID;
        v_qty         := (v_item ->> 'qty')::NUMERIC(12,3);
        v_unit_sold   := v_item ->> 'unit_sold';
        v_unit_price  := (v_item ->> 'unit_price')::NUMERIC(12,2);
        v_unit_cost   := (v_item ->> 'unit_cost')::NUMERIC(12,2);
        v_line_total  := v_qty * v_unit_price;

        SELECT name, pieces_per_carton, packets_per_box, bag_weight
          INTO v_product_name, v_pieces_per_carton, v_packets_per_box, v_bag_weight
          FROM products
         WHERE id = v_product_id
         FOR UPDATE;

        v_stock_deduction := CASE
            WHEN v_unit_sold = 'carton'
                THEN v_qty * COALESCE(v_pieces_per_carton, 0)
            WHEN v_unit_sold = 'bag'
                THEN v_qty * COALESCE(v_bag_weight, 1)
            WHEN v_unit_sold = 'box'
                THEN v_qty * COALESCE(v_pieces_per_carton / NULLIF(v_packets_per_box, 0), 0)
            ELSE v_qty
        END;

        UPDATE products
           SET stock_qty = stock_qty - v_stock_deduction
         WHERE id = v_product_id;

        INSERT INTO sale_items (
            sale_id, product_id, product_name, unit_sold, qty,
            unit_price, unit_cost, line_total
        ) VALUES (
            v_sale_id, v_product_id, v_product_name, v_unit_sold, v_qty,
            v_unit_price, v_unit_cost, v_line_total
        );
    END LOOP;

    RETURN v_sale_id;
END;
$$;
