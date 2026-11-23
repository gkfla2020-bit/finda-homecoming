/**
 * FIND-A 홈커밍데이 참석 응답을 이 스프레드시트에 저장합니다.
 *
 * 설치
 * 1. 응답을 모을 Google 스프레드시트에서 [확장 프로그램 → Apps Script]를 엽니다.
 * 2. 기본 코드를 지우고 이 파일 내용을 붙여 넣은 뒤 저장합니다.
 * 3. [배포 → 새 배포 → 유형: 웹 앱]을 고르고
 *    실행 사용자: 나 / 액세스 권한이 있는 사용자: 모든 사용자 로 배포합니다.
 * 4. 표시되는 웹 앱 URL(…/exec)을 초대장 app.js의 CONFIG.endpoint에 넣습니다.
 *
 * 같은 연락처로 다시 제출하면 새 줄을 만들지 않고 기존 응답을 고칩니다.
 */

const SHEET_NAME = '참석응답';
const SUMMARY_NAME = '요약';
const HEADERS = ['제출 시각', '최종 수정', '참석 여부', '이름', '연락처', '개인정보 동의', '다음 행사 안내', '제출 ID'];
const PHONE_COL = 5;
const ID_COL = 8;

function doGet() {
  return json({ ok: true, service: 'finda-homecoming-rsvp' });
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.website) return json({ ok: true }); // 사람에게는 보이지 않는 칸: 봇만 채운다

  const attendance = { yes: '참석', no: '미참석' }[p.attendance];
  const name = clean(p.name, 40);
  const phone = String(p.phone || '').replace(/\D/g, '');
  const id = clean(p.id, 64);
  if (!attendance || !name || !id || p.consent !== 'true') return json({ ok: false, error: 'invalid' });
  if (phone && !/^0\d{8,10}$/.test(phone)) return json({ ok: false, error: 'invalid_phone' });
  const marketing = p.marketing === 'true' ? 'Y' : 'N';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json({ ok: false, error: 'busy' });
  try {
    const sheet = getSheet();
    const last = sheet.getLastRow();
    const rows = last > 1 ? sheet.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];

    // 같은 제출을 다시 보낸 경우(네트워크 재시도): 아무것도 바꾸지 않는다.
    if (rows.some((row) => row[ID_COL - 1] === id)) return json({ ok: true, duplicate: true });

    const now = new Date();
    const values = [attendance, safe(name), phone ? "'" + phone : '', 'Y', marketing, id];
    const found = phone ? rows.findIndex((row) => String(row[PHONE_COL - 1]).replace(/\D/g, '') === phone) : -1;
    if (found >= 0) {
      sheet.getRange(found + 2, 2, 1, values.length + 1).setValues([[now].concat(values)]);
      return json({ ok: true, updated: true });
    }
    sheet.appendRow([now, now].concat(values));
    return json({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}

/** 처음 한 번 실행해 두면 시트와 요약 탭을 미리 만들어 둡니다. 실행하지 않아도 첫 응답 때 자동으로 만들어집니다. */
function setup() {
  getSheet();
}

function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (sheet) return sheet;

  sheet = book.insertSheet(SHEET_NAME, 0);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.getRange('A:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange('E:E').setNumberFormat('@');
  sheet.setColumnWidths(1, 2, 150);
  sheet.setColumnWidth(ID_COL, 260);

  if (!book.getSheetByName(SUMMARY_NAME)) {
    const summary = book.insertSheet(SUMMARY_NAME, 1);
    const range = `'${SHEET_NAME}'!C2:C`;
    summary.getRange(1, 1, 3, 2).setValues([
      ['참석', `=COUNTIF(${range},"참석")`],
      ['미참석', `=COUNTIF(${range},"미참석")`],
      ['전체 응답', `=COUNTA(${range})`],
    ]);
    summary.getRange('A1:A3').setFontWeight('bold');
  }
  return sheet;
}

function clean(value, max) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

/** =, +, -, @ 로 시작하는 값이 수식으로 실행되지 않게 글자로 저장합니다. */
function safe(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function json(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
