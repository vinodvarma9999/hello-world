'use strict';
/*
 * Reads a bank / UPI transaction SMS and pulls out the amount, whether money
 * went out or came in, who it was paid to, the date and the reference number.
 * Everything runs on the device; the SMS text is never stored or sent anywhere.
 */
(function (root) {
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const NUM = '([0-9][0-9,]*(?:\\.[0-9]{1,2})?)';
  const CUR = '(?:\\brs\\.?|\\binr\\b|₹)';

  const toNum = (s) => {
    const n = parseFloat(String(s).replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };

  function findAmount(text) {
    const re = new RegExp(CUR + '\\s*' + NUM, 'gi');
    let m;
    while ((m = re.exec(text))) {
      // Skip "Avl Bal Rs 12,000" style balances and card limits.
      const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
      if (/(bal|balance|limit|avl|available)[\s:.]*$/.test(before) || /(bal|balance|limit)\b[^0-9]{0,12}$/.test(before)) continue;
      const v = toNum(m[1]);
      if (v) return v;
    }
    // "debited by 250.0" (no currency symbol), as SBI UPI messages do.
    m = text.match(new RegExp('\\b(?:debited|credited|spent|paid|sent|withdrawn|deducted)\\s*(?:by|for|of|with|:)?\\s*' + CUR + '?\\s*' + NUM, 'i'));
    return m ? toNum(m[1]) : null;
  }

  const DEBIT = /\b(debited|sent|spent|paid|withdrawn|deducted|purchase[ds]?|transferred|used)\b/i;
  const CREDIT = /\b(credited|received|deposited|refund(?:ed)?|cashback|reversed)\b/i;

  function findType(text) {
    const d = text.search(DEBIT);
    const c = text.search(CREDIT);
    if (c === -1) return 'debit';
    if (d === -1) return 'credit';
    return d < c ? 'debit' : 'credit';
  }

  function validDate(y, m, d) {
    if (y < 100) y += 2000;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (dt > tomorrow || y < 2000) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${y}-${p(m)}-${p(d)}`;
  }

  function findDate(text) {
    let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (m) return validDate(+m[1], +m[2], +m[3]);
    m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})\b/);
    if (m) return validDate(+m[3], +m[2], +m[1]);
    m = text.match(/\b(\d{1,2})[\s\-]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-,]*(\d{4}|\d{2})\b/i);
    if (m) return validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    return null;
  }

  function findRef(text) {
    const m = text.match(/(?:upi\s*ref(?:\s*no)?|ref(?:erence)?\s*(?:no|num(?:ber)?)?|refno|rrn|txn\s*id|transaction\s*id|upi)[\s:.#\-]*([0-9]{6,})/i);
    return m ? m[1] : '';
  }

  function cleanName(raw) {
    if (!raw) return '';
    let s = raw.trim();
    if (s.includes('@')) s = s.split('@')[0];          // swiggy@icici -> swiggy
    s = s.replace(/^(vpa|a\/c|ac|mr\.?|ms\.?|mrs\.?)\s+/i, '');
    s = s.replace(/[0-9]{4,}.*$/, '');                  // drop long digit tails (QR ids)
    s = s.replace(/[0-9]+$/, '');                       // ramesh.kirana2 -> ramesh.kirana
    s = s.replace(/[._\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/[a-z]/i.test(s) || /^x+\d*$/i.test(s)) return '';
    if (s === s.toUpperCase() || s === s.toLowerCase()) {
      s = s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
    return s.slice(0, 30).trim();
  }

  const NAME = "([A-Za-z0-9][A-Za-z0-9 .&@'_\\-\\/*]{1,45}?)";
  const MERCHANT_PATTERNS = [
    new RegExp('\\bupi\\/(?:p2[am]|dr|cr)\\/\\d+\\/([^\\/]{2,40}?)(?:\\/|\\.\\s|$)', 'i'),        // UPI/P2M/1234/SWIGGY
    new RegExp('\\bat\\s+' + NAME + '\\s*(?:\\bon\\b|\\bref|\\bfor\\b|\\bvia\\b|\\btxn|\\.(?:\\s|$)|,|;|$)', 'i'), // card: at AMAZON on ...
    new RegExp('\\btrf\\s+to\\s+' + NAME + '\\s*(?:\\bref|\\bon\\b|\\.(?:\\s|$)|,|$)', 'i'),       // SBI: trf to SWIGGY Refno
    new RegExp(';\\s*' + NAME + '\\s+credited', 'i'),                                              // ICICI: ; SWIGGY credited
    new RegExp('\\b(?:paid\\s+to|to)\\s+(?:vpa\\s+)?' + NAME + '\\s*(?:\\(|\\bon\\b|\\bref|\\bupi\\b|\\bvia\\b|\\.(?:\\s|$)|,|;|$)', 'i'),
    // Card spends ending "... on PVR INOX." (the merchant starts with a letter, unlike a date).
    new RegExp('\\bon\\s+([A-Za-z][A-Za-z0-9 .&\'\\-]{1,40}?)\\s*(?:\\.(?:\\s|$)|$)', 'i'),
  ];
  // Payment-gateway handles that say nothing about who was paid.
  const GENERIC = /^(paytmqr|paytm|bharatpe|phonepe|gpay|googlepay|upi|q\d*|qr|merchant|pos)$/i;
  const CREDIT_FROM = new RegExp('\\b(?:from|by)\\s+(?:vpa\\s+|a\\/c\\s+linked\\s+to\\s+vpa\\s+)?' + NAME + '\\s*(?:\\(|\\bon\\b|\\bref|\\bupi\\b|\\.(?:\\s|$)|,|;|$)', 'i');
  // Phrases that name the user's own account rather than the payee.
  const OWN_ACCOUNT = /\b(your|a\/c|acct|account|bank|card)\b/i;

  function findMerchant(text, type) {
    const patterns = type === 'credit' ? [CREDIT_FROM] : MERCHANT_PATTERNS;
    for (const re of patterns) {
      // Try every match: the first "to"/"on" may name the user's own account or card.
      for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
        if (OWN_ACCOUNT.test(m[1])) continue;
        const name = cleanName(m[1]);
        if (name && !GENERIC.test(name.replace(/\s+/g, ''))) return name;
      }
    }
    return '';
  }

  function parseSms(text) {
    // Line breaks act as sentence ends so a name never runs into the next line.
    const t = String(text || '').replace(/\s*\n+\s*/g, '. ').replace(/\.\.\s/g, '. ').replace(/\s+/g, ' ').trim();
    if (!t) return { ok: false, reason: 'empty' };
    if (/\b(otp|one[\s-]time password|verification code)\b/i.test(t)) return { ok: false, reason: 'otp' };
    if (/\b(has requested|collect request|is due|due date|will be debited|requested money)\b/i.test(t)) {
      return { ok: false, reason: 'notice' };
    }
    const amount = findAmount(t);
    if (!amount) return { ok: false, reason: 'no-amount' };
    const type = findType(t);
    return { ok: true, amount, type, merchant: findMerchant(t, type), date: findDate(t), ref: findRef(t) };
  }

  /* Guess a category id from the payee. Learned choices win over keywords. */
  const KEYWORDS = {
    food: /\b(swiggy|zomato|eatsure|restaurant|cafe|caf[eé]|dominos?|pizza|kfc|mcdonald'?s?|burger|starbucks|chaayos|haldiram|biryani|bakery|food|dhaba|eats?)\b/i,
    groceries: /\b(bigbasket|big basket|blinkit|zepto|instamart|dmart|d mart|jiomart|grofers|supermarket|kirana|reliance fresh|nature'?s basket|ratnadeep|spencers?|milk|dairy|vegetables?)\b/i,
    transport: /\b(uber|ola|rapido|irctc|metro|petrol|diesel|fuel|hpcl|bpcl|iocl|indian oil|bharat petroleum|fastag|redbus|indigo|air india|akasa|vistara|makemytrip|yatra|parking|toll|namma yatri)\b/i,
    shopping: /\b(amazon|flipkart|myntra|ajio|meesho|nykaa|croma|reliance digital|tata cliq|decathlon|ikea|lifestyle|westside|zara|h&m|snapdeal)\b/i,
    bills: /\b(airtel|jio|vodafone|vi india|bsnl|act fibernet|hathway|tata play|dish ?tv|electricity|bescom|tneb|msedcl|tata power|adani|torrent power|bses|water board|gas|indane|bharat gas|hp gas|recharge|broadband|insurance|lic|rent|maintenance|bill ?desk|billdesk)\b/i,
    health: /\b(pharmacy|pharma|apollo|medplus|1mg|pharmeasy|netmeds|hospital|clinic|diagnostics?|lab|dr\.?|doctor|practo|cult ?fit|gym)\b/i,
    fun: /\b(netflix|hotstar|disney|spotify|prime video|youtube|bookmyshow|book my show|pvr|inox|cinepolis|steam|playstation|zee5|sonyliv)\b/i,
  };

  function guessCategory(merchant, text, categoryIds, learned) {
    const has = (id) => categoryIds.includes(id);
    const key = (merchant || '').toLowerCase();
    if (key && learned && learned[key] && has(learned[key])) return learned[key];
    const hay = `${merchant || ''} ${text || ''}`;
    for (const [id, re] of Object.entries(KEYWORDS)) {
      if (has(id) && re.test(merchant || '')) return id;
    }
    for (const [id, re] of Object.entries(KEYWORDS)) {
      if (has(id) && re.test(hay)) return id;
    }
    return has('other') ? 'other' : categoryIds[0];
  }

  const api = { parseSms, guessCategory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpendlySMS = api;
})(typeof window !== 'undefined' ? window : this);
