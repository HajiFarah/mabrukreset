-- Extend save_receipt to persist pieces_per_box and box_sell_price.
-- Required for crate (pieces/tray → pieces_per_box, tray sell price → box_sell_price)
-- and carton_box (box sell price was previously not saved on restock).

CREATE OR REPLACE FUNCTION public.save_receipt(
    p_supplier_name  TEXT,
    p_receipt_date   DATE,
    p_note           TEXT,
    p_items          JSONB,
    p_supplier_phone TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_supplier_id       UUID;
    v_receipt_id        UUID;
    v_product_id        UUID;
    v_item              JSONB;
    v_name              TEXT;
    v_category          TEXT;
    v_size_value        NUMERIC;
    v_size_unit         VARCHAR(10);
    v_pieces_per_carton NUMERIC;
    v_packets_per_box   NUMERIC;
    v_pieces_per_box    NUMERIC;
    v_bag_weight        NUMERIC;
    v_cost_price        NUMERIC(12,2);
    v_sell_price        NUMERIC(12,2);
    v_carton_sell_price NUMERIC(12,2);
    v_box_sell_price    NUMERIC(12,2);
    v_new_qty           NUMERIC(12,3);
    v_receipt_total     NUMERIC(12,2) := 0;
    v_phone             TEXT := NULLIF(trim(COALESCE(p_supplier_phone, '')), '');
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    INSERT INTO suppliers (name, phone)
    VALUES (p_supplier_name, v_phone)
    ON CONFLICT (name) DO UPDATE
       SET phone = COALESCE(EXCLUDED.phone, suppliers.phone)
    RETURNING id INTO v_supplier_id;

    INSERT INTO receipts (supplier_id, receipt_date, note)
    VALUES (v_supplier_id, p_receipt_date, p_note)
    RETURNING id INTO v_receipt_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items -> 'items', p_items))
    LOOP
        v_name              := regexp_replace(btrim(v_item ->> 'name'), '\s+', ' ', 'g');
        v_category          := btrim(v_item ->> 'category');
        v_size_value        := NULLIF(v_item ->> 'size_value', '')::NUMERIC;
        v_size_unit         := NULLIF(btrim(v_item ->> 'size_unit'), '');
        v_pieces_per_carton := NULLIF(v_item ->> 'pieces_per_carton', '')::NUMERIC;
        v_packets_per_box   := NULLIF(v_item ->> 'packets_per_box', '')::NUMERIC;
        v_pieces_per_box    := NULLIF(v_item ->> 'pieces_per_box', '')::NUMERIC;
        v_bag_weight        := NULLIF(v_item ->> 'bag_weight', '')::NUMERIC;
        v_cost_price        := NULLIF(v_item ->> 'cost_price', '')::NUMERIC(12,2);
        v_sell_price        := NULLIF(v_item ->> 'sell_price', '')::NUMERIC(12,2);
        v_carton_sell_price := NULLIF(v_item ->> 'carton_sell_price', '')::NUMERIC(12,2);
        v_box_sell_price    := NULLIF(v_item ->> 'box_sell_price', '')::NUMERIC(12,2);
        v_new_qty           := NULLIF(v_item ->> 'stock_qty', '')::NUMERIC(12,3);
        v_receipt_total     := v_receipt_total + COALESCE(v_cost_price, 0) * COALESCE(v_new_qty, 0);

        v_product_id := NULL;

        SELECT id INTO v_product_id
          FROM products
         WHERE lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower(v_name)
           AND lower(btrim(category)) = lower(v_category)
           AND size_value IS NOT DISTINCT FROM v_size_value
           AND NULLIF(lower(btrim(size_unit)), '') IS NOT DISTINCT FROM lower(v_size_unit)
         ORDER BY created_at
         LIMIT 1
           FOR UPDATE;

        IF v_product_id IS NOT NULL THEN
            UPDATE products
               SET stock_qty         = COALESCE(stock_qty, 0) + COALESCE(v_new_qty, 0),
                   cost_price        = v_cost_price,
                   sell_price        = v_sell_price,
                   carton_sell_price = v_carton_sell_price,
                   box_sell_price    = COALESCE(v_box_sell_price, box_sell_price),
                   pieces_per_box    = COALESCE(v_pieces_per_box, pieces_per_box)
             WHERE id = v_product_id;
        ELSE
            INSERT INTO products (
                name, category, size_value, size_unit,
                pieces_per_carton, packets_per_box, pieces_per_box, bag_weight,
                cost_price, sell_price, carton_sell_price, box_sell_price,
                stock_qty, receipt_id, supplier_id
            ) VALUES (
                v_name, v_category, v_size_value, v_size_unit,
                v_pieces_per_carton, v_packets_per_box, v_pieces_per_box, v_bag_weight,
                v_cost_price, v_sell_price, v_carton_sell_price, v_box_sell_price,
                v_new_qty, v_receipt_id, v_supplier_id
            )
            RETURNING id INTO v_product_id;
        END IF;

        INSERT INTO receipt_items (
            receipt_id, product_id, product_name, category,
            size_value, size_unit, qty,
            cost_price, sell_price, carton_sell_price, line_total
        ) VALUES (
            v_receipt_id, v_product_id, v_name, v_category,
            v_size_value, v_size_unit, COALESCE(v_new_qty, 0),
            v_cost_price, v_sell_price, v_carton_sell_price,
            COALESCE(v_cost_price, 0) * COALESCE(v_new_qty, 0)
        );
    END LOOP;

    UPDATE receipts SET total_cost = v_receipt_total WHERE id = v_receipt_id;

    RETURN v_receipt_id;
END;
$$;
