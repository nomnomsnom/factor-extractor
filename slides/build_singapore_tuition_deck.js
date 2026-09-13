/* Singapore tuition culture — briefing deck generator */
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const Fa = require("react-icons/fa");

// ---------- palette ----------
const CHERRY = "990011";
const CHERRY_DK = "6E000C";
const CHERRY_TINT = "F6E8E9";
const NAVY = "2F3C7E";
const BG = "FCF6F5";
const WHITE = "FFFFFF";
const BODY = "55545C";
const BODY_LT = "F0D8DA";

const HEAD_FONT = "Cambria";
const BODY_FONT = "Calibri";

const M = 0.55; // slide margin
const W = 10, H = 5.625;
const CW = W - 2 * M; // 8.9 content width

// ---------- icon rendering ----------
async function icon(Comp, hex) {
  let svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { size: 256 })
  );
  svg = svg.replace(/currentColor/g, "#" + hex);
  const buf = await sharp(Buffer.from(svg), { density: 400 })
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

const softShadow = () => ({
  type: "outer",
  color: "8A6A6C",
  blur: 10,
  offset: 2,
  angle: 90,
  opacity: 0.18,
});

function main(icons) {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625
  pres.author = "Briefing deck";
  pres.title = "Singapore's Tuition Culture";

  // ---- shared helpers ----
  const card = (s, o) =>
    s.addShape(pres.ShapeType.roundRect, {
      x: o.x, y: o.y, w: o.w, h: o.h,
      rectRadius: 0.08,
      fill: { color: o.fill || WHITE },
      line: o.line || { color: o.fill === WHITE || !o.fill ? "EFE2E2" : o.fill, width: 1 },
      shadow: o.shadow === false ? undefined : softShadow(),
    });

  const iconBubble = (s, o) => {
    s.addShape(pres.ShapeType.ellipse, {
      x: o.x, y: o.y, w: o.d, h: o.d,
      fill: { color: o.fill || CHERRY },
      line: { color: o.fill || CHERRY, width: 1 },
    });
    const pad = o.d * 0.28;
    s.addImage({
      data: o.icon,
      x: o.x + pad, y: o.y + pad, w: o.d - 2 * pad, h: o.d - 2 * pad,
    });
  };

  const numberBubble = (s, n, y) => {
    s.addShape(pres.ShapeType.ellipse, {
      x: M, y: y, w: 0.62, h: 0.62,
      fill: { color: CHERRY }, line: { color: CHERRY, width: 1 },
    });
    s.addText(n, {
      x: M, y: y, w: 0.62, h: 0.62, isTextBox: true, margin: 0,
      align: "center", valign: "middle",
      fontFace: HEAD_FONT, fontSize: 19, bold: true, color: WHITE,
    });
  };

  const slideTitle = (s, txt, y) =>
    s.addText(txt, {
      x: 1.32, y: y, w: CW - 0.77, h: 0.62, isTextBox: true, margin: 0,
      valign: "middle", fontFace: HEAD_FONT, fontSize: 28, bold: true, color: NAVY,
    });

  const kicker = (s, txt, o) =>
    s.addText(txt, {
      x: o.x, y: o.y, w: o.w, h: 0.26, isTextBox: true, margin: 0,
      fontFace: BODY_FONT, fontSize: 10.5, bold: true,
      charSpacing: 2.6, color: o.color || CHERRY,
    });

  // =========================================================
  // 1 — Title
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: CHERRY };
    s.addShape(pres.ShapeType.ellipse, {
      x: 6.9, y: -1.15, w: 4.5, h: 4.5,
      fill: { color: WHITE, transparency: 92 }, line: { type: "none" },
    });
    s.addShape(pres.ShapeType.ellipse, {
      x: 7.95, y: 2.55, w: 2.9, h: 2.9,
      fill: { color: WHITE, transparency: 94 }, line: { type: "none" },
    });

    kicker(s, "ORIENTATION BRIEFING", { x: M, y: 1.32, w: 5, color: BODY_LT });
    s.addText("Singapore's\nTuition Culture", {
      x: M, y: 1.72, w: 6.3, h: 1.9, isTextBox: true, margin: 0,
      fontFace: HEAD_FONT, fontSize: 44, bold: true, color: WHITE, lineSpacingMultiple: 1.0,
    });
    s.addText("The question visiting educators ask first — and what the numbers alone do not explain.", {
      x: M, y: 3.72, w: 5.9, h: 0.7, isTextBox: true, margin: 0,
      fontFace: BODY_FONT, fontSize: 15, color: BODY_LT, lineSpacingMultiple: 1.2,
    });
    s.addNotes(
      "Good morning. This is a short introduction to Singapore's tuition culture, which is often the first thing visiting educators ask about."
    );
  }

  // =========================================================
  // 2 — The scale
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: BG };
    kicker(s, "THE SCALE", { x: M, y: 0.42, w: 4 });
    s.addText("Spending has risen without pause", {
      x: M, y: 0.72, w: CW, h: 0.55, isTextBox: true, margin: 0,
      valign: "top", fontFace: HEAD_FONT, fontSize: 28, bold: true, color: NAVY,
    });

    card(s, { x: M, y: 1.5, w: 5.05, h: 3.35 });
    s.addChart(
      pres.ChartType.bar,
      [{ name: "Spending", labels: ["2013", "2018", "2023"], values: [1.1, 1.4, 1.8] }],
      {
        x: M + 0.12, y: 1.62, w: 4.81, h: 3.1,
        barDir: "col",
        barGapWidthPct: 70,
        chartColors: [CHERRY],
        showTitle: true,
        title: "Total household spending on tuition",
        titleColor: NAVY,
        titleFontFace: BODY_FONT,
        titleFontSize: 12,
        showValue: true,
        dataLabelPosition: "outEnd",
        dataLabelFormatCode: '$0.0"B"',
        dataLabelColor: NAVY,
        dataLabelFontFace: BODY_FONT,
        dataLabelFontSize: 13,
        dataLabelFontBold: true,
        catAxisLabelColor: BODY,
        catAxisLabelFontFace: BODY_FONT,
        catAxisLabelFontSize: 12,
        catAxisLineShow: false,
        catGridLine: { style: "none" },
        valAxisHidden: true,
        valGridLine: { style: "none" },
        valAxisMaxVal: 2.2,
        showLegend: false,
      }
    );

    const stats = [
      { big: "$105", sub: "average monthly spend on tuition per household" },
      { big: "4×", sub: "what the top income quintile spends relative to the bottom" },
    ];
    let sy = 1.5;
    stats.forEach((st) => {
      card(s, { x: 5.9, y: sy, w: 3.55, h: 1.05 });
      s.addText(st.big, {
        x: 6.08, y: sy + 0.13, w: 1.32, h: 0.78, isTextBox: true, margin: 0,
        valign: "middle", fontFace: HEAD_FONT, fontSize: 28, bold: true, color: CHERRY,
      });
      s.addText(st.sub, {
        x: 7.4, y: sy + 0.13, w: 1.9, h: 0.78, isTextBox: true, margin: 0,
        valign: "middle", fontFace: BODY_FONT, fontSize: 11, color: BODY,
        lineSpacingMultiple: 1.1,
      });
      sy += 1.15;
    });

    card(s, { x: 5.9, y: 3.8, w: 3.55, h: 1.05, fill: CHERRY });
    iconBubble(s, { x: 6.08, y: 4.07, d: 0.5, icon: icons.building, fill: CHERRY_DK });
    s.addText("More tuition and enrichment centres than there are schools", {
      x: 6.72, y: 3.93, w: 2.58, h: 0.79, isTextBox: true, margin: 0,
      valign: "middle", fontFace: BODY_FONT, fontSize: 12.5, bold: true, color: WHITE,
      lineSpacingMultiple: 1.1,
    });

    s.addNotes(
      "The scale first. In 2023, households in Singapore spent 1.8 billion dollars on private tuition, up from 1.4 billion in 2018 and 1.1 billion in 2013. Average monthly spending per household is about 105 dollars, and the top income quintile spends roughly four times what the bottom quintile does. There are more tuition and enrichment centres than there are schools.\n\nThree points explain the pattern better than the numbers alone."
    );
  }

  // =========================================================
  // 3 — Point 01: the function of tuition
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: BG };
    numberBubble(s, "01", 0.45);
    slideTitle(s, "Tuition here is not remediation", 0.45);

    const cy = 1.35, ch = 2.3, cwid = 4.25;
    const panel = (x, o) => {
      card(s, { x: x, y: cy, w: cwid, h: ch, fill: o.fill });
      iconBubble(s, { x: x + 0.28, y: cy + 0.26, d: 0.5, icon: o.icon, fill: o.bubble });
      s.addText(o.head, {
        x: x + 0.28, y: cy + 0.9, w: cwid - 0.56, h: 0.32, isTextBox: true, margin: 0,
        valign: "top", fontFace: HEAD_FONT, fontSize: 17, bold: true, color: o.headColor,
      });
      s.addText(o.body, {
        x: x + 0.28, y: cy + 1.3, w: cwid - 0.56, h: 0.9, isTextBox: true, margin: 0,
        valign: "top", fontFace: BODY_FONT, fontSize: 13, color: o.bodyColor,
        lineSpacingMultiple: 1.18,
      });
    };

    panel(M, {
      fill: WHITE, bubble: NAVY, icon: icons.ring,
      head: "In many systems", headColor: NAVY, bodyColor: BODY,
      body: "Supplementary lessons target students who are behind. Demand falls as results improve.",
    });
    panel(5.2, {
      fill: CHERRY, bubble: CHERRY_DK, icon: icons.up,
      head: "In Singapore", headColor: WHITE, bodyColor: "FBE9EA",
      body: "A large share of tuition students already perform well. Lessons are used to work ahead of the syllabus.",
    });

    card(s, { x: M, y: 3.9, w: CW, h: 0.9, fill: CHERRY_TINT, line: { color: "EBD3D5", width: 1 }, shadow: false });
    s.addText("Demand therefore does not fall when results improve.", {
      x: M + 0.35, y: 3.9, w: CW - 0.7, h: 0.9, isTextBox: true, margin: 0,
      valign: "middle", fontFace: HEAD_FONT, fontSize: 18, italic: true, color: NAVY,
    });

    s.addNotes(
      "First, the function of tuition. In many systems, supplementary lessons target students who are behind. In Singapore a large share of tuition students are already performing well, and lessons are often used to work ahead of the school syllabus. Demand therefore does not fall when results improve."
    );
  }

  // =========================================================
  // 4 — Point 02: historical basis
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: BG };
    numberBubble(s, "02", 0.45);
    slideTitle(s, "Education as the route to mobility", 0.45);

    const steps = [
      {
        ic: icons.globe,
        head: "No natural resources",
        body: "A small nation whose only usable asset was the capability of its people.",
      },
      {
        ic: icons.grad,
        head: "A deliberate mechanism",
        body: "Education was positioned as the main route to social mobility.",
      },
      {
        ic: icons.brief,
        head: "A visible payoff",
        body: "In the early decades the link between exams and employment was direct.",
      },
    ];
    const sw = 2.8, sy = 1.4, sh = 2.4;
    const xs = [M, 3.6, 6.65];
    steps.forEach((st, i) => {
      card(s, { x: xs[i], y: sy, w: sw, h: sh });
      iconBubble(s, { x: xs[i] + 0.26, y: sy + 0.24, d: 0.5, icon: st.ic, fill: CHERRY });
      s.addText(st.head, {
        x: xs[i] + 0.26, y: sy + 0.86, w: sw - 0.52, h: 0.52, isTextBox: true, margin: 0,
        valign: "top", fontFace: HEAD_FONT, fontSize: 16, bold: true, color: NAVY,
        lineSpacingMultiple: 1.0,
      });
      s.addText(st.body, {
        x: xs[i] + 0.26, y: sy + 1.42, w: sw - 0.52, h: 0.92, isTextBox: true, margin: 0,
        valign: "top", fontFace: BODY_FONT, fontSize: 12.5, color: BODY, lineSpacingMultiple: 1.15,
      });
      if (i < 2) {
        s.addText("→", {
          x: xs[i] + sw + 0.01, y: sy + 0.85, w: 0.23, h: 0.4, isTextBox: true, margin: 0,
          align: "center", valign: "middle", fontFace: BODY_FONT, fontSize: 18, bold: true, color: CHERRY,
        });
      }
    });

    card(s, { x: M, y: 3.95, w: CW, h: 0.9, fill: CHERRY_TINT, line: { color: "EBD3D5", width: 1 }, shadow: false });
    s.addText("The expectation persisted after the economic conditions changed.", {
      x: M + 0.35, y: 3.95, w: CW - 0.7, h: 0.9, isTextBox: true, margin: 0,
      valign: "middle", fontFace: HEAD_FONT, fontSize: 18, italic: true, color: NAVY,
    });

    s.addNotes(
      "Second, the historical basis. Singapore is small and has no natural resources, and education was deliberately positioned as the main mechanism of social mobility. In the early decades that link between examinations and employment was direct and visible. The expectation persisted after the economic conditions changed."
    );
  }

  // =========================================================
  // 5 — Point 03: policy vs practice
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: BG };
    numberBubble(s, "03", 0.45);
    slideTitle(s, "Policy moved, practice did not", 0.45);

    s.addText("What the system removed", {
      x: M, y: 1.18, w: 5.0, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY_FONT, fontSize: 12, bold: true, charSpacing: 1.2, color: CHERRY,
    });

    const removals = [
      "Mid-year examinations removed at all levels",
      "PSLE reports wide achievement bands, not exact aggregate scores",
      "Top national scorers are no longer publicised",
    ];
    let ry = 1.58;
    removals.forEach((t) => {
      card(s, { x: M, y: ry, w: 5.0, h: 0.72 });
      iconBubble(s, { x: M + 0.2, y: ry + 0.16, d: 0.4, icon: icons.minus, fill: NAVY });
      s.addText(t, {
        x: M + 0.72, y: ry, w: 4.1, h: 0.72, isTextBox: true, margin: 0,
        valign: "middle", fontFace: BODY_FONT, fontSize: 13, color: BODY, lineSpacingMultiple: 1.1,
      });
      ry += 0.81;
    });

    card(s, { x: 5.9, y: 1.58, w: 3.55, h: 2.25, fill: CHERRY });
    s.addText("OVER THE SAME PERIOD", {
      x: 6.15, y: 1.78, w: 3.05, h: 0.26, isTextBox: true, margin: 0,
      fontFace: BODY_FONT, fontSize: 10, bold: true, charSpacing: 2, color: BODY_LT,
    });
    s.addText("$1.4B → $1.8B", {
      x: 6.15, y: 2.1, w: 3.05, h: 0.62, isTextBox: true, margin: 0,
      valign: "middle", fontFace: HEAD_FONT, fontSize: 27, bold: true, color: WHITE,
    });
    s.addText("Tuition expenditure rose while visible differentiation was being reduced.", {
      x: 6.15, y: 2.8, w: 3.05, h: 0.85, isTextBox: true, margin: 0,
      fontFace: BODY_FONT, fontSize: 12.5, color: "FBE9EA", lineSpacingMultiple: 1.15,
    });

    card(s, { x: M, y: 4.0, w: CW, h: 0.85, fill: CHERRY_TINT, line: { color: "EBD3D5", width: 1 }, shadow: false });
    s.addText(
      [
        { text: "One reading: ", options: { bold: true } },
        { text: "reducing visible differentiation in the system pushes families to secure an advantage privately instead." },
      ],
      {
        x: M + 0.35, y: 4.0, w: CW - 0.7, h: 0.85, isTextBox: true, margin: 0,
        valign: "middle", fontFace: BODY_FONT, fontSize: 14.5, color: NAVY,
      }
    );

    s.addNotes(
      "Third, the gap between policy and practice. Mid-year examinations have been removed at all levels. The PSLE now reports achievement in wide bands rather than exact aggregate scores. Top national scorers are no longer publicised. Tuition expenditure has risen across the same period. One reading is that reducing visible differentiation in the system pushes families to secure an advantage privately instead."
    );
  }

  // =========================================================
  // 6 — The trade-off
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: BG };

    card(s, { x: M, y: 0.9, w: 3.85, h: 3.85, fill: CHERRY });
    kicker(s, "WHAT IT COSTS", { x: M + 0.35, y: 1.35, w: 3.15, color: BODY_LT });
    s.addText("The trade-off is mainly one of time, not outcomes.", {
      x: M + 0.35, y: 1.75, w: 3.15, h: 1.9, isTextBox: true, margin: 0,
      valign: "top", fontFace: HEAD_FONT, fontSize: 26, bold: true, color: WHITE,
      lineSpacingMultiple: 1.05,
    });
    s.addText("Attainment is not what is being paid for. The hours are.", {
      x: M + 0.35, y: 3.82, w: 3.15, h: 0.68, isTextBox: true, margin: 0,
      valign: "top", fontFace: BODY_FONT, fontSize: 13.5, italic: true, color: BODY_LT,
      lineSpacingMultiple: 1.15,
    });

    const items = [
      { ic: icons.trophy, head: "Attainment is high", body: "System-level results are not the problem being described." },
      { ic: icons.clock, head: "Hours are committed", body: "Out-of-school time is heavily allocated to further instruction." },
      { ic: icons.rank, head: "Ranking arrives early", body: "Students encounter academic ranking at a young age." },
    ];
    let iy = 0.9;
    items.forEach((it) => {
      card(s, { x: 4.85, y: iy, w: 4.6, h: 1.15 });
      iconBubble(s, { x: 5.1, y: iy + 0.32, d: 0.5, icon: it.ic, fill: CHERRY });
      s.addText(it.head, {
        x: 5.78, y: iy + 0.2, w: 3.45, h: 0.32, isTextBox: true, margin: 0,
        valign: "middle", fontFace: HEAD_FONT, fontSize: 16, bold: true, color: NAVY,
      });
      s.addText(it.body, {
        x: 5.78, y: iy + 0.54, w: 3.45, h: 0.45, isTextBox: true, margin: 0,
        fontFace: BODY_FONT, fontSize: 12.5, color: BODY, lineSpacingMultiple: 1.1,
      });
      iy += 1.35;
    });

    s.addNotes(
      "The trade-off is mainly one of time rather than outcomes. Attainment is high, but out-of-school hours are heavily committed, and students encounter academic ranking early."
    );
  }

  // =========================================================
  // 7 — The open question
  // =========================================================
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    s.addShape(pres.ShapeType.ellipse, {
      x: -1.3, y: 2.5, w: 4.2, h: 4.2,
      fill: { color: WHITE, transparency: 94 }, line: { type: "none" },
    });
    s.addShape(pres.ShapeType.ellipse, {
      x: 7.6, y: -1.4, w: 3.6, h: 3.6,
      fill: { color: WHITE, transparency: 93 }, line: { type: "none" },
    });

    kicker(s, "THE OPEN QUESTION", { x: M, y: 0.95, w: 5, color: "C2CBEE" });
    s.addText("What keeps this dynamic from forming elsewhere?", {
      x: M, y: 1.35, w: 7.6, h: 1.5, isTextBox: true, margin: 0,
      fontFace: HEAD_FONT, fontSize: 34, bold: true, color: WHITE, lineSpacingMultiple: 1.05,
    });

    card(s, { x: M, y: 3.05, w: 7.3, h: 1.05, fill: "3F4C92", line: { color: "56629F", width: 1 }, shadow: false });
    s.addText("The answer appears to lie less in examination design than in parental expectations.", {
      x: M + 0.35, y: 3.05, w: 6.6, h: 1.05, isTextBox: true, margin: 0,
      valign: "middle", fontFace: BODY_FONT, fontSize: 15.5, color: "EAEEFB", lineSpacingMultiple: 1.15,
    });

    s.addText("This is the comparison worth making across systems.", {
      x: M, y: 4.35, w: 7.3, h: 0.35, isTextBox: true, margin: 0,
      fontFace: BODY_FONT, fontSize: 12.5, italic: true, color: "AEB8E4",
    });

    s.addNotes(
      "The open question, and the one worth comparing across systems, is what keeps this dynamic from forming elsewhere. The answer appears to lie less in examination design than in parental expectations.\n\nThank you."
    );
  }

  return pres.writeFile({ fileName: process.argv[2] || "singapore-tuition-culture.pptx" });
}

(async () => {
  const icons = {
    building: await icon(Fa.FaBuilding, "FFFFFF"),
    ring: await icon(Fa.FaLifeRing, "FFFFFF"),
    up: await icon(Fa.FaArrowUp, "FFFFFF"),
    globe: await icon(Fa.FaGlobeAsia, "FFFFFF"),
    grad: await icon(Fa.FaUserGraduate, "FFFFFF"),
    brief: await icon(Fa.FaBriefcase, "FFFFFF"),
    minus: await icon(Fa.FaMinus, "FFFFFF"),
    trophy: await icon(Fa.FaTrophy, "FFFFFF"),
    clock: await icon(Fa.FaRegClock, "FFFFFF"),
    rank: await icon(Fa.FaSortAmountDown, "FFFFFF"),
  };
  await main(icons);
  console.log("written");
})();
