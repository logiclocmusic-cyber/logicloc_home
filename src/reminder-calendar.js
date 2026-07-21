const CALENDAR_NAME = "Loc's Home 提醒";
const ALARM_DAYS = [90, 30, 7, 1, 0];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function icsStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsDateOnly(iso) {
  return String(iso || '').replace(/-/g, '');
}

function icsNextDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}`;
}

function formatCnDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

export function buildReminderIcs({ id, name, expiry }) {
  const iso = String(expiry || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const uid = `reminder-${id || iso}@logicloc.home`;
  const summary = icsEscape(name || '长期提醒');
  const desc = icsEscape(`Loc's Home 长期提醒 · 有效期 ${formatCnDate(iso)}`);
  const alarms = ALARM_DAYS.map(days => {
    const trigger = days === 0 ? 'PT0S' : `-P${days}D`;
    const label = days === 0
      ? `${name || '事项'} 今天到期`
      : `${name || '事项'} 还有 ${days} 天到期`;
    return [
      'BEGIN:VALARM',
      `TRIGGER:${trigger}`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(label)}`,
      'END:VALARM'
    ].join('\r\n');
  }).join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Loc\'s Home//长期提醒//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsStamp()}`,
    `DTSTART;VALUE=DATE:${icsDateOnly(iso)}`,
    `DTEND;VALUE=DATE:${icsNextDate(iso)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    alarms,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

export function downloadReminderIcs(item) {
  const ics = buildReminderIcs(item);
  if (!ics) return false;
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = String(item?.name || 'reminder').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  a.href = url;
  a.download = `${safeName}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function calendarExportHint() {
  if (window.electronAPI?.addReminderToCalendar) {
    return '将写入 Mac 日历，并设置到期前提醒';
  }
  return '将下载 .ics 文件，双击即可加入 Mac 日历';
}

export { CALENDAR_NAME };
