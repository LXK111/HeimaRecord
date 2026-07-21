#!/usr/bin/env python3
"""Generate the release PDFs from the canonical Markdown documents."""

from __future__ import annotations

import hashlib
import json
import os
import re
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "release-assets"
DOCUMENTS = (
    (ROOT / "docs" / "使用说明.md", ASSET_DIR / "使用说明.pdf", "黑马兵击记录台使用说明"),
    (
        ROOT / "docs" / "final_document" / "赛事现场验收与交付说明.md",
        ASSET_DIR / "赛事验收清单.pdf",
        "赛事现场验收与交付说明",
    ),
)
FONT_CANDIDATES = (
    os.environ.get("HEIMA_PDF_FONT", ""),
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)
FONT_NAME = "HeimaCJK"


def register_font() -> None:
    font_path = next((Path(path) for path in FONT_CANDIDATES if path and Path(path).exists()), None)
    if not font_path:
        raise RuntimeError("未找到可嵌入的中文字体，请通过 HEIMA_PDF_FONT 指定字体文件。")
    pdfmetrics.registerFont(TTFont(FONT_NAME, str(font_path)))


def inline_markup(text: str) -> str:
    value = escape(text.strip())
    value = re.sub(r"`([^`]+)`", r'<font color="#A9342B">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    return value


def create_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleCJK",
            parent=base["Title"],
            fontName=FONT_NAME,
            fontSize=22,
            leading=30,
            textColor=colors.HexColor("#16201C"),
            alignment=TA_LEFT,
            spaceAfter=12,
        ),
        "h2": ParagraphStyle(
            "Heading2CJK",
            parent=base["Heading2"],
            fontName=FONT_NAME,
            fontSize=15,
            leading=22,
            textColor=colors.HexColor("#18231F"),
            spaceBefore=12,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "Heading3CJK",
            parent=base["Heading3"],
            fontName=FONT_NAME,
            fontSize=12,
            leading=18,
            textColor=colors.HexColor("#A9342B"),
            spaceBefore=9,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "BodyCJK",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=9.5,
            leading=16,
            textColor=colors.HexColor("#26312C"),
            alignment=TA_LEFT,
            spaceAfter=5,
        ),
        "bullet": ParagraphStyle(
            "BulletCJK",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=9.5,
            leading=15,
            leftIndent=12,
            firstLineIndent=-8,
            textColor=colors.HexColor("#26312C"),
            spaceAfter=3,
        ),
        "code": ParagraphStyle(
            "CodeCJK",
            parent=base["Code"],
            fontName=FONT_NAME,
            fontSize=8.5,
            leading=13,
            leftIndent=7,
            rightIndent=7,
            textColor=colors.HexColor("#16201C"),
        ),
        "table_header": ParagraphStyle(
            "TableHeaderCJK",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=8,
            leading=11,
            textColor=colors.white,
            alignment=TA_CENTER,
        ),
        "table_cell": ParagraphStyle(
            "TableCellCJK",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=7.5,
            leading=11,
            textColor=colors.HexColor("#26312C"),
            alignment=TA_LEFT,
        ),
    }


def is_table_separator(line: str) -> bool:
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def build_table(lines: list[str], styles) -> Table:
    rows: list[list[Paragraph]] = []
    for line_index, line in enumerate(lines):
        if line_index == 1 and is_table_separator(line):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        style = styles["table_header"] if not rows else styles["table_cell"]
        rows.append([Paragraph(inline_markup(cell), style) for cell in cells])
    column_count = max(len(row) for row in rows)
    for row in rows:
        row.extend(Paragraph("", styles["table_cell"]) for _ in range(column_count - len(row)))
    available_width = A4[0] - 36 * mm
    table = Table(rows, colWidths=[available_width / column_count] * column_count, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#18231F")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 0), (-1, -1), 0.35, colors.HexColor("#D9D2C7")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F7F4EE")]),
            ]
        )
    )
    return table


def markdown_story(markdown_text: str, styles) -> list:
    lines = markdown_text.splitlines()
    story: list = []
    paragraph_lines: list[str] = []
    in_code = False
    code_lines: list[str] = []
    index = 0

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), styles["body"]))
        paragraph_lines.clear()

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if stripped.startswith("```"):
            flush_paragraph()
            if in_code:
                code_text = "<br/>".join(escape(item) if item else "&nbsp;" for item in code_lines)
                block = Table([[Paragraph(code_text, styles["code"])]], colWidths=[A4[0] - 36 * mm])
                block.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEEAE2")),
                            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CFC5B6")),
                            ("LEFTPADDING", (0, 0), (-1, -1), 7),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                            ("TOPPADDING", (0, 0), (-1, -1), 7),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                        ]
                    )
                )
                story.extend([block, Spacer(1, 5)])
                code_lines.clear()
            in_code = not in_code
            index += 1
            continue
        if in_code:
            code_lines.append(line)
            index += 1
            continue
        if stripped.startswith("|") and index + 1 < len(lines) and lines[index + 1].strip().startswith("|"):
            flush_paragraph()
            table_lines = [line]
            index += 1
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index])
                index += 1
            story.extend([build_table(table_lines, styles), Spacer(1, 7)])
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            story.append(Paragraph(inline_markup(heading.group(2)), styles["title" if level == 1 else f"h{level}"]))
        elif re.match(r"^-\s+", stripped):
            flush_paragraph()
            story.append(Paragraph(f"•&nbsp;&nbsp;{inline_markup(stripped[2:])}", styles["bullet"]))
        elif re.match(r"^\d+\.\s+", stripped):
            flush_paragraph()
            marker, text = stripped.split(".", 1)
            story.append(Paragraph(f"{marker}.&nbsp;&nbsp;{inline_markup(text)}", styles["bullet"]))
        elif not stripped:
            flush_paragraph()
            if story and not isinstance(story[-1], Spacer):
                story.append(Spacer(1, 2))
        else:
            paragraph_lines.append(stripped)
        index += 1
    flush_paragraph()
    return story


def page_decorator(document_title: str):
    def decorate(canvas, doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#D9D2C7"))
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, A4[1] - 14 * mm, A4[0] - 18 * mm, A4[1] - 14 * mm)
        canvas.setFont(FONT_NAME, 7.5)
        canvas.setFillColor(colors.HexColor("#6D746F"))
        canvas.drawString(18 * mm, A4[1] - 10.5 * mm, "HEIMA-RECORD")
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 10.5 * mm, document_title)
        canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
        canvas.drawString(18 * mm, 8.5 * mm, "本地赛事控制台交付文档")
        canvas.drawRightString(A4[0] - 18 * mm, 8.5 * mm, f"第 {doc.page} 页")
        canvas.restoreState()

    return decorate


def generate_pdf(source: Path, destination: Path, title: str, styles) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(destination),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=19 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="liuxiaoke",
        subject="heima-record release document",
        invariant=1,
    )
    story = markdown_story(source.read_text(encoding="utf-8"), styles)
    decorator = page_decorator(title)
    doc.build(story, onFirstPage=decorator, onLaterPages=decorator)


def main() -> None:
    register_font()
    styles = create_styles()
    manifest = {"version": 1, "documents": []}
    for source, destination, title in DOCUMENTS:
        generate_pdf(source, destination, title, styles)
        manifest["documents"].append(
            {
                "source": str(source.relative_to(ROOT)),
                "pdf": destination.name,
                "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            }
        )
    (ASSET_DIR / "release-docs-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Generated {len(DOCUMENTS)} release PDFs in {ASSET_DIR}")


if __name__ == "__main__":
    main()
