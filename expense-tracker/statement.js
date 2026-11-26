'use strict';
/*
 * Reads a bank statement (PDF, Excel or CSV) into transactions.
 * Everything happens on the phone: the file is never uploaded anywhere.
 *
 * Works on the table found under a header row such as
 *   ICICI net banking: S No. | Value Date | Transaction Date | Cheque Number | Transaction Remarks | Withdrawal Amount | Deposit Amount | Balance
 *   ICICI e-statement: DATE | MODE | PARTICULARS | DEPOSITS | WITHDRAWALS | BALANCE
 *   HDFC:              Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
 */
(function (root) {
  const SMS = typeof module !== 'undefined' && module.exports ? require('./sms.js') : root.SpendlySMS;

  /* ---------- header detection ---------- */
  function mapHeader(cells) {
    const norm = cells.map((c) => String(c == null ? '' : c).toLowerCase().replace(/\s+/g, ' ').trim());
    const find = (re, not) => norm.findIndex((c) => c && re.test(c) && !(not && not.test(c)));
    let date = find(/^(transaction|txn|tran|trans)\.? ?date|^tran\.? dt/);
    if (date < 0) date = find(/^date$|^date\b/);
    if (date < 0) date = find(/date|\bdt\b/, /value/);
    if (date < 0) date = find(/date|\bdt\b/);
    const remarks = find(/remarks|particulars|narration|description|details/);
    const wd = find(/withdrawal|^debits?\b|debit amount|^dr\.?$/);
    const dep = find(/deposit|^credits?\b|credit amount|^cr\.?$/);
    const amount = find(/^(transaction )?amount|^amt/);
    const drcr = find(/dr ?\/ ?cr|cr ?\/ ?dr|^type$/);
    const bal = find(/balance/);
    const ref = find(/ref|cheque|chq/);
    if (date < 0 || remarks < 0 || (wd < 0 && amount < 0)) return null;
    return { date, remarks, wd, dep, amount, drcr, bal, ref, width: cells.length };
  }

  /* ---------- cell helpers ---------- */
  function num(v) {
    if (typeof v === 'number') return { value: Math.abs(v), side: v < 0 ? 'dr' : '' };
    const s = String(v == null ? '' : v).trim();
    if (!s) return { value: 0, side: '' };
    const side = /\bdr\.?$/i.test(s) ? 'dr' : /\bcr\.?$/i.test(s) ? 'cr' : '';
    const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return { value: m ? Math.abs(parseFloat(m[0])) : 0, side: side || (m && m[0].startsWith('-') ? 'dr' : '') };
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  const pad = (n) => String(n).padStart(2, '0');
  function dateCell(v) {
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial date
      const d = new Date(Math.round((v - 25569) * 864e5));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const s = String(v == null ? '' : v).trim();
    if (!s || s.length > 24) return null;
    return SMS.parseDate(s);
  }
  const text = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  /* ---------- payee from the remarks column ---------- */
  const NOISE = /^(upi|imps|neft|rtgs|mmt|pos|vps|ips|mps|ecom|ach|nach|bil|bpay|inft|onl|int|ib|mob|bil\/onl|na|null|to|from|by|collect|pay|p2a|p2m|dr|cr|ref.*|upi intent|.*\bbank\b.*|bank|icici|hdfc|sbi|axis|kotak|ybl|ibl|axl|okaxis|okicici|oksbi|okhdfcbank|paytm|apl|payment.*|paid .*|sent using.*|transfer.*|txn.*|info.*)$/i;
  const IFSC = /^[a-z]{4}0[a-z0-9]{6}$/i;
  function payee(remarks) {
    const t = text(remarks);
    if (/\b(atm|nfs|cash wdl|cash withdrawal|cwdr)\b/i.test(t) && /wdl|withdraw|atm|cwdr/i.test(t)) return 'Cash withdrawal';
    const parts = t.split(t.includes('/') ? /\s*\/\s*/ : /\s+-\s*|-(?=[A-Za-z])/);
    let vpa = '';
    for (const raw of parts) {
      const p = raw.trim();
      if (p.includes('@')) { vpa = vpa || p; continue; }
      if (p.length < 2 || !/[a-z]/i.test(p) || IFSC.test(p) || NOISE.test(p)) continue;
      if (/\d{5,}/.test(p) || (/\d/.test(p) && /[a-z]/i.test(p) && p.length >= 12 && !/\s/.test(p))) continue; // ids
      const name = SMS.cleanName(p);
      if (name) return name;
    }
    return SMS.cleanName(vpa) || SMS.cleanName(t.slice(0, 30)) || 'Bank transaction';
  }
  function refOf(remarks, refCell) {
    const m = text(remarks).match(/(?:^|\D)(\d{12})(?:\D|$)/); // UPI reference numbers are 12 digits
    if (m) return m[1];
    const r = text(refCell);
    return /^\d{6,}$/.test(r) && !/^0+$/.test(r) ? r : '';
  }

  /*
   * rows: [{ cells: [...strings or values], y? }]. PDF rows carry y (position on the page) so
   * wrapped remarks lines can be attached to the nearest transaction line.
   */
  function readTable(pages) {
    const txs = [];
    let map = null;
    for (const page of pages) {
      const recs = [];
      for (const row of page.rows) {
        const h = mapHeader(row.cells);
        if (h) { map = h; recs.length = 0; recs.push({ kind: 'header' }); continue; }
        if (!map) continue;
        const c = row.cells;
        // The date cell, or failing that any date at the start of a cell left of the remarks
        // (PDFs sometimes merge "Value Date" and "Transaction Date" into one piece of text).
        let date = dateCell(c[map.date]);
        for (let i = 0; !date && i < map.remarks; i++) date = dateCell(text(c[i]).split(' ')[0]);
        if (row.wide) { recs.push({ kind: 'other' }); continue; }
        if (date) {
          // If deposits and withdrawals share one column, the running balance decides the side.
          const shared = map.wd >= 0 && map.wd === map.dep;
          const wd = map.wd >= 0 && !shared ? num(c[map.wd]) : { value: 0 };
          const dep = map.dep >= 0 && !shared ? num(c[map.dep]) : { value: 0 };
          const amt = shared ? num(c[map.wd]) : map.amount >= 0 ? num(c[map.amount]) : { value: 0 };
          const bal = map.bal >= 0 ? num(c[map.bal]) : { value: NaN };
          recs.push({ kind: 'tx', y: row.y, h: row.h, date, before: [], remarks: [text(c[map.remarks])], wd: wd.value, dep: dep.value,
            amt: amt.value, side: (map.drcr >= 0 ? text(c[map.drcr]).toLowerCase() : '') || amt.side,
            bal: bal.value, refCell: map.ref >= 0 ? c[map.ref] : '' });
          continue;
        }
        // A line without a date: wrapped remarks (or wrapped text from another column, e.g. ICICI's
        // MODE column) unless it carries amounts, which makes it a total or summary line.
        const filled = c.map((v, i) => (text(v) ? i : -1)).filter((i) => i >= 0);
        const money = [map.wd, map.dep, map.amount, map.bal].filter((i) => i >= 0);
        if (!filled.length) continue;
        if (filled.some((i) => money.includes(i) && num(c[i]).value)) recs.push({ kind: 'other' });
        else recs.push({ kind: 'cont', y: row.y, h: row.h, text: text(c[map.remarks]) });
      }
      // Attach wrapped remarks to the nearest transaction line (above or below) on the page.
      recs.forEach((r, k) => {
        if (r.kind !== 'cont' || !r.text) return;
        const near = (dir) => {
          for (let j = k + dir; j >= 0 && j < recs.length; j += dir) {
            if (recs[j].kind === 'tx') return j;
            if (recs[j].kind !== 'cont') return -1;
          }
          return -1;
        };
        const prev = near(-1), next = near(1);
        let target = prev;
        if (r.y != null && next >= 0) {
          const dPrev = prev >= 0 ? Math.abs(recs[prev].y - r.y) : Infinity;
          const dNext = Math.abs(recs[next].y - r.y);
          if (dNext < dPrev) target = next;
          const lim = (r.h || 10) * 2.6;
          if (Math.min(dPrev, dNext) > lim) target = -1;
        } else if (r.y != null && prev >= 0 && Math.abs(recs[prev].y - r.y) > (r.h || 10) * 2.6) target = -1;
        if (target < 0) return;
        if (target > k) recs[target].before.push(r.text); else recs[target].remarks.push(r.text);
      });
      for (const r of recs) if (r.kind === 'tx') txs.push(r);
    }

    // Decide debit/credit; the running balance confirms or corrects the column reading.
    const out = [];
    let prevBal = NaN;
    for (const r of txs) {
      let amount = r.wd || r.dep || r.amt;
      let type = r.wd ? 'debit' : r.dep ? 'credit' : /^(dr|d|debit)/.test(r.side) ? 'debit' : /^(cr|c|credit)/.test(r.side) ? 'credit' : '';
      if (amount && !isNaN(prevBal) && !isNaN(r.bal)) {
        if (Math.abs(prevBal - amount - r.bal) < 0.011) type = 'debit';
        else if (Math.abs(prevBal + amount - r.bal) < 0.011) type = 'credit';
      }
      if (!isNaN(r.bal) && r.bal) prevBal = r.bal;
      if (!amount || !type) continue;
      const remarks = r.before.concat(r.remarks).filter(Boolean).join(' ');
      out.push({ date: r.date, amount: round2(amount), type, remarks, merchant: payee(remarks), ref: refOf(remarks, r.refCell) });
    }
    return { found: !!map, transactions: out };
  }

  /* ---------- PDF: text items -> rows of cells aligned to the header ---------- */
  const NUM_TOKEN = /^-?[\d,]+(?:\.\d+)?(?:cr|dr)?$/i;
  const HEAD_WORD = /^(date|deposits?|withdrawals?|balance|debits?|credits?|particulars|remarks|narration|description)$/i;
  // Some PDFs store neighbouring cells as one piece of text ("180.50 1,20,626.00",
  // "DEPOSITS WITHDRAWALS"). Split those, estimating each part's position from its characters.
  function splitItem(it) {
    const words = it.str.trim().split(/\s+/);
    const allNums = words.length > 1 && words.every((w) => NUM_TOKEN.test(w));
    const heads = words.filter((w) => HEAD_WORD.test(w)).length;
    if (!allNums && heads < 2) return [it];
    const per = (it.x1 - it.x0) / Math.max(1, it.str.length);
    const out = [];
    let pos = 0;
    for (const w of words) {
      const at = it.str.indexOf(w, pos);
      out.push({ ...it, str: w, x0: it.x0 + at * per, x1: it.x0 + (at + w.length) * per });
      pos = at + w.length;
    }
    return out;
  }

  function linesFromItems(items) {
    const its = items.filter((i) => i.str && i.str.trim()).map((i) => ({
      str: i.str, x0: i.transform[4], x1: i.transform[4] + (i.width || 0), y: i.transform[5], h: Math.abs(i.transform[3]) || i.height || 8,
    })).flatMap(splitItem).sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const lines = [];
    for (const it of its) {
      const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.h * 0.45));
      if (line) line.items.push(it); else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x0 - b.x0);
      const cells = [];
      for (const it of l.items) {
        const last = cells[cells.length - 1];
        const isNum = (t) => /^[\d,.\-]+(?:\s*(?:cr|dr))?$/i.test(t.trim());
        // Join pieces only when they're a word-space apart, and never join two numbers.
        if (last && it.x0 - last.x1 < Math.max(1.5, it.h * 0.3) && !(isNum(last.text) && isNum(it.str))) { last.text += (it.x0 - last.x1 > it.h * 0.15 ? ' ' : '') + it.str; last.x1 = Math.max(last.x1, it.x1); }
        else cells.push({ text: it.str, x0: it.x0, x1: it.x1 });
      }
      l.cells = cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() }));
    }
    return lines.sort((a, b) => b.y - a.y);
  }

  function mergeLines(a, b) {
    // Header labels that wrap onto two lines ("Withdrawal" / "Amount (INR)").
    const cells = a.cells.map((c) => ({ ...c }));
    for (const c of b.cells) {
      const hit = cells.find((d) => c.x0 < d.x1 + 4 && c.x1 > d.x0 - 4);
      if (hit) { hit.text += ' ' + c.text; hit.x0 = Math.min(hit.x0, c.x0); hit.x1 = Math.max(hit.x1, c.x1); } else cells.push({ ...c });
    }
    return { y: a.y, h: a.h, cells: cells.sort((p, q) => p.x0 - q.x0) };
  }

  function pdfPagesToRows(pagesOfLines) {
    let cols = null; // header columns [{x0,x1,center,text}]
    let learned = null; // where text really starts/ends in each column (headers are often centred)
    const pages = [];
    for (const lines of pagesOfLines) {
      const rows = [];
      const pending = []; // [{line, rowIndex}] assigned after the page is scanned
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        // Column titles often wrap over several lines ("Withdrawal / Amount / (INR )"):
        // try merging up to six tightly spaced lines and keep the merge recognising most columns.
        let best = null, bestScore = 0, bestK = 0, merged = line;
        for (let k = 0; k < 6; k++) {
          if (k > 0) {
            const nxt = lines[i + k];
            if (!nxt || Math.abs(lines[i + k - 1].y - nxt.y) > line.h * 1.3) break;
            if (nxt.cells.some((c) => dateCell(c.text.split(' ')[0]))) break;
            merged = mergeLines(merged, nxt);
          }
          const h = mapHeader(merged.cells.map((c) => c.text));
          if (h) {
            const score = ['date', 'remarks', 'wd', 'dep', 'amount', 'bal', 'ref'].filter((f) => h[f] >= 0).length;
            if (score >= bestScore) { best = merged; bestScore = score; bestK = k; }
          }
        }
        if (best) {
          line = best; i += bestK;
          cols = line.cells.map((c) => ({ ...c, center: (c.x0 + c.x1) / 2 }));
          learned = cols.map(() => ({ x0: [], x1: [] }));
          rows.push({ cells: cols.map((c) => c.text), y: line.y, h: line.h });
          continue;
        }
        if (!cols) continue;
        const row = { cells: cols.map(() => ''), y: line.y, h: line.h, later: [] };
        for (const c of line.cells) {
          let best2 = -1, bestOverlap = 0;
          cols.forEach((col, k) => {
            const overlap = Math.min(c.x1, col.x1) - Math.max(c.x0, col.x0);
            if (overlap > bestOverlap) { bestOverlap = overlap; best2 = k; }
          });
          if (best2 >= 0) {
            row.cells[best2] = row.cells[best2] ? row.cells[best2] + ' ' + c.text : c.text;
            learned[best2].x0.push(c.x0); learned[best2].x1.push(c.x1);
          } else row.later.push(c);
        }
        // Text starting at the page margin, left of every column, is a note or footer, not table data.
        row.wide = line.cells.some((c) => c.x0 < cols[0].center - line.h && (c.x1 - c.x0) > (cols[0].x1 - cols[0].x0) * 3);
        rows.push(row);
        pending.push(row);
      }
      // Text not under any heading: match it to a column whose text starts or ends at the same x.
      const common = (arr) => {
        if (!arr.length) return NaN;
        const counts = {};
        for (const v of arr) { const k = Math.round(v); counts[k] = (counts[k] || 0) + 1; }
        return +Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      };
      if (cols) {
        const starts = learned.map((l) => common(l.x0)), ends = learned.map((l) => common(l.x1));
        for (const row of pending) {
          for (const c of row.later) {
            let k = starts.findIndex((x) => Math.abs(x - c.x0) < 2.5);
            if (k < 0) k = ends.findIndex((x) => Math.abs(x - c.x1) < 2.5);
            if (k < 0) {
              let bestD = Infinity;
              cols.forEach((col, j) => { const d = Math.max(col.x0 - c.x1, c.x0 - col.x1); if (d < bestD) { bestD = d; k = j; } });
            }
            row.cells[k] = row.cells[k] ? row.cells[k] + ' ' + c.text : c.text;
          }
          delete row.later;
        }
      }
      pages.push({ rows });
    }
    return pages;
  }

  async function readPdf(buffer, askPassword) {
    const pdfjsLib = root.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false });
    task.onPassword = (update, reason) => {
      const pw = askPassword(reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD);
      if (pw == null) { task.destroy(); } else update(pw);
    };
    const doc = await task.promise;
    const pagesOfLines = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // Keep each piece of text separate; merged runs can span several columns.
      const content = await page.getTextContent({ disableCombineTextItems: true });
      pagesOfLines.push(linesFromItems(content.items));
    }
    doc.destroy();
    return readTable(pdfPagesToRows(pagesOfLines));
  }

  function readSheetRows(rows) {
    return readTable([{ rows: rows.map((r) => ({ cells: Array.isArray(r) ? r : [] })) }]);
  }

  // Excel (.xls/.xlsx) or CSV via SheetJS. CSV is read as plain text so "01/08/2026" stays
  // day-first (SheetJS would otherwise read it the American way as 8 January).
  function readSheet(buffer, fileName) {
    const XLSX = root.XLSX;
    const isText = /\.(csv|txt)$/i.test(fileName || '');
    const wb = isText
      ? XLSX.read(new TextDecoder().decode(buffer), { type: 'string', raw: true })
      : XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    let best = { found: false, transactions: [] };
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      const res = readSheetRows(rows);
      if (res.transactions.length > best.transactions.length) best = res;
    }
    return best;
  }

  const api = { readTable, readSheetRows, readSheet, readPdf, linesFromItems, pdfPagesToRows, payee, mapHeader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpendlyStatement = api;
})(typeof window !== 'undefined' ? window : this);
