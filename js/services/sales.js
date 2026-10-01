import { db } from '../supabase.js';

export async function createSale(clientName, clientPhone, items, paidCash, paidMpesa) {
  const { data, error } = await db.rpc('create_sale', {
    p_client_name: clientName,
    p_client_phone: clientPhone,
    p_items: items,
    p_paid_cash: paidCash,
    p_paid_mpesa: paidMpesa,
  });
  if (error) console.error('[createSale]', error);
  return { data, error };
}

export async function getSales(from, to) {
  const result = await db
    .from('sales')
    .select('*, sale_items(*)')
    .gte('created_at', from)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at', { ascending: false });
  if (result.error) console.error('[getSales]', result.error);
  return result;
}

export async function getSaleById(id) {
  const result = await db
    .from('sales')
    .select('*, sale_items(*)')
    .eq('id', id)
    .single();
  if (result.error) console.error('[getSaleById]', result.error);
  return result;
}

export async function processReturn(saleId, type, items, method) {
  const { data, error } = await db.rpc('process_return', {
    p_sale_id: saleId,
    p_type: type,
    p_items: items,
    p_method: method,
  });
  if (error) console.error('[processReturn]', error);
  return { data, error };
}