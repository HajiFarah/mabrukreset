import { db } from '../supabase.js';

export async function getProducts(filters = {}) {
  let query = db.from('products').select('*');

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.search) query = query.ilike('name', `%${filters.search}%`);

  const result = await query.order('name');
  if (result.error) console.error('[getProducts]', result.error);
  return result;
}

export async function updateProduct(id, fields) {
  const { error } = await db
    .from('products')
    .update(fields)
    .eq('id', id);

  if (error) console.error('[updateProduct]', error);
  return { error };
}

export async function deleteProduct(id) {
  const { error } = await db.rpc('delete_product', { p_id: id });
  if (error) console.error('[deleteProduct]', error);
  return { error };
}

export async function deleteReceipt(receiptId) {
  const { data, error } = await db.rpc('delete_receipt', {
    p_receipt_id: receiptId,
  });
  if (error) console.error('[deleteReceipt]', error);
  return { data, error };
}

export async function saveReceipt(supplierName, supplierPhone, date, note, items) {
  const { data, error } = await db.rpc('save_receipt', {
    p_supplier_name: supplierName,
    p_supplier_phone: supplierPhone,
    p_receipt_date: date,
    p_note: note,
    p_items: items,
  });
  if (error) console.error('[saveReceipt]', error);
  return { data, error };
}