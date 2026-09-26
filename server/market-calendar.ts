import { DateTime } from 'luxon';

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: 'America/New_York' });
  return first.plus({ days: ((weekday - first.weekday + 7) % 7) + (nth - 1) * 7 });
}
function lastWeekday(year: number, month: number, weekday: number) {
  const last = DateTime.fromObject({ year, month, day: 1 }, { zone: 'America/New_York' }).endOf(
    'month',
  );
  return last.minus({ days: (last.weekday - weekday + 7) % 7 });
}
function observed(date: DateTime) {
  if (date.weekday === 6) return date.minus({ days: 1 });
  if (date.weekday === 7) return date.plus({ days: 1 });
  return date;
}
function easter(year: number) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k + 7) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31),
    day = ((h + l - 7 * m + 114) % 31) + 1;
  return DateTime.fromObject({ year, month, day }, { zone: 'America/New_York' });
}
function holidays(year: number) {
  const fixed = (month: number, day: number) =>
    observed(DateTime.fromObject({ year, month, day }, { zone: 'America/New_York' })).toISODate();
  return new Set([
    fixed(1, 1),
    nthWeekday(year, 1, 1, 3).toISODate(),
    nthWeekday(year, 2, 1, 3).toISODate(),
    easter(year).minus({ days: 2 }).toISODate(),
    lastWeekday(year, 5, 1).toISODate(),
    fixed(6, 19),
    fixed(7, 4),
    nthWeekday(year, 9, 1, 1).toISODate(),
    nthWeekday(year, 11, 4, 4).toISODate(),
    fixed(12, 25),
    observed(
      DateTime.fromObject({ year: year + 1, month: 1, day: 1 }, { zone: 'America/New_York' }),
    ).toISODate(),
  ]);
}
export function isTradingDay(day: DateTime) {
  return day.weekday <= 5 && !holidays(day.year).has(day.toISODate());
}
export function marketSchedule(now: DateTime = DateTime.now()) {
  const nyNow = now.setZone('America/New_York');
  let day = nyNow.startOf('day');
  for (let i = 0; i < 15; i++) {
    if (isTradingDay(day)) {
      const open = day.set({ hour: 9, minute: 30 });
      if (open > nyNow)
        return {
          nextOpenAt: open.toUTC().toISO(),
          nextOpenShanghai: open.setZone('Asia/Shanghai').toFormat('yyyy-MM-dd HH:mm'),
          nextOpenNewYork: open.toFormat('yyyy-MM-dd HH:mm ZZZZ'),
          isOpenToday: i === 0,
          calendarNote: '정규 거래 및 통상 휴장일 기준. 임시 휴장·조기 폐장 확인 필요.',
        };
    }
    day = day.plus({ days: 1 });
  }
  throw new Error('다음 거래일을 계산할 수 없습니다.');
}
