// Render stored rounds back out as a printable Science Bowl packet.
//
// Uploaded packets are parsed into structured questions, which is what the app
// plays from — but that structure is unreadable if you want a paper copy to
// moderate from. This rebuilds the moderator layout (TOSS-UP / BONUS, subject
// and format on the question line, choices lettered W–Z, ANSWER underneath)
// and hands it to the browser's print pipeline, where "Save as PDF" produces
// the file. Printing rather than generating PDF bytes ourselves keeps real
// typography and pagination without pulling in a PDF library.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);

// The document is assembled as a string, so anything interpolated into it must
// be escaped — packet text is arbitrary uploaded content.
function questionHtml(q, number) {
  const kind = q.type === 'BONUS' ? 'BONUS' : 'TOSS-UP';
  const meta = [q.subject, q.format].filter(Boolean).map(esc).join(' &ndash; ');
  const choices = ['W', 'X', 'Y', 'Z']
    .filter(l => q.choices?.[l])
    .map(l => `<div class="choice"><span class="letter">${l})</span> ${esc(q.choices[l])}</div>`)
    .join('');
  const alternates = q.answer_alternates?.length
    ? `<div class="alt">(accept: ${esc(q.answer_alternates.join('; '))})</div>`
    : '';

  return `
    <div class="q">
      <div class="kind">${kind}</div>
      <div class="body">
        <span class="num">${esc(number)})</span>
        ${meta ? `<span class="meta">${meta}</span>` : ''}
        <span class="text">${esc(q.question_text)}</span>
      </div>
      ${choices ? `<div class="choices">${choices}</div>` : ''}
      <div class="answer"><span class="answer-label">ANSWER:</span> ${esc(q.answer)}</div>
      ${alternates}
    </div>`;
}

function roundHtml(round) {
  const questions = round.questions || [];
  // Packets number the tossup and its bonus together; fall back to a running
  // tossup count when the parsed question carries no number of its own.
  let tossupCount = 0;
  const body = questions.map(q => {
    if (q.type !== 'BONUS') tossupCount++;
    return questionHtml(q, q.number ?? tossupCount);
  }).join('');

  const subtitle = [round.source, round.year].filter(Boolean).map(esc).join(' &middot; ');
  const tossups = questions.filter(q => q.type !== 'BONUS').length;
  const bonuses = questions.length - tossups;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return `
    <section class="round">
      <header class="round-header">
        <h1>${esc(round.title || 'Untitled Round')}</h1>
        ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
        <p class="counts">
          ${count(tossups, 'toss-up', 'toss-ups')} &middot; ${count(bonuses, 'bonus', 'bonuses')}
        </p>
      </header>
      ${body || '<p class="empty">This round has no parsed questions.</p>'}
    </section>`;
}

export function buildPacketHtml(rounds, { documentTitle } = {}) {
  const list = (Array.isArray(rounds) ? rounds : [rounds]).filter(Boolean);
  const title = documentTitle || (list.length === 1 ? list[0].title : 'Science Bowl Packets');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  /* Inter, the same face the app is set in (src/index.css) — a packet exported
     from here should read like the app it came from. The stack behind it is a
     system sans, so a print with no network still lays out sanely. */
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  @page { size: letter; margin: 0.75in; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.4;
    color: #000;
    margin: 0;
  }
  /* Each packet starts its own page, the way a printed set is handed out. */
  .round + .round { break-before: page; page-break-before: always; }
  .round-header { text-align: center; margin-bottom: 20px; }
  .round-header h1 { font-size: 14pt; font-weight: 700; margin: 0 0 3px; text-transform: uppercase; letter-spacing: 0.03em; }
  .subtitle, .counts { margin: 0; font-size: 9.5pt; }
  .counts { color: #444; }
  /* A question splitting across a page break is the thing that makes a printed
     packet unusable, so each one is kept whole. */
  .q { margin-bottom: 13px; break-inside: avoid; page-break-inside: avoid; }
  .kind { font-weight: 700; font-size: 9.5pt; letter-spacing: 0.08em; }
  .body { margin-top: 1px; }
  .num { font-weight: 700; }
  /* Uppercased rather than small-caps: Inter has no true small-cap face, so the
     browser would synthesize one and it prints badly. */
  .meta { text-transform: uppercase; font-weight: 600; font-size: 9pt; letter-spacing: 0.04em; margin-right: 3px; }
  .choices { margin: 3px 0 0 22px; }
  .choice { margin-bottom: 1px; }
  .letter { font-weight: 700; }
  .answer { margin-top: 3px; margin-left: 22px; font-weight: 600; }
  .answer-label { letter-spacing: 0.05em; font-weight: 700; }
  .alt { margin-left: 22px; font-size: 9pt; font-style: italic; }
  .empty { font-style: italic; color: #555; }
</style>
</head>
<body>
${list.map(roundHtml).join('\n')}
</body>
</html>`;
}

/**
 * Open the browser's print dialog on a packet document — "Save as PDF" there
 * writes the file. Prints from a hidden iframe rather than a popup so it isn't
 * swallowed by a popup blocker.
 *
 * @param rounds  One round, or several (each starts a new page).
 * @returns true once printing has been handed to the browser.
 */
export function exportRoundsAsPdf(rounds, { documentTitle } = {}) {
  const list = (Array.isArray(rounds) ? rounds : [rounds]).filter(Boolean);
  if (list.length === 0) return false;

  const html = buildPacketHtml(list, { documentTitle });
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);

  const cleanup = () => frame.remove();

  let printed = false;
  const print = () => {
    if (printed) return;
    printed = true;
    const win = frame.contentWindow;
    if (!win) { cleanup(); return; }
    // The print dialog is modal, but not reliably synchronous across browsers,
    // so tear the frame down on afterprint and keep a timer as a backstop for
    // the ones that never fire it.
    win.addEventListener?.('afterprint', cleanup);
    const open = () => {
      win.focus();
      win.print();
      setTimeout(cleanup, 60000);
    };
    // Print once the webfont has actually loaded, or the pages are laid out in
    // the fallback face and then measured against it. Capped, so a blocked or
    // offline font request still prints rather than hanging the button.
    const fonts = win.document?.fonts;
    if (fonts?.ready) Promise.race([fonts.ready, new Promise(r => setTimeout(r, 1500))]).then(open);
    else open();
  };

  frame.onload = () => setTimeout(print, 60);

  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  // Backstop: a document written this way doesn't fire load in every browser,
  // and a missing dialog reads as a broken button.
  setTimeout(print, 600);
  return true;
}
