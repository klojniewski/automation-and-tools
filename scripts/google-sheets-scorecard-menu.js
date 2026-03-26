// Google Apps Script for Scorecard spreadsheet
// Install: Extensions → Apps Script → paste this → Save → Reload spreadsheet
//
// Adds a "Scorecard" menu with options to trigger data refresh via Trigger.dev API.
// Requires TRIGGER_API_KEY to be set below.

// ---- CONFIG ----
const TRIGGER_API_KEY = 'tr_dev_XXXX'; // Your Trigger.dev secret key
const TRIGGER_API_URL = 'https://api.trigger.dev/api/v1/tasks/update-scorecard/trigger';

// ---- MENU ----
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Scorecard')
    .addItem('Refresh last week', 'refreshLastWeek')
    .addItem('Refresh this week', 'refreshThisWeek')
    .addItem('Refresh specific week…', 'refreshPrompt')
    .addToUi();
}

// ---- HELPERS ----
function getWeekInfo(date) {
  var oneJan = new Date(date.getFullYear(), 0, 1);
  var days = Math.floor((date - oneJan) / 86400000);
  var weekNum = Math.ceil((days + oneJan.getDay() + 1) / 7);
  var yy = String(date.getFullYear()).slice(-2);
  var yyww = yy + String(weekNum).padStart(2, '0');

  // Find Monday of this week
  var day = date.getDay();
  var diffToMon = (day === 0 ? -6 : 1) - day;
  var monday = new Date(date);
  monday.setDate(date.getDate() + diffToMon);
  var friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  return { yyww: yyww, weekNum: weekNum, monday: monday, friday: friday };
}

function formatDate(d) {
  var dd = String(d.getDate()).padStart(2, '0');
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var yyyy = d.getFullYear();
  return dd + '.' + mm + '.' + yyyy;
}

// ---- ACTIONS ----
function refreshThisWeek() {
  var info = getWeekInfo(new Date());
  triggerRefetch(info);
}

function refreshLastWeek() {
  var d = new Date();
  d.setDate(d.getDate() - 7);
  triggerRefetch(getWeekInfo(d));
}

function refreshPrompt() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt('Refresh Scorecard', 'Enter week (YYWW format, e.g. 2612):', ui.ButtonSet.OK_CANCEL);
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var week = result.getResponseText().trim();
  if (!/^\d{4}$/.test(week)) {
    ui.alert('Invalid week format. Use YYWW (e.g. 2612).');
    return;
  }
  // Reconstruct date from YYWW to get the range
  var yy = parseInt(week.slice(0, 2), 10);
  var ww = parseInt(week.slice(2, 4), 10);
  var year = 2000 + yy;
  var jan1 = new Date(year, 0, 1);
  var approxDate = new Date(jan1);
  approxDate.setDate(jan1.getDate() + (ww - 1) * 7);
  triggerRefetch(getWeekInfo(approxDate));
}

// ---- TRIGGER.DEV API ----
function triggerRefetch(info) {
  var ui = SpreadsheetApp.getUi();
  try {
    var response = UrlFetchApp.fetch(TRIGGER_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + TRIGGER_API_KEY },
      payload: JSON.stringify({ payload: { week: info.yyww } }),
    });
    var data = JSON.parse(response.getContentText());
    ui.alert(
      'Refetch triggered for week ' + info.weekNum + ' (' + formatDate(info.monday) + ' - ' + formatDate(info.friday) + ').\n\n' +
      'Data in AUTOMATED_STATS sheet will be updated in ~10 seconds.'
    );
  } catch (e) {
    ui.alert('Error triggering refresh:\n' + e.message);
  }
}
