import { db } from '../supabase.js';

export async function getCredits() {
  const result = await db
    .from('sales')
    .select('id, client_name, client_phone, total, paid_cash, paid_mpesa, balance, status, created_at')
    .in('status', ['credit', 'settled'])
    .order('created_at', { ascending: false });
  if (result.error) console.error('[getCredits]', result.error);
  return result;
}

export async function getCreditPayments(saleId) {
  const result = await db
    .from('credit_payments')
    .select('*')
    .eq('sale_id', saleId)
    .order('created_at');
  if (result.error) console.error('[getCreditPayments]', result.error);
  return result;
}

export async function settleCredit(saleId, amount, method) {
  const { data, error } = await db.rpc('settle_credit', {
    p_sale_id: saleId,
    p_amount: amount,
    p_method: method,
  });
  if (error) console.error('[settleCredit]', error);
  return { data, error };
}