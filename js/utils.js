export function fmtKES(n) {
  return `KES ${new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(Number(n) || 0))}`;
}

export function today() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function genId() {
  return `tmp_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function dateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateRangeFor(period) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);

  switch (period) {
    case 'today':
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case 'this_week': {
      const daysSinceMonday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - daysSinceMonday);
      break;
    }
    case 'last_week': {
      const daysSinceMonday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - daysSinceMonday - 7);
      end.setDate(end.getDate() - daysSinceMonday - 1);
      break;
    }
    case 'this_month':
      start.setDate(1);
      break;
    case '3_months':
      start.setMonth(start.getMonth() - 3);
      break;
    case '1_year':
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      throw new RangeError(`Unsupported period: ${period}`);
  }

  return { from: dateString(start), to: dateString(end) };
}
