-- Fix delete_receipt to auto-remove orphaned suppliers.
-- When a receipt is deleted and the supplier has no remaining receipts
-- and no products linked to them, the supplier row is also removed.

CREATE OR REPLACE FUNCTION public.delete_receipt(p_receipt_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_item RECORD;
    v_prod RECORD;
    v_stock NUMERIC;
    v_name TEXT;
    v_next_receipt UUID;
    v_next_supplier UUID;
    v_deleted_count INT := 0;
    v_receipt_supplier_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

    IF NOT EXISTS (SELECT 1 FROM receipts WHERE id = p_receipt_id) THEN
        RAISE EXCEPTION 'Receipt not found';
    END IF;

    -- Capture supplier before the receipt row is gone
    SELECT supplier_id INTO v_receipt_supplier_id FROM receipts WHERE id = p_receipt_id;

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

    -- Auto-cleanup: remove supplier if they have no remaining receipts and no products
    IF v_receipt_supplier_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM receipts WHERE supplier_id = v_receipt_supplier_id)
           AND NOT EXISTS (SELECT 1 FROM products WHERE supplier_id = v_receipt_supplier_id) THEN
            DELETE FROM suppliers WHERE id = v_receipt_supplier_id;
        END IF;
    END IF;

    RETURN v_deleted_count;
END;
$$;
