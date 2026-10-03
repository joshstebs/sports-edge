/** Resolve user dates on the Toronto calendar, independently of model guesses. */
export function resolveSlateDate(text: string, now = new Date()): { date: string; searchUpcoming: boolean } {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const day = new Date(today + 'T12:00:00Z');
  const explicit = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (explicit && !Number.isNaN(Date.parse(explicit))) return { date: explicit, searchUpcoming: false };
  if (/\btomorrow\b/i.test(text)) day.setUTCDate(day.getUTCDate() + 1);
  else if (/\b(?:today|tonight)\b/i.test(text)) return { date: today, searchUpcoming: false };
  else {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekday = text.toLowerCase().match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[1];
    if (!weekday) return { date: today, searchUpcoming: true };
    day.setUTCDate(day.getUTCDate() + (weekdays.indexOf(weekday) - day.getUTCDay() + 7) % 7);
  }
  return { date: day.toISOString().slice(0, 10), searchUpcoming: false };
}
