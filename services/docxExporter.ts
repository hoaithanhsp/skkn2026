/**
 * DOCX Exporter Service
 * Chuyển đổi Markdown sang file .docx theo đúng mẫu BẢN MÔ TẢ SÁNG KIẾN
 */

import { fixVietnameseCapitalization } from './textProcessor';

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  LevelFormat,
  ShadingType,
} from 'docx';

interface ParsedElement {
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'code';
  level?: number;
  content: string;
  items?: string[];
  isOrdered?: boolean;
  rows?: string[][];
}

// UserInfo interface (simplified for export)
interface ExportUserInfo {
  topic: string;
  subject: string;
  level: string;
  grade: string;
  school: string;
  location: string;
  authorName: string;
  authorDob: string;
  authorPosition: string;
  authorPhone: string;
  coAuthorName: string;
  coAuthorDob: string;
  coAuthorPosition: string;
  coAuthorPhone: string;
  applicationUnit: string;
  applicationAddress: string;
  applicationPhone: string;
  fieldOfApplication: string;
}

const FONT = 'Times New Roman';
const SIZE_14 = 28; // 14pt
const SIZE_13 = 26; // 13pt
const SIZE_16 = 32; // 16pt
const LINE_SPACING = 276; // 1.15 line spacing (240 = single)

/**
 * Parse inline formatting (bold, italic) và trả về array TextRun
 */
function parseInlineFormatting(text: string, defaultSize: number = SIZE_14): TextRun[] {
  const runs: TextRun[] = [];
  // Remove emojis/icons from text for clean Word output
  const cleanText = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}━━━━╔╗╚╝║┌┐└┘│─]+/gu, '').trim();

  const regex = /(\*\*|__)(.*?)\1|(\*|_)(.*?)\3|`([^`]+)`|([^*_`]+)/g;
  let match;

  while ((match = regex.exec(cleanText)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, font: FONT, size: defaultSize }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true, font: FONT, size: defaultSize }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], font: 'Consolas', size: SIZE_13 }));
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6], font: FONT, size: defaultSize }));
    }
  }

  if (runs.length === 0) {
    runs.push(new TextRun({ text: cleanText, font: FONT, size: defaultSize }));
  }

  return runs;
}

/**
 * Parse Markdown thành các elements
 */
function parseMarkdown(markdown: string): ParsedElement[] {
  const lines = markdown.split('\n');
  const elements: ParsedElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || line.match(/^[-━═─┌┐└┘│]+$/) || line.match(/^[🚨⚠️✅📌📊🚫📝🖼️💡]*$/)) {
      i++;
      continue;
    }

    // Skip lines that are just decorative/prompt artifacts
    if (line.startsWith('━') || line.startsWith('╔') || line.startsWith('╚') || line.startsWith('┌') || line.startsWith('└')) {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      elements.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] });
      i++;
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      elements.push({ type: 'list', content: '', items, isOrdered: true });
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      elements.push({ type: 'list', content: '', items, isOrdered: false });
      continue;
    }

    if (line.includes('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        const row = lines[i].split('|')
          .map(cell => cell.trim())
          .filter(cell => cell && !cell.match(/^[-:]+$/));
        if (row.length > 0) rows.push(row);
        i++;
      }
      if (rows.length > 0) elements.push({ type: 'table', content: '', rows });
      continue;
    }

    if (line.startsWith('```')) {
      let codeContent = '';
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeContent += lines[i] + '\n';
        i++;
      }
      i++;
      elements.push({ type: 'code', content: codeContent.trim() });
      continue;
    }

    elements.push({ type: 'paragraph', content: line });
    i++;
  }

  return elements;
}

/**
 * Chuyển đổi parsed elements thành docx children
 */
function elementsToDocxChildren(elements: ParsedElement[], numberingConfig: any[]): any[] {
  const children: any[] = [];
  let listCounter = 0;

  for (const element of elements) {
    switch (element.type) {
      case 'heading':
        const headingLevel = element.level === 1 ? HeadingLevel.HEADING_1 :
          element.level === 2 ? HeadingLevel.HEADING_2 :
            element.level === 3 ? HeadingLevel.HEADING_3 :
              HeadingLevel.HEADING_4;
        children.push(new Paragraph({
          heading: headingLevel,
          children: parseInlineFormatting(element.content),
          spacing: { before: 240, after: 120, line: LINE_SPACING }
        }));
        break;

      case 'paragraph':
        children.push(new Paragraph({
          children: parseInlineFormatting(element.content),
          spacing: { after: 80, line: LINE_SPACING },
          alignment: AlignmentType.JUSTIFIED,
          indent: { firstLine: 720 } // Thụt đầu dòng chuẩn
        }));
        break;

      case 'list':
        const refName = element.isOrdered ? `numbered-${listCounter}` : `bullet-${listCounter}`;
        numberingConfig.push({
          reference: refName,
          levels: [{
            level: 0,
            format: element.isOrdered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: element.isOrdered ? '%1.' : '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          }]
        });
        for (const item of element.items || []) {
          children.push(new Paragraph({
            numbering: { reference: refName, level: 0 },
            children: parseInlineFormatting(item),
            spacing: { after: 60, line: LINE_SPACING }
          }));
        }
        listCounter++;
        break;

      case 'table':
        if (element.rows && element.rows.length > 0) {
          const maxColCount = Math.max(...element.rows.map(row => row.length));
          const colWidth = Math.floor(9360 / maxColCount);
          const tableBorder = { style: BorderStyle.SINGLE, size: 1, color: '000000' };
          const cellBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder };

          const tableRows = element.rows.map((row, rowIndex) => {
            const normalizedRow = [...row];
            while (normalizedRow.length < maxColCount) normalizedRow.push('');
            return new TableRow({
              tableHeader: rowIndex === 0,
              children: normalizedRow.map(cell =>
                new TableCell({
                  borders: cellBorders,
                  width: { size: colWidth, type: WidthType.DXA },
                  shading: rowIndex === 0 ? { fill: 'D5E8F0', type: ShadingType.CLEAR } : undefined,
                  children: [new Paragraph({
                    children: parseInlineFormatting(cell, SIZE_13),
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 40, after: 40 }
                  })]
                })
              )
            });
          });

          children.push(new Table({ columnWidths: Array(maxColCount).fill(colWidth), rows: tableRows }));
          children.push(new Paragraph({ spacing: { after: 80 } })); // Space after table
        }
        break;

      case 'code':
        const codeLines = element.content.split('\n');
        for (const codeLine of codeLines) {
          children.push(new Paragraph({
            children: [new TextRun({ text: codeLine, font: 'Consolas', size: 20 })],
            shading: { fill: 'F5F5F5' },
            spacing: { after: 0 }
          }));
        }
        children.push(new Paragraph({ spacing: { after: 80 } }));
        break;
    }
  }

  return children;
}

/**
 * Tạo dòng thông tin có nhãn + dấu chấm
 */
function createInfoLine(label: string, value: string, indent: number = 720): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, font: FONT, size: SIZE_14 }),
      new TextRun({ text: value || '............................................................', font: FONT, size: SIZE_14, italics: !value }),
    ],
    spacing: { after: 60, line: LINE_SPACING },
    indent: { left: indent }
  });
}

/**
 * Tạo Phần I: THÔNG TIN CHUNG VỀ SÁNG KIẾN
 */
function buildPartI(userInfo: ExportUserInfo): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // I. THÔNG TIN CHUNG VỀ SÁNG KIẾN
  paragraphs.push(new Paragraph({
    children: [new TextRun({ text: 'I. THÔNG TIN CHUNG VỀ SÁNG KIẾN', bold: true, font: FONT, size: SIZE_14 })],
    spacing: { before: 200, after: 120, line: LINE_SPACING }
  }));

  // 1. Tên sáng kiến
  paragraphs.push(new Paragraph({
    children: [
      new TextRun({ text: '1. Tên sáng kiến: ', bold: true, font: FONT, size: SIZE_14 }),
      new TextRun({ text: userInfo.topic || '...', font: FONT, size: SIZE_14 }),
    ],
    spacing: { after: 80, line: LINE_SPACING },
    indent: { firstLine: 360 }
  }));

  // 2. Lĩnh vực áp dụng sáng kiến
  paragraphs.push(new Paragraph({
    children: [
      new TextRun({ text: '2. Lĩnh vực áp dụng sáng kiến: ', bold: true, font: FONT, size: SIZE_14 }),
      new TextRun({ text: userInfo.fieldOfApplication || userInfo.subject || '...', font: FONT, size: SIZE_14 }),
    ],
    spacing: { after: 40, line: LINE_SPACING },
    indent: { firstLine: 360 }
  }));
  paragraphs.push(new Paragraph({
    children: [new TextRun({
      text: '(đề nghị ghi rõ lĩnh vực: cải cách hành chính, kinh tế - xã hội, kỹ thuật, công tác xây dựng đảng, đoàn thể )',
      font: FONT, size: SIZE_14, italics: true
    })],
    spacing: { after: 80, line: LINE_SPACING },
    indent: { firstLine: 360 }
  }));

  // 3. Tác giả
  paragraphs.push(new Paragraph({
    children: [new TextRun({ text: '3. Tác giả:', bold: true, font: FONT, size: SIZE_14 })],
    spacing: { after: 60, line: LINE_SPACING },
    indent: { firstLine: 360 }
  }));
  paragraphs.push(createInfoLine('Họ và tên', userInfo.authorName));
  paragraphs.push(createInfoLine('Ngày tháng/năm sinh', userInfo.authorDob));
  paragraphs.push(createInfoLine('Chức vụ, đơn vị công tác', userInfo.authorPosition));
  paragraphs.push(createInfoLine('Điện thoại', userInfo.authorPhone));

  // 4. Đồng tác giả
  paragraphs.push(new Paragraph({
    children: [new TextRun({ text: '4. Đồng tác giả ', bold: true, font: FONT, size: SIZE_14 }),
    new TextRun({ text: '(nếu có):', font: FONT, size: SIZE_14 })],
    spacing: { after: 60, line: LINE_SPACING },
    indent: { firstLine: 360 }
  }));
  if (userInfo.coAuthorName) {
    paragraphs.push(createInfoLine('Họ và tên', userInfo.coAuthorName));
    paragraphs.push(createInfoLine('Ngày tháng/năm sinh', userInfo.coAuthorDob));
    paragraphs.push(createInfoLine('Chức vụ, đơn vị công tác', userInfo.coAuthorPosition));
    paragraphs.push(createInfoLine('Điện thoại', userInfo.coAuthorPhone));
  } else {
    paragraphs.push(createInfoLine('Họ và tên', ''));
    paragraphs.push(createInfoLine('Ngày tháng/năm sinh', ''));
    paragraphs.push(createInfoLine('Chức vụ, đơn vị công tác', ''));
    paragraphs.push(createInfoLine('Điện thoại', ''));
  }

  // 5. Đơn vị áp dụng sáng kiến
  paragraphs.push(new Paragraph({
    children: [new TextRun({ text: '5. Đơn vị áp dụng sáng kiến:', bold: true, font: FONT, size: SIZE_14 })],
    spacing: { after: 60, line: LINE_SPACING },
    indent: { firstLine: 360 }
  }));
  paragraphs.push(createInfoLine('Tên đơn vị', userInfo.applicationUnit || userInfo.school));
  paragraphs.push(createInfoLine('Địa chỉ', userInfo.applicationAddress || userInfo.location));
  paragraphs.push(createInfoLine('Điện thoại', userInfo.applicationPhone));

  return paragraphs;
}

/**
 * Tạo khối chữ ký cuối văn bản
 */
function buildSignatureBlock(userInfo: ExportUserInfo): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

  // Spacer
  paragraphs.push(new Paragraph({ spacing: { before: 400 } }));

  // Bảng 2 cột: CƠ QUAN ĐƠN VỊ | TÁC GIẢ SÁNG KIẾN
  paragraphs.push(new Paragraph({ spacing: { after: 0 } })); // placeholder

  const signatureTable = new Table({
    columnWidths: [4680, 4680],
    rows: [
      // Row 1: Headers
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'CƠ QUAN ĐƠN VỊ', bold: true, font: FONT, size: SIZE_14 })],
                spacing: { after: 0 }
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'ÁP DỤNG SÁNG KIẾN', bold: true, font: FONT, size: SIZE_14 })],
                spacing: { after: 80 }
              }),
            ]
          }),
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'TÁC GIẢ SÁNG KIẾN', bold: true, font: FONT, size: SIZE_14 })],
                spacing: { after: 0 }
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '(Ghi rõ họ và tên, ký tên)', font: FONT, size: SIZE_14, italics: true })],
                spacing: { after: 80 }
              }),
            ]
          }),
        ]
      }),
      // Row 2: Content
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'Xác nhận sáng kiến đã được áp dụng', font: FONT, size: SIZE_14 })],
                spacing: { after: 20 }
              }),
              new Paragraph({
                children: [new TextRun({ text: '(hoặc áp dụng thử) từ ...ngày đến ..........', font: FONT, size: SIZE_14 })],
                spacing: { after: 20 }
              }),
              new Paragraph({
                children: [new TextRun({ text: 'Ngày...... và mang lại hiệu quả thực', font: FONT, size: SIZE_14 })],
                spacing: { after: 20 }
              }),
              new Paragraph({
                children: [new TextRun({ text: 'hiện tại......... theo đúng như các nội', font: FONT, size: SIZE_14 })],
                spacing: { after: 20 }
              }),
              new Paragraph({
                children: [new TextRun({ text: 'dung đã nêu trong thuyết minh.', font: FONT, size: SIZE_14 })],
                spacing: { after: 120 }
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '(Ký tên, đóng dấu)', font: FONT, size: SIZE_14, italics: true })],
                spacing: { after: 200 }
              }),
            ]
          }),
          new TableCell({
            borders: noBorders,
            width: { size: 4680, type: WidthType.DXA },
            children: [
              // Khoảng trống cho chữ ký tác giả
              new Paragraph({ spacing: { after: 200 } }),
              new Paragraph({ spacing: { after: 200 } }),
              new Paragraph({ spacing: { after: 200 } }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: userInfo.authorName || '......................', font: FONT, size: SIZE_14 })],
                spacing: { after: 120 }
              }),
              // Đồng tác giả
              new Paragraph({ spacing: { before: 200, after: 0 } }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: 'ĐỒNG TÁC GIẢ SÁNG KIẾN (nếu có)', bold: true, font: FONT, size: SIZE_14 })],
                spacing: { after: 0 }
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: '(Ghi rõ họ và tên, ký tên)', font: FONT, size: SIZE_14, italics: true })],
                spacing: { after: 200 }
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: userInfo.coAuthorName || '......................', font: FONT, size: SIZE_14 })],
                spacing: { after: 0 }
              }),
            ]
          }),
        ]
      }),
    ]
  });

  paragraphs.push(signatureTable as any);

  return paragraphs;
}

/**
 * Xuất SKKN sang file .docx theo đúng mẫu BẢN MÔ TẢ SÁNG KIẾN
 */
export async function exportSKKNToDocx(markdown: string, userInfo: ExportUserInfo, filename: string): Promise<void> {
  // Lọc bỏ Phần I từ markdown (đã tự động tạo từ userInfo)
  let cleanedMarkdown = markdown.replace(/#+\s*(I\.\s*THÔNG TIN CHUNG|PHẦN\s*I|I\.\s*Thông tin chung)[\s\S]*?(?=##?\s*(II\.|PHẦN\s*II|II\.\s*Mô tả))/i, '');
  // Chuẩn hóa viết hoa/thường tiếng Việt
  cleanedMarkdown = fixVietnameseCapitalization(cleanedMarkdown);

  const elements = parseMarkdown(cleanedMarkdown);
  const numberingConfig: any[] = [];
  const contentChildren = elementsToDocxChildren(elements, numberingConfig);

  // Build full document
  const allChildren: any[] = [];

  // === TIÊU ĐỀ ===
  allChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'BẢN MÔ TẢ SÁNG KIẾN', bold: true, font: FONT, size: SIZE_16 })],
    spacing: { after: 40, line: LINE_SPACING }
  }));
  allChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '(Toàn bộ bản mô tả sáng kiến viết từ 8-12 trang)', font: FONT, size: SIZE_14, italics: true })],
    spacing: { after: 200, line: LINE_SPACING }
  }));

  // === PHẦN I: THÔNG TIN CHUNG ===
  allChildren.push(...buildPartI(userInfo));

  // === NỘI DUNG AI (Phần II → III.4) ===
  allChildren.push(...contentChildren);

  // === KHỐI CHỮ KÝ ===
  allChildren.push(...buildSignatureBlock(userInfo));

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_14 }
        }
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: SIZE_14, bold: true, font: FONT },
          paragraph: { spacing: { before: 240, after: 120 } }
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: SIZE_14, bold: true, font: FONT },
          paragraph: { spacing: { before: 200, after: 100 } }
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: SIZE_14, bold: true, font: FONT, italics: true },
          paragraph: { spacing: { before: 160, after: 80 } }
        }
      ]
    },
    numbering: { config: numberingConfig },
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1701 } // 2cm trên/dưới/phải, 3cm trái
        }
      },
      children: allChildren
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Xuất Markdown sang file .docx (backward compatible - dùng cho phụ lục)
 */
export async function exportMarkdownToDocx(markdown: string, filename: string): Promise<void> {
  const elements = parseMarkdown(markdown);
  const numberingConfig: any[] = [];
  const children = elementsToDocxChildren(elements, numberingConfig);

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE_14 } }
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: SIZE_16, bold: true, font: FONT }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: SIZE_14, bold: true, font: FONT }, paragraph: { spacing: { before: 200, after: 100 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: SIZE_14, bold: true, font: FONT }, paragraph: { spacing: { before: 160, after: 80 } } },
      ]
    },
    numbering: { config: numberingConfig },
    sections: [{
      properties: {
        page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1701 } }
      },
      children
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
