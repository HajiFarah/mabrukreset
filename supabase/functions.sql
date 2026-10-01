-- Historical function snapshot; superseded by 20261001000001_sync_live_receipts_and_sales_deletion.sql.
CREATE OR REPLACE FUNCTION save_receipt(
    p_supplier_name TEXT,
    p_receipt_date DATE,
    p_note TEXT,
    p_items JSONB,
    p_supplier_phone TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_supplier_id UUID;
    v_receipt_id UUID;
    v_item JSONB;
    v_name TEXT;
    v_category TEXT;
    v_size_value NUMERIC;
    v_size_unit VARCHAR(10);
    v_pieces_per_carton NUMERIC;
    v_packets_per_box NUMERIC;
    v_bag_weight NUMERIC;
    v_cost_price NUMERIC(12,2);
    v_sell_price NUMERIC(12,2);
    v_carton_sell_price NUMERIC(12,2);
    v_new_qty NUMERIC(12,3);
    v_receipt_total NUMERIC(12,2) := 0;
BEGIN
    INSERT INTO suppliers (name, phone)
    VALUES (p_supplier_name, p_supplier_phone)
    ON CONFLICT (name) DO UPDATE
       SET phone = COALESCE(EXCLUDED.phone, suppliers.phone)
    RETURNING id INTO v_supplier_id;

    INSERT INTO receipts (supplier_id, receipt_date, note)
    VALUES (v_supplier_id, p_receipt_date, p_note)
    RETURNING id INTO v_receipt_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items -> 'items', p_items))
    LOOP
        v_name := v_item ->> 'name';
        v_category := v_item ->> 'category';
        v_size_value := NULLIF(v_item ->> 'size_value', '')::NUMERIC;
        v_size_unit := v_item ->> 'size_unit';
        v_pieces_per_carton := NULLIF(v_item ->> 'pieces_per_carton', '')::NUMERIC;
        v_packets_per_box := NULLIF(v_item ->> 'packets_per_box', '')::NUMERIC;
        v_bag_weight := NULLIF(v_item ->> 'bag_weight', '')::NUMERIC;
        v_cost_price := NULLIF(v_item ->> 'cost_price', '')::NUMERIC(12,2);
        v_sell_price := NULLIF(v_item ->> 'sell_price', '')::NUMERIC(12,2);
        v_carton_sell_price := NULLIF(v_item ->> 'carton_sell_price', '')::NUMERIC(12,2);
        v_new_qty := NULLIF(v_item ->> 'stock_qty', '')::NUMERIC(12,3);
        v_receipt_total := v_receipt_total + COALESCE(v_cost_price, 0) * COALESCE(v_new_qty, 0);

        UPDATE products
           SET stock_qty = COALESCE(stock_qty, 0) + COALESCE(v_new_qty, 0),
               cost_price = v_cost_price,
               sell_price = v_sell_price,
               carton_sell_price = v_carton_sell_price
         WHERE lower(name) = lower(v_name)
           AND category = v_category
           AND size_value IS NOT DISTINCT FROM v_size_value
           AND size_unit IS NOT DISTINCT FROM v_size_unit;

        IF NOT FOUND THEN
            INSERT INTO products (
                name, category, size_value, size_unit,
                pieces_per_carton, packets_per_box, bag_weight,
                cost_price, sell_price, carton_sell_price, stock_qty,
                receipt_id, supplier_id
            ) VALUES (
                v_name, v_category, v_size_value, v_size_unit,
                v_pieces_per_carton, v_packets_per_box, v_bag_weight,
                v_cost_price, v_sell_price, v_carton_sell_price, v_new_qty,
                v_receipt_id, v_supplier_id
            );
        END IF;
    END LOOP;

    UPDATE receipts SET total_cost = v_receipt_total WHERE id = v_receipt_id;

    RETURN v_receipt_id;
END;
$$;

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
    v_status TEXT;
BEGIN
    -- Lock and validate each product, then compute the sale total.
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item ->> 'product_id')::UUID;
        v_qty := (v_item ->> 'qty')::NUMERIC(12,3);
        v_unit_sold := v_item ->> 'unit_sold';
        v_unit_price := (v_item ->> 'unit_price')::NUMERIC(12,2);
        v_unit_cost := (v_item ->> 'unit_cost')::NUMERIC(12,2);

        SELECT name, stock_qty, pieces_per_carton
          INTO v_product_name, v_stock_qty, v_pieces_per_carton
          FROM products
         WHERE id = v_product_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found', v_product_id;
        END IF;

        v_stock_deduction := CASE
            WHEN v_unit_sold = 'carton' THEN v_qty * v_pieces_per_carton
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

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item ->> 'product_id')::UUID;
        v_qty := (v_item ->> 'qty')::NUMERIC(12,3);
        v_unit_sold := v_item ->> 'unit_sold';
        v_unit_price := (v_item ->> 'unit_price')::NUMERIC(12,2);
        v_unit_cost := (v_item ->> 'unit_cost')::NUMERIC(12,2);
        v_line_total := v_qty * v_unit_price;

        SELECT name, pieces_per_carton
          INTO v_product_name, v_pieces_per_carton
          FROM products
         WHERE id = v_product_id
         FOR UPDATE;

        v_stock_deduction := CASE
            WHEN v_unit_sold = 'carton' THEN v_qty * v_pieces_per_carton
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

CREATE OR REPLACE FUNCTION settle_credit(
    p_sale_id UUID,
    p_amount NUMERIC,
    p_method TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance NUMERIC(12,2);
BEGIN
    INSERT INTO credit_payments (sale_id, amount, method)
    VALUES (p_sale_id, p_amount, p_method);

    UPDATE sales
       SET balance = GREATEST(COALESCE(balance, 0) - p_amount, 0),
           status = CASE
               WHEN COALESCE(balance, 0) - p_amount <= 0 THEN 'settled'
               ELSE status
           END
     WHERE id = p_sale_id
    RETURNING balance INTO v_balance;

    RETURN v_balance;
END;
$$;

CREATE OR REPLACE FUNCTION delete_product(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM sale_items WHERE product_id = p_id) THEN
        RAISE EXCEPTION 'Product has sales history and cannot be deleted';
    END IF;

    DELETE FROM products WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_receipt(p_receipt_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted_count INT;
BEGIN
    IF EXISTS (
        SELECT 1
          FROM products p
          JOIN sale_items si ON si.product_id = p.id
         WHERE p.receipt_id = p_receipt_id
    ) THEN
        RAISE EXCEPTION 'One or more products on this receipt have sales history';
    END IF;

    DELETE FROM products WHERE receipt_id = p_receipt_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    DELETE FROM receipts WHERE id = p_receipt_id;

    RETURN v_deleted_count;
END;
$$;

-- ─────────────────────────────────────────────
-- process_return
-- type: 'swap' or 'refund'
-- p_items: [{sale_item_id, old_product_id, qty,
--            new_product_id (swap only), new_qty (swap only)}]
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_return(
    p_sale_id  UUID,
    p_type     TEXT,
    p_items    JSONB,
    p_method   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_return_id       UUID;
    v_item            JSONB;
    v_sale_item_id    UUID;
    v_old_product_id  UUID;
    v_new_product_id  UUID;
    v_qty             NUMERIC(12,3);
    v_new_qty         NUMERIC(12,3);
    v_old_unit_price  NUMERIC(12,2);
    v_old_line_total  NUMERIC(12,2);
    v_new_sell_price  NUMERIC(12,2);
    v_price_diff      NUMERIC(12,2);
    v_total_cash_in   NUMERIC(12,2) := 0;
    v_total_cash_out  NUMERIC(12,2) := 0;
    v_sale_delta      NUMERIC(12,2) := 0;
BEGIN
    -- Create the return header
    INSERT INTO returns (sale_id, type, method, cash_in, cash_out)
    VALUES (p_sale_id, p_type, p_method, 0, 0)
    RETURNING id INTO v_return_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        v_sale_item_id   := (v_item ->> 'sale_item_id')::UUID;
        v_old_product_id := (v_item ->> 'old_product_id')::UUID;
        v_qty            := (v_item ->> 'qty')::NUMERIC(12,3);
        v_new_product_id := NULLIF(v_item ->> 'new_product_id', '')::UUID;
        v_new_qty        := NULLIF(v_item ->> 'new_qty', '')::NUMERIC(12,3);

        -- Fetch original sale item price & line total for calculations
        SELECT unit_price, line_total
          INTO v_old_unit_price, v_old_line_total
          FROM sale_items
         WHERE id = v_sale_item_id;

        -- Always restore old product stock
        UPDATE products
           SET stock_qty = stock_qty + v_qty
         WHERE id = v_old_product_id;

        IF p_type = 'swap' THEN
            -- Deduct new product stock
            UPDATE products
               SET stock_qty = stock_qty - v_new_qty
             WHERE id = v_new_product_id;

            -- Fetch new product sell price for comparison
            SELECT sell_price INTO v_new_sell_price
              FROM products WHERE id = v_new_product_id;

            v_price_diff := (v_new_sell_price * v_new_qty) - (v_old_unit_price * v_qty);

            IF v_price_diff > 0 THEN
                v_total_cash_in  := v_total_cash_in  + v_price_diff;
            ELSIF v_price_diff < 0 THEN
                v_total_cash_out := v_total_cash_out + ABS(v_price_diff);
            END IF;

            -- sale delta: client pays extra (positive) or gets refund (negative)
            v_sale_delta := v_sale_delta + v_price_diff;

        ELSIF p_type = 'refund' THEN
            v_total_cash_out := v_total_cash_out + v_old_line_total;
            v_sale_delta     := v_sale_delta - v_old_line_total;
        END IF;

        INSERT INTO return_items (
            return_id, sale_item_id,
            old_product_id, new_product_id,
            qty, new_qty, price_difference
        ) VALUES (
            v_return_id, v_sale_item_id,
            v_old_product_id, v_new_product_id,
            v_qty, v_new_qty,
            CASE WHEN p_type = 'swap' THEN v_price_diff ELSE -v_old_line_total END
        );
    END LOOP;

    -- Update return header with final cash totals
    UPDATE returns
       SET cash_in  = v_total_cash_in,
           cash_out = v_total_cash_out
     WHERE id = v_return_id;

    -- Adjust sale total and balance; clamp balance to 0 minimum
    UPDATE sales
       SET total      = GREATEST(total + v_sale_delta, 0),
           balance    = GREATEST(balance + v_sale_delta, 0),
           has_return = true,
           status     = CASE
                            WHEN GREATEST(balance + v_sale_delta, 0) = 0
                             AND status = 'credit' THEN 'settled'
                            ELSE status
                        END
     WHERE id = p_sale_id;

    RETURN v_return_id;
END;
$$;

-- ─────────────────────────────────────────────
-- close_day
-- Computes expected cash/mpesa from sales,
-- credit_payments, and returns for p_date,
-- then records the closing entry.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION close_day(
    p_date         DATE,
    p_actual_cash  NUMERIC,
    p_actual_mpesa NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_system_sales    NUMERIC(12,2) := 0;
    v_system_cogs     NUMERIC(12,2) := 0;
    v_return_cash_in  NUMERIC(12,2) := 0;
    v_return_cash_out NUMERIC(12,2) := 0;
    v_system_profit   NUMERIC(12,2);
    v_exp_cash        NUMERIC(12,2) := 0;
    v_exp_mpesa       NUMERIC(12,2) := 0;
    v_diff_cash       NUMERIC(12,2);
    v_diff_mpesa      NUMERIC(12,2);
BEGIN
    IF EXISTS (SELECT 1 FROM day_closings WHERE closing_date = p_date) THEN
        RAISE EXCEPTION 'Day already closed';
    END IF;

    -- Revenue: sum of sales totals for the day
    SELECT COALESCE(SUM(total), 0)
      INTO v_system_sales
      FROM sales
     WHERE DATE(created_at) = p_date;

    -- COGS: qty × snapshot unit_cost across all sale_items for the day
    SELECT COALESCE(SUM(si.qty * si.unit_cost), 0)
      INTO v_system_cogs
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
     WHERE DATE(s.created_at) = p_date;

    -- Return adjustments for profit
    SELECT COALESCE(SUM(r.cash_in),  0),
           COALESCE(SUM(r.cash_out), 0)
      INTO v_return_cash_in, v_return_cash_out
      FROM returns r
      JOIN sales s ON s.id = r.sale_id
     WHERE DATE(r.created_at) = p_date;

    v_system_profit := v_system_sales - v_system_cogs
                       + v_return_cash_in - v_return_cash_out;

    -- Expected cash:
    -- sales paid in cash + credit settlements in cash
    -- + swap top-ups (cash_in from returns) - refunds (cash_out from returns)
    SELECT COALESCE(SUM(paid_cash), 0)
      INTO v_exp_cash
      FROM sales
     WHERE DATE(created_at) = p_date;

    SELECT v_exp_cash
         + COALESCE((SELECT SUM(amount) FROM credit_payments
                      WHERE method = 'cash'
                        AND DATE(created_at) = p_date), 0)
         + COALESCE(v_return_cash_in,  0)
         - COALESCE(v_return_cash_out, 0)
      INTO v_exp_cash;

    -- Expected M-Pesa:
    SELECT COALESCE(SUM(paid_mpesa), 0)
      INTO v_exp_mpesa
      FROM sales
     WHERE DATE(created_at) = p_date;

    SELECT v_exp_mpesa
         + COALESCE((SELECT SUM(amount) FROM credit_payments
                      WHERE method = 'mpesa'
                        AND DATE(created_at) = p_date), 0)
      INTO v_exp_mpesa;

    v_diff_cash  := p_actual_cash  - v_exp_cash;
    v_diff_mpesa := p_actual_mpesa - v_exp_mpesa;

    INSERT INTO day_closings (
        closing_date,
        system_sales, system_cogs, system_profit,
        expected_cash, expected_mpesa,
        actual_cash,   actual_mpesa,
        diff_cash,     diff_mpesa,
        closed_at
    ) VALUES (
        p_date,
        v_system_sales, v_system_cogs, v_system_profit,
        v_exp_cash,  v_exp_mpesa,
        p_actual_cash, p_actual_mpesa,
        v_diff_cash, v_diff_mpesa,
        now()
    );
END;
$$;
