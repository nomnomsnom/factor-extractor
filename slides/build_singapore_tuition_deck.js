/* Singapore tuition culture — briefing deck generator */
const pptxgen = require("pptxgenjs");

// ---------- palette: near-monochrome, one muted accent ----------
const PAPER = "FFFFFF";
const INK = "1C1C1E";
const MID = "4E4E55";
const GRAY = "82828A";
const ACCENT = "8A2A2A";

const SERIF = "Cambria";
const SANS = "Calibri";

// ---------- grid ----------
const W = 10, H = 5.625;
const LABEL_X = 0.75, LABEL_W = 1.45;
const COL_X = 2.45, COL_W = 6.8; // right edge 9.25
const TITLE_Y = 0.62;

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Briefing deck";
pres.title = "Tuition in Singapore";

// margin label, set in the left column beside the title
const label = (s, txt) =>
  s.addText(txt, {
    x: LABEL_X, y: TITLE_Y + 0.08, w: LABEL_W, h: 0.3, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 11.5, color: GRAY,
  });

const title = (s, txt) =>
  s.addText(txt, {
    x: COL_X, y: TITLE_Y, w: COL_W, h: 0.55, isTextBox: true, margin: 0,
    valign: "top", fontFace: SERIF, fontSize: 26, bold: true, color: INK,
  });

// the script's own summary sentence, set low on the page — the one repeated device
const closer = (s, txt, y, h) =>
  s.addText(txt, {
    x: COL_X, y: y, w: COL_W - 0.3, h: h || 0.55, isTextBox: true, margin: 0,
    valign: "top", fontFace: SERIF, fontSize: 17, color: INK, lineSpacingMultiple: 1.2,
  });

const folio = (s, n) =>
  s.addText(String(n), {
    x: 8.25, y: 5.0, w: 1.0, h: 0.25, isTextBox: true, margin: 0,
    align: "right", fontFace: SANS, fontSize: 9.5, color: GRAY,
  });

const page = () => {
  const s = pres.addSlide();
  s.background = { color: PAPER };
  return s;
};

// =========================================================
// 1 — Cover
// =========================================================
{
  const s = page();
  s.addText("Tuition in Singapore", {
    x: LABEL_X, y: 3.15, w: 7.0, h: 0.7, isTextBox: true, margin: 0,
    valign: "top", fontFace: SERIF, fontSize: 40, color: INK,
  });
  s.addText("An introduction for visiting educators", {
    x: LABEL_X, y: 3.95, w: 6.0, h: 0.35, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 14.5, color: MID,
  });
  s.addNotes(
    "Good morning. This is a short introduction to Singapore's tuition culture, which is often the first thing visiting educators ask about."
  );
}

// =========================================================
// 2 — Scale
// =========================================================
{
  const s = page();
  label(s, "Scale");
  title(s, "What households spend");

  s.addChart(
    pres.ChartType.bar,
    [{ name: "Spending", labels: ["2013", "2018", "2023"], values: [1.1, 1.4, 1.8] }],
    {
      x: COL_X - 0.12, y: 1.35, w: 4.5, h: 2.6,
      barDir: "col",
      barGapWidthPct: 150,
      chartColors: [ACCENT],
      showTitle: false,
      showValue: true,
      dataLabelPosition: "outEnd",
      dataLabelFormatCode: '0.0',
      dataLabelColor: INK,
      dataLabelFontFace: SANS,
      dataLabelFontSize: 12,
      catAxisLabelColor: MID,
      catAxisLabelFontFace: SANS,
      catAxisLabelFontSize: 11.5,
      catAxisLineShow: false,
      catGridLine: { style: "none" },
      valAxisHidden: true,
      valGridLine: { style: "none" },
      valAxisMaxVal: 2.1,
      showLegend: false,
    }
  );
  s.addText("Household spending on private tuition, $ billions", {
    x: COL_X, y: 4.05, w: 4.3, h: 0.3, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 10.5, color: GRAY,
  });

  const figs = [
    { n: "$105", t: "average monthly spending per household" },
    { n: "4×", t: "what the top income quintile spends, relative to the bottom" },
  ];
  let fy = 1.42;
  figs.forEach((f) => {
    s.addText(f.n, {
      x: 7.15, y: fy, w: 2.1, h: 0.42, isTextBox: true, margin: 0,
      valign: "top", fontFace: SERIF, fontSize: 24, color: ACCENT,
    });
    s.addText(f.t, {
      x: 7.15, y: fy + 0.46, w: 2.1, h: 0.7, isTextBox: true, margin: 0,
      valign: "top", fontFace: SANS, fontSize: 11, color: MID, lineSpacingMultiple: 1.15,
    });
    fy += 1.35;
  });
  s.addText("There are more tuition and enrichment centres than there are schools.", {
    x: 7.15, y: 4.12, w: 2.1, h: 0.8, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 11, color: INK, lineSpacingMultiple: 1.15,
  });

  folio(s, 2);
  s.addNotes(
    "The scale first. In 2023, households in Singapore spent 1.8 billion dollars on private tuition, up from 1.4 billion in 2018 and 1.1 billion in 2013. Average monthly spending per household is about 105 dollars, and the top income quintile spends roughly four times what the bottom quintile does. There are more tuition and enrichment centres than there are schools.\n\nThree points explain the pattern better than the numbers alone."
  );
}

// =========================================================
// 3 — First: the function of tuition
// =========================================================
{
  const s = page();
  label(s, "First");
  title(s, "What tuition is used for");

  const cols = [
    {
      x: COL_X,
      head: "In many systems",
      body: "Supplementary lessons target the students who are behind. Demand falls as results improve.",
    },
    {
      x: 6.1,
      head: "In Singapore",
      body: "A large share of tuition students are already performing well, and lessons are often used to work ahead of the school syllabus.",
    },
  ];
  cols.forEach((c) => {
    s.addText(c.head, {
      x: c.x, y: 1.45, w: 3.15, h: 0.3, isTextBox: true, margin: 0,
      valign: "top", fontFace: SANS, fontSize: 11.5, color: GRAY,
    });
    s.addText(c.body, {
      x: c.x, y: 1.8, w: 3.15, h: 1.5, isTextBox: true, margin: 0,
      valign: "top", fontFace: SANS, fontSize: 14, color: INK, lineSpacingMultiple: 1.25,
    });
  });

  closer(s, "Demand therefore does not fall when results improve.", 3.75);

  folio(s, 3);
  s.addNotes(
    "First, the function of tuition. In many systems, supplementary lessons target students who are behind. In Singapore a large share of tuition students are already performing well, and lessons are often used to work ahead of the school syllabus. Demand therefore does not fall when results improve."
  );
}

// =========================================================
// 4 — Second: the historical basis
// =========================================================
{
  const s = page();
  label(s, "Second");
  title(s, "Where the expectation formed");

  const rows = [
    ["No natural resources.", "A small country whose only usable asset was the capability of its people."],
    ["A deliberate choice.", "Education was positioned as the main mechanism of social mobility."],
    ["A visible payoff.", "In the early decades the link between examinations and employment was direct."],
  ];
  let ry = 1.45;
  rows.forEach((r) => {
    s.addText(
      [
        { text: r[0] + "  ", options: { fontFace: SERIF, bold: true, color: INK } },
        { text: r[1], options: { fontFace: SANS, color: MID } },
      ],
      {
        x: COL_X, y: ry, w: COL_W - 0.4, h: 0.62, isTextBox: true, margin: 0,
        valign: "top", fontSize: 14, lineSpacingMultiple: 1.25,
      }
    );
    ry += 0.78;
  });

  closer(s, "The expectation persisted after the economic conditions changed.", 4.0);

  folio(s, 4);
  s.addNotes(
    "Second, the historical basis. Singapore is small and has no natural resources, and education was deliberately positioned as the main mechanism of social mobility. In the early decades that link between examinations and employment was direct and visible. The expectation persisted after the economic conditions changed."
  );
}

// =========================================================
// 5 — Third: policy and practice
// =========================================================
{
  const s = page();
  label(s, "Third");
  title(s, "Policy and practice");

  s.addText("What the system has removed", {
    x: COL_X, y: 1.45, w: 4.0, h: 0.3, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 11.5, color: GRAY,
  });
  const removed = [
    ["Mid-year examinations, at all levels", 1],
    ["Exact PSLE aggregate scores, now reported in wide bands", 2],
    ["Publicity for top national scorers", 1],
  ];
  let ly = 1.82;
  removed.forEach(([t, lines]) => {
    s.addText("—", {
      x: COL_X, y: ly, w: 0.25, h: 0.3, isTextBox: true, margin: 0,
      valign: "top", fontFace: SANS, fontSize: 14, color: GRAY,
    });
    s.addText(t, {
      x: COL_X + 0.28, y: ly, w: 3.6, h: lines * 0.3 + 0.04, isTextBox: true, margin: 0,
      valign: "top", fontFace: SANS, fontSize: 14, color: INK, lineSpacingMultiple: 1.2,
    });
    ly += lines * 0.3 + 0.26;
  });

  s.addText("Over the same period", {
    x: 6.6, y: 1.45, w: 2.65, h: 0.3, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 11.5, color: GRAY,
  });
  s.addText("$1.4bn → $1.8bn", {
    x: 6.6, y: 1.8, w: 2.65, h: 0.5, isTextBox: true, margin: 0,
    valign: "top", fontFace: SERIF, fontSize: 22, color: ACCENT,
  });
  s.addText("Tuition expenditure has risen while visible differentiation in the system was being reduced.", {
    x: 6.6, y: 2.4, w: 2.65, h: 1.1, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 12.5, color: MID, lineSpacingMultiple: 1.2,
  });

  closer(
    s,
    "One reading is that reducing visible differentiation pushes families to secure an advantage privately instead.",
    4.0,
    0.85
  );

  folio(s, 5);
  s.addNotes(
    "Third, the gap between policy and practice. Mid-year examinations have been removed at all levels. The PSLE now reports achievement in wide bands rather than exact aggregate scores. Top national scorers are no longer publicised. Tuition expenditure has risen across the same period. One reading is that reducing visible differentiation in the system pushes families to secure an advantage privately instead."
  );
}

// =========================================================
// 6 — The trade-off
// =========================================================
{
  const s = page();
  label(s, "Trade-off");
  title(s, "Mainly a question of time");

  const lines = [
    "Attainment is high.",
    "Out-of-school hours are heavily committed.",
    "Students encounter academic ranking early.",
  ];
  let y = 1.6;
  lines.forEach((t) => {
    s.addText(t, {
      x: COL_X, y: y, w: COL_W - 0.4, h: 0.5, isTextBox: true, margin: 0,
      valign: "top", fontFace: SERIF, fontSize: 20, color: INK,
    });
    y += 0.72;
  });

  s.addText("The cost falls on the hours available to a child, not on the results they obtain.", {
    x: COL_X, y: 4.05, w: 6.0, h: 0.5, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 13, color: MID, lineSpacingMultiple: 1.2,
  });

  folio(s, 6);
  s.addNotes(
    "The trade-off is mainly one of time rather than outcomes. Attainment is high, but out-of-school hours are heavily committed, and students encounter academic ranking early."
  );
}

// =========================================================
// 7 — The open question
// =========================================================
{
  const s = page();
  label(s, "Open question");

  s.addText("What keeps this dynamic from forming elsewhere?", {
    x: COL_X, y: 1.45, w: 6.4, h: 1.4, isTextBox: true, margin: 0,
    valign: "top", fontFace: SERIF, fontSize: 30, color: INK, lineSpacingMultiple: 1.12,
  });
  s.addText("The answer appears to lie less in examination design than in parental expectations.", {
    x: COL_X, y: 3.15, w: 5.8, h: 0.8, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 15, color: MID, lineSpacingMultiple: 1.25,
  });
  s.addText("This is the comparison worth making across systems.", {
    x: COL_X, y: 4.15, w: 5.8, h: 0.35, isTextBox: true, margin: 0,
    valign: "top", fontFace: SANS, fontSize: 12.5, color: GRAY,
  });

  folio(s, 7);
  s.addNotes(
    "The open question, and the one worth comparing across systems, is what keeps this dynamic from forming elsewhere. The answer appears to lie less in examination design than in parental expectations.\n\nThank you."
  );
}

pres.writeFile({ fileName: process.argv[2] || "singapore-tuition-culture.pptx" })
  .then(() => console.log("written"));
