import { db } from '../supabase.js';
import { today } from '../utils.js';

const endOfDay = (date) => `${date}T23:59:59`;

export async function getFinancialSummary(from, to) {
  const [salesResult, itemsResult, returnsResult] = await Promise.all([
    db
      .from('sales')
      .select('total, paid_cash, paid_mpesa, balance, status')
      .gte('created_at', from)
      .lte('created_at', endOfDay(to)),
    db
      .from('sale_items')
      .select('qty, unit_cost, sale:sales!inner(created_at)')
      .gte('sale.created_at', from)
      .lte('sale.created_at', endOfDay(to)),
    db
      .from('returns')
      .select('cash_in, cash_out')
      .gte('created_at', from)
      .lte('created_at', endOfDay(to)),
  ]);

  const error = salesResult.error || itemsResult.error || returnsResult.error || null;
  if (error) console.error('[getFinancialSummary]', error);
  const sales = salesResult.data ?? [];
  const saleItems = itemsResult.data ?? [];
  const returns = returnsResult.data ?? [];

  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cogs = saleItems.reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.unit_cost || 0),
    0,
  );
  const cashIn = returns.reduce((sum, item) => sum + Number(item.cash_in || 0), 0);
  const cashOut = returns.reduce((sum, item) => sum + Number(item.cash_out || 0), 0);
  const outstandingCredit = sales.reduce(
    (sum, sale) => sum + (sale.status === 'credit' ? Number(sale.balance || 0) : 0),
    0,
  );

  return {
    revenue,
    cogs,
    profit: revenue - cogs + cashIn - cashOut,
    outstandingCredit,
    error,
  };
}

export async function getDailyBreakdown(from, to) {
  const { data, error } = await db
    .from('sales')
    .select('total, created_at, sale_items(qty, unit_price, unit_cost)')
    .gte('created_at', from)
    .lte('created_at', endOfDay(to));

  if (error) { console.error('[getDailyBreakdown]', error); return []; }

  const totalsByDate = new Map();
  for (const sale of data ?? []) {
    const date = sale.created_at.slice(0, 10);
    const totals = totalsByDate.get(date) ?? { revenue: 0, profit: 0 };
    totals.revenue += Number(sale.total || 0);
    totals.profit += (sale.sale_items ?? []).reduce(
      (sum, item) => sum + (Number(item.unit_price || 0) - Number(item.unit_cost || 0)) * Number(item.qty || 0),
      0,
    );
    totalsByDate.set(date, totals);
  }

  return [...totalsByDate]
    .map(([date, totals]) => ({ date, ...totals }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function closeDay(date, actualCash, actualMpesa) {
  const { error } = await db.rpc('close_day', {
    p_date: date,
    p_actual_cash: actualCash,
    p_actual_mpesa: actualMpesa,
  });
  if (error) console.error('[closeDay]', error);
  return { error };
}

export async function getDayClosings() {
  return await db
    .from('day_closings')
    .select('*')
    .order('closing_date', { ascending: false });
}

export async function getTodayExpected() {
  const date = today();
  const start = `${date}T00:00:00`;
  const end = endOfDay(date);

  const [salesResult, paymentsResult, returnsResult] = await Promise.all([
    db
      .from('sales')
      .select('paid_cash, paid_mpesa')
      .gte('created_at', start)
      .lte('created_at', end),
    db
      .from('credit_payments')
      .select('amount, method')
      .gte('created_at', start)
      .lte('created_at', end),
    db
      .from('returns')
      .select('cash_in, cash_out')
      .gte('created_at', start)
      .lte('created_at', end),
  ]);

  const sales = salesResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const returns = returnsResult.data ?? [];
  const saleCash = sales.reduce((sum, sale) => sum + Number(sale.paid_cash || 0), 0);
  const saleMpesa = sales.reduce((sum, sale) => sum + Number(sale.paid_mpesa || 0), 0);
  const creditCash = payments.reduce(
    (sum, payment) => sum + (payment.method === 'cash' ? Number(payment.amount || 0) : 0),
    0,
  );
  const creditMpesa = payments.reduce(
    (sum, payment) => sum + (payment.method === 'mpesa' ? Number(payment.amount || 0) : 0),
    0,
  );
  const returnsIn = returns.reduce((sum, item) => sum + Number(item.cash_in || 0), 0);
  const returnsOut = returns.reduce((sum, item) => sum + Number(item.cash_out || 0), 0);

  return {
    expectedCash: saleCash + creditCash + returnsIn - returnsOut,
    expectedMpesa: saleMpesa + creditMpesa,
  };
}
