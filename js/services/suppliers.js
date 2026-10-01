import { db } from '../supabase.js';

export async function getSuppliers() {
  const result = await db
    .from('suppliers')
    .select('*')
    .order('name');
  if (result.error) console.error('[getSuppliers]', result.error);
  return result;
}

export async function getSupplierWithReceipts(id) {
  const { data: supplier, error: supplierError } = await db
    .from('suppliers')
    .select('*')
    .eq('id', id)
    .single();

  if (supplierError) {
    console.error('[getSupplierWithReceipts] supplier', supplierError);
    return { error: supplierError };
  }

  const { data: receipts, error: receiptsError } = await db
    .from('receipts')
    .select('*, receipt_items(*)')
    .eq('supplier_id', id)
    .order('receipt_date', { ascending: false });

  if (receiptsError) {
    console.error('[getSupplierWithReceipts] receipts', receiptsError);
    return { error: receiptsError };
  }

  receipts?.forEach((receipt) => {
    receipt.receipt_items?.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  });

  return { supplier, receipts };
}
