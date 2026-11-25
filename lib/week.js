// Yayın saatleri Europe/Istanbul (yaz saati yok, UTC+3).
const TZ = 'Europe/Istanbul';

export function istanbulParts(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`};
}

export function weekBounds(now = Date.now()) {
  const start = Date.parse(`${istanbulParts(now).date}T00:00:00+03:00`);
  return {start, end: start + 7 * 86400000};
}

export function groupAiring(rows, now = Date.now()) {
  const days = [];
  for (const row of [...rows].sort((a, b) => a.at - b.at)) {
    let day = days.find(d => d.date === row.date);
    if (!day) {
      day = {date: row.date, items: []};
      days.push(day);
    }
    day.items.push({...row, past: row.at < now});
  }
  return days;
}
