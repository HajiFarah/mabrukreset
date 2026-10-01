-- receipt_items table (live structure)
create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  category text not null,
  size_value numeric,
  size_unit varchar(10),
  qty numeric not null,
  cost_price numeric,
  sell_price numeric,
  carton_sell_price numeric,
  line_total numeric,
  created_at timestamptz default now()
);
-- Also add (if not exists) indexes on receipt_items(receipt_id) and receipt_items(product_id).
create index if not exists receipt_items_receipt_id_idx on public.receipt_items(receipt_id);
create index if not exists receipt_items_product_id_idx on public.receipt_items(product_id);

-- deleted_sales table (live structure)
create table if not exists public.deleted_sales (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid default auth.uid(),
  snapshot jsonb not null
);
alter table public.deleted_sales enable row level security;
-- The live USING clause was not captured; "true" is assumed.
drop policy if exists deleted_sales_read on public.deleted_sales;
create policy deleted_sales_read on public.deleted_sales for select to authenticated using (true);

-- Functions (live definitions, all SECURITY DEFINER, SET search_path TO 'public')

create or replace function public.delete_receipt(p_receipt_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
DECLARE
    v_item RECORD;
    v_prod RECORD;
    v_stock NUMERIC;
    v_name TEXT;
    v_next_receipt UUID;
    v_next_supplier UUID;
    v_deleted_count INT := 0;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    IF NOT EXISTS (SELECT 1 FROM receipts WHERE id = p_receipt_id) THEN
        RAISE EXCEPTION 'Receipt not found';
    END IF;

    -- Lock every product touched by this receipt
    PERFORM 1
       FROM products
      WHERE id IN (SELECT product_id FROM receipt_items
                    WHERE receipt_id = p_receipt_id AND product_id IS NOT NULL)
         OR receipt_id = p_receipt_id
        FOR UPDATE;

    -- Validate: stock added by this receipt must still be on hand
    FOR v_item IN
        SELECT product_id, SUM(qty) AS qty
          FROM receipt_items
         WHERE receipt_id = p_receipt_id AND product_id IS NOT NULL
         GROUP BY product_id
    LOOP
        SELECT stock_qty, name INTO v_stock, v_name
          FROM products WHERE id = v_item.product_id;

        IF COALESCE(v_stock, 0) < v_item.qty THEN
            RAISE EXCEPTION 'Cannot delete receipt: stock from "%" has already been sold', v_name;
        END IF;
    END LOOP;

    -- Reverse the stock
    FOR v_item IN
        SELECT product_id, SUM(qty) AS qty
          FROM receipt_items
         WHERE receipt_id = p_receipt_id AND product_id IS NOT NULL
         GROUP BY product_id
    LOOP
        UPDATE products
           SET stock_qty = COALESCE(stock_qty, 0) - v_item.qty
         WHERE id = v_item.product_id;
    END LOOP;

    -- Handle products whose "first receipt" is this one
    FOR v_prod IN SELECT id FROM products WHERE receipt_id = p_receipt_id
    LOOP
        v_next_receipt := NULL;
        v_next_supplier := NULL;

        SELECT ri.receipt_id, r.supplier_id
          INTO v_next_receipt, v_next_supplier
          FROM receipt_items ri
          JOIN receipts r ON r.id = ri.receipt_id
         WHERE ri.product_id = v_prod.id
           AND ri.receipt_id <> p_receipt_id
         ORDER BY r.receipt_date, r.created_at
         LIMIT 1;

        IF v_next_receipt IS NOT NULL THEN
            UPDATE products
               SET receipt_id = v_next_receipt,
                   supplier_id = v_next_supplier
             WHERE id = v_prod.id;
        ELSIF NOT EXISTS (SELECT 1 FROM sale_items WHERE product_id = v_prod.id) THEN
            DELETE FROM products WHERE id = v_prod.id;
            v_deleted_count := v_deleted_count + 1;
        ELSE
            UPDATE products SET receipt_id = NULL WHERE id = v_prod.id;
        END IF;
    END LOOP;

    DELETE FROM receipts WHERE id = p_receipt_id;

    RETURN v_deleted_count;
END;
$function$;

create or replace function public.delete_sale(p_sale_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
DECLARE
    v_sale sales%ROWTYPE;
    v_row RECORD;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;

    -- Keep a permanent record before anything is removed
    INSERT INTO deleted_sales (sale_id, snapshot)
    VALUES (p_sale_id, jsonb_build_object(
        'sale', to_jsonb(v_sale),
        'items', COALESCE((SELECT jsonb_agg(to_jsonb(si)) FROM sale_items si WHERE si.sale_id = p_sale_id), '[]'::jsonb),
        'returns', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM returns r WHERE r.sale_id = p_sale_id), '[]'::jsonb),
        'return_items', COALESCE((SELECT jsonb_agg(to_jsonb(ri)) FROM return_items ri
                                   JOIN returns r ON r.id = ri.return_id WHERE r.sale_id = p_sale_id), '[]'::jsonb),
        'credit_payments', COALESCE((SELECT jsonb_agg(to_jsonb(cp)) FROM credit_payments cp WHERE cp.sale_id = p_sale_id), '[]'::jsonb)
    ));

    -- Lock affected products
    PERFORM 1 FROM products
     WHERE id IN (SELECT product_id FROM sale_items WHERE sale_id = p_sale_id AND product_id IS NOT NULL)
        OR id IN (SELECT ri.new_product_id FROM return_items ri JOIN returns r ON r.id = ri.return_id
                   WHERE r.sale_id = p_sale_id AND ri.new_product_id IS NOT NULL)
       FOR UPDATE;

    -- Restock sold quantity, minus what earlier returns already put back
    FOR v_row IN
        SELECT si.product_id,
               SUM(si.qty - COALESCE(r.returned, 0)) AS qty
          FROM sale_items si
          LEFT JOIN (SELECT sale_item_id, SUM(qty) AS returned
                       FROM return_items GROUP BY sale_item_id) r
                 ON r.sale_item_id = si.id
         WHERE si.sale_id = p_sale_id AND si.product_id IS NOT NULL
         GROUP BY si.product_id
    LOOP
        UPDATE products
           SET stock_qty = COALESCE(stock_qty, 0) + GREATEST(COALESCE(v_row.qty, 0), 0)
         WHERE id = v_row.product_id;
    END LOOP;

    -- Swaps took stock of a replacement product: give that back too
    FOR v_row IN
        SELECT ri.new_product_id AS product_id, SUM(ri.new_qty) AS qty
          FROM return_items ri
          JOIN returns r ON r.id = ri.return_id
         WHERE r.sale_id = p_sale_id AND r.type = 'swap' AND ri.new_product_id IS NOT NULL
         GROUP BY ri.new_product_id
    LOOP
        UPDATE products
           SET stock_qty = COALESCE(stock_qty, 0) + COALESCE(v_row.qty, 0)
         WHERE id = v_row.product_id;
    END LOOP;

    DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE sale_id = p_sale_id);
    DELETE FROM returns WHERE sale_id = p_sale_id;
    DELETE FROM credit_payments WHERE sale_id = p_sale_id;
    DELETE FROM sale_items WHERE sale_id = p_sale_id;
    DELETE FROM sales WHERE id = p_sale_id;
END;
$function$;

create or replace function public.save_receipt(p_supplier_name text, p_receipt_date date, p_note text, p_items jsonb, p_supplier_phone text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
DECLARE
    v_supplier_id UUID;
    v_receipt_id UUID;
    v_product_id UUID;
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
    v_phone TEXT := NULLIF(trim(COALESCE(p_supplier_phone, '')), '');
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
        v_name := regexp_replace(btrim(v_item ->> 'name'), '\s+', ' ', 'g');
        v_category := btrim(v_item ->> 'category');
        v_size_value := NULLIF(v_item ->> 'size_value', '')::NUMERIC;
        v_size_unit := NULLIF(btrim(v_item ->> 'size_unit'), '');
        v_pieces_per_carton := NULLIF(v_item ->> 'pieces_per_carton', '')::NUMERIC;
        v_packets_per_box := NULLIF(v_item ->> 'packets_per_box', '')::NUMERIC;
        v_bag_weight := NULLIF(v_item ->> 'bag_weight', '')::NUMERIC;
        v_cost_price := NULLIF(v_item ->> 'cost_price', '')::NUMERIC(12,2);
        v_sell_price := NULLIF(v_item ->> 'sell_price', '')::NUMERIC(12,2);
        v_carton_sell_price := NULLIF(v_item ->> 'carton_sell_price', '')::NUMERIC(12,2);
        v_new_qty := NULLIF(v_item ->> 'stock_qty', '')::NUMERIC(12,3);
        v_receipt_total := v_receipt_total + COALESCE(v_cost_price, 0) * COALESCE(v_new_qty, 0);

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
               SET stock_qty = COALESCE(stock_qty, 0) + COALESCE(v_new_qty, 0),
                   cost_price = v_cost_price,
                   sell_price = v_sell_price,
                   carton_sell_price = v_carton_sell_price
             WHERE id = v_product_id;
        ELSE
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
$function$;
