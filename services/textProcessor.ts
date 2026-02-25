/**
 * Vietnamese Text Processor
 * Chuẩn hóa viết hoa/thường tiếng Việt trong output AI
 * Tham khảo từ chinhvanban-main/services/textProcessor.ts
 */

// Danh sách từ viết tắt cần giữ nguyên viết hoa
const WHITELIST_ACRONYMS = new Set([
    'KHBG', 'ĐGTX', 'NCBH', 'HSG', 'CSDL', 'KTTX', 'THPT',
    'GDĐT', 'UBND', 'HĐND', 'BGD', 'SỞ', 'PHÒNG', 'THCS', 'TP', 'VN', 'SGK',
    'GV', 'HS', 'BGH', 'CMHS', 'CNTT', 'SKKN', 'CSVC', 'GD', 'ĐT',
    'TH', 'MN', 'ĐHSP', 'CĐ', 'ĐH', 'PGD', 'SGD', 'BCH', 'ĐCS',
    'ATGT', 'PCCC', 'TDTT', 'VHTT', 'KT', 'XH', 'AI', 'ICT', 'STEM', 'STEAM',
    'UNESCO', 'UNICEF', 'WHO', 'COVID', 'OECD'
]);

const ROMAN_NUMERALS = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/;

// Regex phát hiện marker đầu dòng
const MARKER_REGEX = /^([-+*•]|\+\)|\d+[.)]|[a-zA-Z][.)]|[IVXLCDM]+[.)])$/;

const isMarker = (word: string) => MARKER_REGEX.test(word);
const hasEndPunctuation = (word: string) => /[.!?]$/.test(word);

/**
 * Xử lý 1 dòng text: sửa viết hoa/thường theo quy tắc tiếng Việt
 */
function processLine(line: string): string {
    if (!line.trim()) return line;

    // Giữ lại indentation
    const indentMatch = line.match(/^(\s+)/);
    const indent = indentMatch ? indentMatch[1] : '';
    let content = line.trim();

    // Nếu dòng bắt đầu bằng # (Markdown heading) → giữ nguyên
    if (/^#{1,6}\s/.test(content)) return line;

    // Nếu dòng là bảng markdown → giữ nguyên
    if (/^\|.*\|$/.test(content)) return line;

    // Nếu dòng chủ yếu viết hoa (>90%) và dài > 5 ký tự → coi là tiêu đề, giữ nguyên
    const upperCount = content.replace(/[^A-ZÀ-Ỹ]/g, '').length;
    const totalCount = content.replace(/[^a-zA-ZÀ-ỹ]/g, '').length;
    if (totalCount > 0 && (upperCount / totalCount) > 0.9 && content.length > 5) {
        return indent + content;
    }

    // Xử lý từng từ
    const words = content.split(/\s+/);
    const correctedWords: string[] = [];

    for (let i = 0; i < words.length; i++) {
        const word = words[i];

        // Tách từ và dấu câu
        const punctuationMatch = word.match(/^([^\wÀ-ỹ]*)([\wÀ-ỹ]+)([^\wÀ-ỹ]*)$/);
        if (!punctuationMatch) {
            correctedWords.push(word);
            continue;
        }

        const [, prePunct, coreWord, postPunct] = punctuationMatch;
        let fixedCoreWord = coreWord;

        // Xác định đầu câu/ý
        let isStartOfSentence = false;
        if (i === 0) {
            isStartOfSentence = true;
        } else {
            const prevWordRaw = words[i - 1];
            if (hasEndPunctuation(prevWordRaw) || isMarker(prevWordRaw)) {
                isStartOfSentence = true;
            }
        }

        // Whitelist & số La Mã → giữ nguyên
        const isWhitelisted = WHITELIST_ACRONYMS.has(coreWord.toUpperCase()) && coreWord === coreWord.toUpperCase();
        const isRoman = ROMAN_NUMERALS.test(coreWord.toUpperCase());
        if (isWhitelisted || isRoman) {
            correctedWords.push(word);
            continue;
        }

        // --- LOGIC SỬA LỖI ---

        // Lỗi Mixed Case: "KHông", "KHối" → về lowercase
        if (/^[A-ZÀ-Ỹ]{2,}[a-zà-ỹ]+$/.test(coreWord)) {
            fixedCoreWord = coreWord.toLowerCase();
        }
        // Lỗi VIẾT HOA TOÀN BỘ không phải viết tắt: "BÁO CÁO" → "báo cáo"
        else if (/^[A-ZÀ-Ỹ]{2,}$/.test(coreWord)) {
            fixedCoreWord = coreWord.toLowerCase();
        }
        // Từ Title Case (viết hoa đầu)
        else if (/^[A-ZÀ-Ỹ][a-zà-ỹ]+$/.test(coreWord)) {
            if (!isStartOfSentence) {
                let isLikelyName = false;

                // Lookahead: từ tiếp theo có viết hoa không?
                if (i < words.length - 1) {
                    const nextWordRaw = words[i + 1];
                    if (!postPunct.includes('.') && !postPunct.includes('!') && !postPunct.includes('?')) {
                        const nextMatch = nextWordRaw.match(/[\wÀ-ỹ]+/);
                        if (nextMatch && /^[A-ZÀ-Ỹ]/.test(nextMatch[0])) {
                            isLikelyName = true;
                        }
                    }
                }

                // Lookbehind: từ trước có viết hoa không?
                if (i > 0) {
                    const prevWordRaw = words[i - 1];
                    let prevWasStart = false;
                    if (i === 1) prevWasStart = true;
                    else {
                        const prevPrevRaw = words[i - 2];
                        if (hasEndPunctuation(prevPrevRaw) || isMarker(prevPrevRaw)) prevWasStart = true;
                    }
                    if (!prevWasStart) {
                        const prevMatch = prevWordRaw.match(/[\wÀ-ỹ]+/);
                        if (prevMatch && /^[A-ZÀ-Ỹ]/.test(prevMatch[0])) {
                            isLikelyName = true;
                        }
                    }
                }

                if (!isLikelyName) {
                    fixedCoreWord = coreWord.toLowerCase();
                }
            }
        }

        // Bắt buộc viết hoa đầu câu
        if (isStartOfSentence && fixedCoreWord.length > 0) {
            fixedCoreWord = fixedCoreWord.charAt(0).toUpperCase() + fixedCoreWord.slice(1);
        }

        correctedWords.push(prePunct + fixedCoreWord + postPunct);
    }

    return indent + correctedWords.join(' ');
}

/**
 * Chuẩn hóa viết hoa/thường cho toàn bộ văn bản tiếng Việt
 * Bảo toàn bảng markdown, heading, tiêu đề viết hoa
 */
export function fixVietnameseCapitalization(text: string): string {
    if (!text) return '';

    const lines = text.split('\n');
    return lines.map(processLine).join('\n');
}
