//! Engine-side text layout: OpenType shaping (rustybuzz, a HarfBuzz port), bidirectional reordering (UAX #9), line
//! breaking (UAX #14) and grapheme clusters (UAX #29), reading nothing but the font bytes it is given. The result is
//! a pure function of its inputs, quantised to 1/64 px, so that it is the same on every platform.

use std::collections::BTreeMap;

use rustybuzz::ttf_parser::colr;
use rustybuzz::ttf_parser::{GlyphId, OutlineBuilder, RgbaColor, Transform};
use rustybuzz::{Direction, Face, UnicodeBuffer};
use serde::{Deserialize, Serialize};
use unicode_bidi::{BidiInfo, Level};
use unicode_linebreak::{BreakOpportunity, linebreaks};
use unicode_segmentation::UnicodeSegmentation;

/// Font files by id. Faces are parsed from the bytes when they are used.
#[derive(Default)]
pub struct FontStore {
    fonts: BTreeMap<String, Vec<u8>>,
}

impl FontStore {
    /// Stores a font; `false` when the bytes are not a font the shaper can read.
    pub fn load(&mut self, id: &str, data: Vec<u8>) -> bool {
        if Face::from_slice(&data, 0).is_none() {
            return false;
        }
        self.fonts.insert(id.to_string(), data);
        true
    }

    pub fn has(&self, id: &str) -> bool {
        self.fonts.contains_key(id)
    }

    pub fn remove(&mut self, id: &str) {
        self.fonts.remove(id);
    }

    fn face(&self, id: &str) -> Option<Face<'_>> {
        Face::from_slice(self.fonts.get(id)?, 0)
    }

    /// Whether the font's `cmap` covers every character of the text (controls and joiners aside).
    pub fn covers(&self, id: &str, text: &str) -> bool {
        self.face(id).is_some_and(|face| text.chars().all(|character| ignorable(character) || face.glyph_index(character).is_some()))
    }

    /// Outline of a glyph as SVG path data in em units (1 = the font size), y pointing down.
    pub fn glyph_path(&self, id: &str, glyph: u16) -> Option<String> {
        let face = self.face(id)?;
        let mut builder = PathBuilder { path: String::new(), scale: 1.0 / face.units_per_em() as f32, flip: -1.0 };
        face.outline_glyph(GlyphId(glyph), &mut builder)?;
        Some(builder.path)
    }

    /// The paint program of a colour glyph (`COLR` v0 and v1) in font units with y up, and the units per em.
    /// `None` when the glyph has no colour description: it is then drawn from its outline.
    pub fn glyph_paint(&self, id: &str, glyph: u16) -> Option<GlyphPaint> {
        let face = self.face(id)?;
        if !face.is_color_glyph(GlyphId(glyph)) {
            return None;
        }
        let mut painter = PaintRecorder { face: &face, ops: Vec::new() };
        face.paint_color_glyph(GlyphId(glyph), 0, RgbaColor::new(0, 0, 0, 255), &mut painter)?;
        let ops = painter.ops;
        Some(GlyphPaint { units_per_em: face.units_per_em() as f32, ops })
    }
}

/// One step of a colour glyph's paint program, as the rasteriser replays it.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum PaintOp {
    Outline { path: String },
    Solid { color: [u8; 4] },
    Linear { points: [f32; 6], stops: Vec<(f32, [u8; 4])> },
    Radial { circles: [f32; 6], stops: Vec<(f32, [u8; 4])> },
    Sweep { center: [f32; 2], angles: [f32; 2], stops: Vec<(f32, [u8; 4])> },
    PushClip,
    PushClipBox { rect: [f32; 4] },
    PopClip,
    PushLayer { mode: String },
    PopLayer,
    PushTransform { matrix: [f32; 6] },
    PopTransform,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphPaint {
    pub units_per_em: f32,
    pub ops: Vec<PaintOp>,
}

struct PaintRecorder<'f, 'a> {
    face: &'f Face<'a>,
    ops: Vec<PaintOp>,
}

fn rgba(color: RgbaColor) -> [u8; 4] {
    [color.red, color.green, color.blue, color.alpha]
}

impl<'f, 'a> colr::Painter<'a> for PaintRecorder<'f, 'a> {
    fn outline_glyph(&mut self, glyph_id: GlyphId) {
        // Font units, y up: the rasteriser flips the axis once for the whole program.
        let mut builder = PathBuilder { path: String::new(), scale: 1.0, flip: 1.0 };
        let _ = self.face.outline_glyph(glyph_id, &mut builder);
        self.ops.push(PaintOp::Outline { path: builder.path });
    }
    fn paint(&mut self, paint: colr::Paint<'a>) {
        let coords = self.face.variation_coordinates();
        let sorted = |mut stops: Vec<(f32, [u8; 4])>| {
            stops.sort_by(|a, b| a.0.total_cmp(&b.0));
            stops
        };
        self.ops.push(match paint {
            colr::Paint::Solid(color) => PaintOp::Solid { color: rgba(color) },
            colr::Paint::LinearGradient(gradient) => PaintOp::Linear {
                points: [gradient.x0, gradient.y0, gradient.x1, gradient.y1, gradient.x2, gradient.y2],
                stops: sorted(gradient.stops(0, coords).map(|stop| (stop.stop_offset, rgba(stop.color))).collect()),
            },
            colr::Paint::RadialGradient(gradient) => PaintOp::Radial {
                circles: [gradient.x0, gradient.y0, gradient.r0, gradient.x1, gradient.y1, gradient.r1],
                stops: sorted(gradient.stops(0, coords).map(|stop| (stop.stop_offset, rgba(stop.color))).collect()),
            },
            colr::Paint::SweepGradient(gradient) => PaintOp::Sweep {
                center: [gradient.center_x, gradient.center_y],
                angles: [gradient.start_angle, gradient.end_angle],
                stops: sorted(gradient.stops(0, coords).map(|stop| (stop.stop_offset, rgba(stop.color))).collect()),
            },
        });
    }
    fn push_clip(&mut self) {
        self.ops.push(PaintOp::PushClip);
    }
    fn push_clip_box(&mut self, clipbox: colr::ClipBox) {
        self.ops.push(PaintOp::PushClipBox { rect: [clipbox.x_min, clipbox.y_min, clipbox.x_max, clipbox.y_max] });
    }
    fn pop_clip(&mut self) {
        self.ops.push(PaintOp::PopClip);
    }
    fn push_layer(&mut self, mode: colr::CompositeMode) {
        self.ops.push(PaintOp::PushLayer { mode: format!("{mode:?}") });
    }
    fn pop_layer(&mut self) {
        self.ops.push(PaintOp::PopLayer);
    }
    fn push_transform(&mut self, transform: Transform) {
        self.ops.push(PaintOp::PushTransform { matrix: [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f] });
    }
    fn pop_transform(&mut self) {
        self.ops.push(PaintOp::PopTransform);
    }
}

struct PathBuilder {
    path: String,
    scale: f32,
    /// −1 turns the y axis down (canvas space); 1 keeps font space.
    flip: f32,
}

impl PathBuilder {
    fn point(&self, x: f32, y: f32) -> String {
        // Font units have y up; the canvas has y down.
        format!("{} {}", trim(x * self.scale), trim(self.flip * y * self.scale))
    }
}

fn trim(value: f32) -> String {
    let rounded = (value * 100_000.0).round() / 100_000.0;
    format!("{rounded}")
}

impl OutlineBuilder for PathBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        self.path.push_str(&format!("M{}", self.point(x, y)));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.path.push_str(&format!("L{}", self.point(x, y)));
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.path.push_str(&format!("Q{} {}", self.point(x1, y1), self.point(x, y)));
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.path.push_str(&format!("C{} {} {}", self.point(x1, y1), self.point(x2, y2), self.point(x, y)));
    }
    fn close(&mut self) {
        self.path.push('Z');
    }
}

fn ignorable(character: char) -> bool {
    character.is_control() || matches!(character, '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{2069}' | '\u{fe00}'..='\u{fe0f}' | '\u{feff}')
}

/// Scripts whose letters join: letter spacing never separates the letters of a word in them.
fn cursive(character: char) -> bool {
    matches!(character as u32, 0x0600..=0x06ff | 0x0700..=0x074f | 0x0750..=0x077f | 0x07c0..=0x07ff | 0x08a0..=0x08ff | 0x1800..=0x18af | 0xfb50..=0xfdff | 0xfe70..=0xfeff | 0x1e900..=0x1e95f)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Left,
    #[default]
    Center,
    Right,
    Justify,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    /// Font ids in fallback order: the element's face first, then the glyph fallback chain.
    pub fonts: Vec<String>,
    /// Font size in layout px.
    pub size: f32,
    #[serde(default)]
    pub letter_spacing: f32,
    /// Line advance as a multiple of the font size.
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default)]
    pub align: Align,
}

fn default_line_height() -> f32 {
    1.2
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Glyph {
    pub id: u16,
    /// Byte offset, in the content, of the cluster the glyph belongs to.
    pub cluster: u32,
    pub x: f32,
    pub y: f32,
    pub advance: f32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub font_id: String,
    pub direction: &'static str,
    pub glyphs: Vec<Glyph>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Line {
    pub runs: Vec<Run>,
    pub width: f32,
    pub ascent: f32,
    pub descent: f32,
    /// Left edge of the line inside the block and y of its baseline.
    pub x: f32,
    pub baseline: f32,
    /// Byte range of the content the line holds.
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Layout {
    pub lines: Vec<Line>,
    pub width: f32,
    pub height: f32,
}

fn q(value: f32) -> f32 {
    (value * 64.0).round() / 64.0
}

struct ShapedGlyph {
    id: u16,
    cluster: usize,
    advance: f32,
    x_offset: f32,
    y_offset: f32,
    /// Whether letter spacing was added after this glyph.
    spaced: bool,
}

struct Item {
    start: usize,
    end: usize,
    level: Level,
    font: usize,
    glyphs: Vec<ShapedGlyph>,
    joined: bool,
}

struct Paragraph<'a> {
    text: &'a str,
    offset: usize,
    items: Vec<Item>,
}

fn shape_paragraph<'a>(faces: &[(String, Face<'_>)], style: &TextStyle, text: &'a str, offset: usize) -> Paragraph<'a> {
    let bidi = BidiInfo::new(text, None);
    // Itemise by embedding level and by the first font of the chain that covers each grapheme cluster.
    let mut items: Vec<Item> = Vec::new();
    let mut last_font = 0;
    for (start, cluster) in text.grapheme_indices(true) {
        let level = bidi.levels[start];
        let base = cluster.chars().find(|character| !ignorable(*character));
        let font = match base {
            Some(character) if !character.is_whitespace() => faces.iter().position(|(_, face)| face.glyph_index(character).is_some()).unwrap_or(0),
            _ => last_font,
        };
        last_font = font;
        match items.last_mut() {
            Some(item) if item.level == level && item.font == font => item.end = start + cluster.len(),
            _ => items.push(Item { start, end: start + cluster.len(), level, font, glyphs: Vec::new(), joined: false }),
        }
    }
    for item in &mut items {
        let face = &faces[item.font].1;
        let scale = style.size / face.units_per_em() as f32;
        let slice = &text[item.start..item.end];
        item.joined = slice.chars().any(cursive);
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(slice);
        buffer.set_direction(if item.level.is_rtl() { Direction::RightToLeft } else { Direction::LeftToRight });
        buffer.guess_segment_properties();
        buffer.set_direction(if item.level.is_rtl() { Direction::RightToLeft } else { Direction::LeftToRight });
        let shaped = rustybuzz::shape(face, &[], buffer);
        item.glyphs = shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .map(|(info, position)| ShapedGlyph {
                id: info.glyph_id as u16,
                cluster: item.start + info.cluster as usize,
                advance: position.x_advance as f32 * scale,
                x_offset: position.x_offset as f32 * scale,
                y_offset: position.y_offset as f32 * scale,
                spaced: false,
            })
            .collect();
        // Letter spacing follows each shaped cluster; inside a joined script it follows the spaces only, so a
        // word keeps its joined forms.
        if style.letter_spacing != 0.0 {
            let count = item.glyphs.len();
            for index in 0..count {
                let cluster = item.glyphs[index].cluster;
                let last_of_cluster = if item.level.is_rtl() {
                    index == 0 || item.glyphs[index - 1].cluster != cluster
                } else {
                    index + 1 == count || item.glyphs[index + 1].cluster != cluster
                };
                let is_space = text[cluster..].chars().next().is_some_and(char::is_whitespace);
                if last_of_cluster && (!item.joined || is_space) {
                    item.glyphs[index].advance += style.letter_spacing;
                    item.glyphs[index].spaced = true;
                }
            }
        }
    }
    Paragraph { text, offset, items }
}

impl Paragraph<'_> {
    /// Advance of the text in `[start, end)`.
    fn advance(&self, start: usize, end: usize) -> f32 {
        self.items.iter().flat_map(|item| item.glyphs.iter()).filter(|glyph| glyph.cluster >= start && glyph.cluster < end).map(|glyph| glyph.advance).sum()
    }

    fn trimmed_end(&self, start: usize, end: usize) -> usize {
        start + self.text[start..end].trim_end().len()
    }

    /// Greedy line breaking at UAX #14 opportunities; a unit wider than the line breaks between clusters.
    fn break_lines(&self, max_width: Option<f32>) -> Vec<(usize, usize)> {
        let mut lines = Vec::new();
        let mut line_start = 0;
        let mut fitted = 0;
        for (position, opportunity) in linebreaks(self.text) {
            let mandatory = opportunity == BreakOpportunity::Mandatory;
            if let Some(max) = max_width {
                if self.advance(line_start, self.trimmed_end(line_start, position)) > max + 1.0 / 128.0 {
                    if fitted > line_start {
                        lines.push((line_start, fitted));
                        line_start = fitted;
                    }
                    // The unit alone is still too wide: break between its clusters.
                    while self.advance(line_start, self.trimmed_end(line_start, position)) > max + 1.0 / 128.0 {
                        let mut end = line_start;
                        for (index, cluster) in self.text[line_start..position].grapheme_indices(true) {
                            let next = line_start + index + cluster.len();
                            if end > line_start && self.advance(line_start, next) > max {
                                break;
                            }
                            end = next;
                        }
                        if end >= position || end == line_start {
                            break;
                        }
                        lines.push((line_start, end));
                        line_start = end;
                    }
                }
            }
            fitted = position;
            if mandatory {
                lines.push((line_start, position));
                line_start = position;
            }
        }
        if line_start < self.text.len() || lines.is_empty() {
            lines.push((line_start, self.text.len()));
        }
        lines
    }
}

/// Lays out `content` in the fonts of the style. `max_width` wraps the text; without it only line feeds break.
pub fn layout_text(fonts: &FontStore, style: &TextStyle, content: &str, max_width: Option<f32>) -> Option<Layout> {
    let faces: Vec<(String, Face<'_>)> = style.fonts.iter().filter_map(|id| Some((id.clone(), fonts.face(id)?))).collect();
    let primary = &faces.first()?.1;
    let scale = style.size / primary.units_per_em() as f32;
    let (ascent, descent) = (f32::from(primary.ascender()) * scale, -f32::from(primary.descender()) * scale);
    let advance = style.line_height * style.size;

    struct Pending {
        runs: Vec<(usize, bool, Vec<(u16, usize, f32, f32, f32)>)>,
        width: f32,
        start: usize,
        end: usize,
        last_of_paragraph: bool,
        spaces: usize,
    }
    let mut pending: Vec<Pending> = Vec::new();
    let mut offset = 0;
    for text in content.split('\n') {
        let paragraph = shape_paragraph(&faces, style, text, offset);
        let ranges = paragraph.break_lines(max_width);
        let count = ranges.len();
        for (index, (start, end)) in ranges.into_iter().enumerate() {
            let visible_end = paragraph.trimmed_end(start, end);
            let pieces: Vec<&Item> = paragraph.items.iter().filter(|item| item.start < visible_end && item.end > start).collect();
            let levels: Vec<Level> = pieces.iter().map(|item| item.level).collect();
            let order = BidiInfo::reorder_visual(&levels);
            let mut runs = Vec::new();
            let mut width = 0.0;
            // Spacing after the last cluster of a line is not part of the line.
            let last_cluster = pieces.iter().flat_map(|item| item.glyphs.iter()).filter(|glyph| glyph.cluster >= start && glyph.cluster < visible_end).map(|glyph| glyph.cluster).max();
            for piece in order {
                let item = pieces[piece];
                let glyphs: Vec<(u16, usize, f32, f32, f32)> = item
                    .glyphs
                    .iter()
                    .filter(|glyph| glyph.cluster >= start && glyph.cluster < visible_end)
                    .map(|glyph| {
                        let trailing = glyph.spaced && Some(glyph.cluster) == last_cluster;
                        (glyph.id, paragraph.offset + glyph.cluster, if trailing { glyph.advance - style.letter_spacing } else { glyph.advance }, glyph.x_offset, glyph.y_offset)
                    })
                    .collect();
                width += glyphs.iter().map(|glyph| glyph.2).sum::<f32>();
                runs.push((item.font, item.level.is_rtl(), glyphs));
            }
            let spaces = text[start..visible_end].chars().filter(|character| *character == ' ').count();
            pending.push(Pending { runs, width, start: offset + start, end: offset + end, last_of_paragraph: index + 1 == count, spaces });
        }
        offset += text.len() + 1;
    }

    // The block is as wide as its widest line, or as the wrap width when there is one.
    let widest = pending.iter().map(|line| line.width).fold(0.0, f32::max);
    let block_width = max_width.map_or(widest, |max| max.max(widest));
    let mut lines = Vec::with_capacity(pending.len());
    for (index, line) in pending.into_iter().enumerate() {
        let free = block_width - line.width;
        let justify = style.align == Align::Justify && !line.last_of_paragraph && line.spaces > 0 && free > 0.0;
        let extra = if justify { free / line.spaces as f32 } else { 0.0 };
        let x = match style.align {
            Align::Left | Align::Justify => 0.0,
            Align::Center => free / 2.0,
            Align::Right => free,
        };
        let baseline = ascent + index as f32 * advance + (advance - (ascent + descent)) / 2.0;
        let mut pen = x;
        let mut runs = Vec::with_capacity(line.runs.len());
        for (font, rtl, glyphs) in line.runs {
            let mut out = Vec::with_capacity(glyphs.len());
            for (id, cluster, glyph_advance, x_offset, y_offset) in glyphs {
                let stretched = if extra > 0.0 && content[cluster..].starts_with(' ') { glyph_advance + extra } else { glyph_advance };
                out.push(Glyph { id, cluster: cluster as u32, x: q(pen + x_offset), y: q(baseline - y_offset), advance: q(stretched) });
                pen += stretched;
            }
            runs.push(Run { font_id: faces[font].0.clone(), direction: if rtl { "rtl" } else { "ltr" }, glyphs: out });
        }
        lines.push(Line {
            runs,
            width: q(if justify { block_width } else { line.width }),
            ascent: q(ascent),
            descent: q(descent),
            x: q(x),
            baseline: q(baseline),
            start: line.start as u32,
            end: line.end as u32,
        });
    }
    let height = lines.len() as f32 * advance;
    Some(Layout { lines, width: q(block_width), height: q(height) })
}

#[cfg(test)]
mod tests {
    use super::{Align, FontStore, TextStyle, layout_text};

    fn store() -> FontStore {
        let mut fonts = FontStore::default();
        let directory = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../render/test/fixtures/fonts/");
        for (id, file) in [("arimo", "Arimo-Regular.ttf"), ("thai", "NotoSansThai-Regular.ttf"), ("arabic", "NotoNaskhArabic-Regular.ttf")] {
            assert!(fonts.load(id, std::fs::read(format!("{directory}{file}")).expect("the test font exists")));
        }
        fonts
    }

    fn style(letter_spacing: f32, align: Align) -> TextStyle {
        TextStyle { fonts: vec!["arimo".into(), "thai".into(), "arabic".into()], size: 100.0, letter_spacing, line_height: 1.2, align }
    }

    #[test]
    fn lays_out_a_line_with_kerning_on_a_1_64_grid() {
        let fonts = store();
        let layout = layout_text(&fonts, &style(0.0, Align::Left), "AVA", None).unwrap();
        assert_eq!(layout.lines.len(), 1);
        let glyphs = &layout.lines[0].runs[0].glyphs;
        assert_eq!(glyphs.len(), 3);
        // Arimo: A = 66.7 px at 100 px; the pair AV is kerned tighter than the two advances.
        assert!(glyphs[1].x < 66.7 && glyphs[1].x > 55.0, "V at {}", glyphs[1].x);
        for glyph in glyphs {
            assert_eq!((glyph.x * 64.0).fract(), 0.0);
        }
        assert_eq!(layout.height, 120.0);
        assert_eq!(layout_text(&fonts, &style(0.0, Align::Left), "AVA", None), Some(layout));
    }

    #[test]
    fn breaks_lines_at_word_boundaries_and_aligns() {
        let fonts = store();
        let text = "The quick brown fox jumps over the lazy dog";
        let wide = layout_text(&fonts, &style(0.0, Align::Center), text, None).unwrap();
        let narrow = layout_text(&fonts, &style(0.0, Align::Center), text, Some(wide.width / 3.0)).unwrap();
        assert!(narrow.lines.len() >= 3 && narrow.lines.len() <= 5, "{} lines", narrow.lines.len());
        for line in &narrow.lines {
            assert!(line.width <= wide.width / 3.0 + 0.02);
            let broken = &text[line.start as usize..line.end as usize];
            assert!(broken.ends_with(' ') || line.end as usize == text.len(), "line ends inside a word: {broken:?}");
            assert!((line.x - (narrow.width - line.width) / 2.0).abs() < 0.02, "centred");
        }
        let two = layout_text(&fonts, &style(0.0, Align::Right), "ab\ncd", None).unwrap();
        assert_eq!(two.lines.len(), 2);
        let justified = layout_text(&fonts, &style(0.0, Align::Justify), text, Some(wide.width / 3.0)).unwrap();
        assert!((justified.lines[0].width - justified.width).abs() < 0.02, "a justified line fills the block");
        assert!(justified.lines.last().unwrap().width < justified.width, "the last line is not stretched");
    }

    #[test]
    fn resolves_fallback_fonts_per_cluster_and_orders_right_to_left_runs() {
        let fonts = store();
        let layout = layout_text(&fonts, &style(0.0, Align::Left), "Hi สวัสดี سلام", None).unwrap();
        let runs = &layout.lines[0].runs;
        let ids: Vec<&str> = runs.iter().map(|run| run.font_id.as_str()).collect();
        // A space takes the font of the cluster before it, so three runs: Latin, Thai, Arabic.
        assert_eq!(ids, ["arimo", "thai", "arabic"]);
        assert_eq!(runs[2].direction, "rtl");
        // The Arabic run is in visual order: its clusters descend from left to right.
        let clusters: Vec<u32> = runs[2].glyphs.iter().map(|glyph| glyph.cluster).collect();
        assert!(clusters.windows(2).all(|pair| pair[0] >= pair[1]), "{clusters:?}");
        assert!(fonts.covers("thai", "สวัสดี") && !fonts.covers("arimo", "สวัสดี"));
    }

    #[test]
    fn letter_spacing_keeps_joined_words_and_spreads_other_letters() {
        let fonts = store();
        let plain = layout_text(&fonts, &style(0.0, Align::Left), "سلام عليكم", None).unwrap();
        let spaced = layout_text(&fonts, &style(10.0, Align::Left), "سلام عليكم", None).unwrap();
        // One space between the two words: the line grows by exactly one spacing.
        assert!((spaced.lines[0].width - plain.lines[0].width - 10.0).abs() < 0.05, "{} vs {}", spaced.lines[0].width, plain.lines[0].width);
        let ids = |layout: &super::Layout| layout.lines[0].runs.iter().flat_map(|run| run.glyphs.iter().map(|glyph| glyph.id)).collect::<Vec<_>>();
        assert_eq!(ids(&plain), ids(&spaced), "every word keeps its joined forms");
        let latin = layout_text(&fonts, &style(10.0, Align::Left), "abc", None).unwrap();
        let tight = layout_text(&fonts, &style(0.0, Align::Left), "abc", None).unwrap();
        assert!((latin.lines[0].width - tight.lines[0].width - 20.0).abs() < 0.05);
    }

    #[test]
    fn extracts_glyph_outlines_as_paths() {
        let fonts = store();
        let layout = layout_text(&fonts, &style(0.0, Align::Left), "o", None).unwrap();
        let path = fonts.glyph_path("arimo", layout.lines[0].runs[0].glyphs[0].id).unwrap();
        assert!(path.starts_with('M') && path.ends_with('Z') && path.contains('Q'), "{path}");
        assert_eq!(path.matches('Z').count(), 2, "an o has an outer and an inner contour");
    }
}
