import { DateTime } from 'luxon';
import { config } from '../config.js';

const WD: Record<string, number> = {
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 7, sunday: 7,
};

export function parseWhenHuman(input?: string) {
  if (!input) return { unix: undefined, canonical: undefined };

  const zone = config.tzDefault;
  const now = DateTime.now().setZone(zone);
  const s = input.trim().toLowerCase();

  let dt: DateTime | null = null;

  // 1) ISO-like
  if (!dt) {
    const iso = DateTime.fromISO(input, { zone });
    if (iso.isValid) dt = iso;
  }

  // 2) YYYY-MM-DD HH:mm
  if (!dt) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const [ , y, mo, d, h, mi ] = m.map(Number) as unknown as number[];
      dt = DateTime.fromObject({ year: y, month: mo, day: d, hour: h, minute: mi }, { zone });
    }
  }

  // 3) today HH:mm
  if (!dt) {
    const m = s.match(/^today\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const [, h, mi] = m.map(Number) as unknown as number[];
      dt = now.set({ hour: h, minute: mi, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
    }
  }

  // 4) tomorrow HH:mm
  if (!dt) {
    const m = s.match(/^tomorrow\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const [, h, mi] = m.map(Number) as unknown as number[];
      dt = now.plus({ days: 1 }).set({ hour: h, minute: mi, second: 0, millisecond: 0 });
    }
  }

  // 5) weekday HH:mm (mon 20:00, friday 21:30)
  if (!dt) {
    const m = s.match(/^([a-z]+)\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const wd = WD[m[1]];
      if (wd) {
        const h = Number(m[2]); const mi = Number(m[3]);
        const todayWD = now.weekday; // 1..7
        let delta = (wd - todayWD + 7) % 7;
        let candidate = now.plus({ days: delta }).set({ hour: h, minute: mi, second: 0, millisecond: 0 });
        if (delta === 0 && candidate <= now) candidate = candidate.plus({ days: 7 });
        dt = candidate;
      }
    }
  }

  // 6) HH:mm (next occurrence)
  if (!dt) {
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      const h = Number(m[1]); const mi = Number(m[2]);
      dt = now.set({ hour: h, minute: mi, second: 0, millisecond: 0 });
      if (dt <= now) dt = dt.plus({ days: 1 });
    }
  }

  if (!dt || !dt.isValid) return { unix: undefined, canonical: input };

  return {
    unix: Math.floor(dt.toSeconds()),
    canonical: dt.toFormat('yyyy-LL-dd HH:mm'),
  };
}
