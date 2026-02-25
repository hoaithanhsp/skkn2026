import React, { useEffect, useState, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Edit, Save, X, FileText } from 'lucide-react';
import { Button } from './Button';

/**
 * Lightweight: Chỉ hiển thị phần cuối document khi đang streaming
 * Tránh ReactMarkdown parse lại 15,000+ ký tự mỗi chunk
 */
function StreamingPreview({ content }: { content: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Chỉ lấy ~4000 ký tự cuối để render nhẹ
  const TAIL_SIZE = 4000;
  const hasTruncated = content.length > TAIL_SIZE;
  const visibleContent = hasTruncated ? content.slice(-TAIL_SIZE) : content;

  // Auto-scroll xuống cuối
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [visibleContent]);

  return (
    <div className="h-full overflow-y-auto max-h-[calc(100vh-140px)] custom-scrollbar p-8 md:p-12">
      <article className="prose prose-sky prose-lg max-w-none text-gray-900 pb-12">
        {hasTruncated && (
          <div className="text-center text-gray-400 text-sm mb-4 py-2 border-b border-dashed border-gray-200">
            ⬆️ Nội dung phía trên ({Math.round((content.length - TAIL_SIZE) / 1000)}k ký tự) sẽ hiển thị đầy đủ sau khi viết xong
          </div>
        )}
        {/* Render plain text với basic formatting - CỰC NHẸ */}
        <div className="whitespace-pre-wrap font-serif text-base leading-relaxed">
          {visibleContent.split('\n').map((line, i) => {
            const trimmed = line.trim();
            // Headings
            if (trimmed.startsWith('### ')) return <h3 key={i} className="font-bold text-lg mt-4 mb-2">{trimmed.slice(4)}</h3>;
            if (trimmed.startsWith('## ')) return <h2 key={i} className="font-bold text-xl mt-5 mb-2">{trimmed.slice(3)}</h2>;
            if (trimmed.startsWith('# ')) return <h1 key={i} className="font-bold text-2xl mt-6 mb-3">{trimmed.slice(2)}</h1>;
            // Table rows
            if (trimmed.startsWith('|')) return <div key={i} className="font-mono text-sm bg-gray-50 px-2">{trimmed}</div>;
            // Separator
            if (trimmed === '---' || trimmed === '***') return <hr key={i} className="my-4" />;
            // Bold markers
            if (trimmed.startsWith('**') && trimmed.endsWith('**')) return <p key={i} className="font-bold my-1">{trimmed.slice(2, -2)}</p>;
            // List items
            if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) return <p key={i} className="ml-4 my-0.5">• {trimmed.slice(2)}</p>;
            if (/^\d+\.\s/.test(trimmed)) return <p key={i} className="ml-4 my-0.5">{trimmed}</p>;
            // Empty line
            if (!trimmed) return <div key={i} className="h-2" />;
            // Normal text
            return <p key={i} className="my-0.5">{trimmed}</p>;
          })}
        </div>
        <div className="flex items-center gap-2 mt-4 text-green-600 animate-pulse">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-bounce" />
          <span className="text-sm font-medium">Đang viết...</span>
        </div>
        <div ref={bottomRef} />
      </article>
    </div>
  );
}

/**
 * Format content để đảm bảo xuống dòng đúng cách
 * BẢO TOÀN các bảng markdown (|...|)
 */
function formatContent(text: string): string {
  if (!text) return text;

  const lines = text.split('\n');
  const processedLines: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    const isTableLine = /^\|.*\|$/.test(trimmedLine) || /^\|[\s\-:]+\|/.test(trimmedLine);

    if (isTableLine) {
      if (!inTable) {
        if (processedLines.length > 0) {
          const lastLine = processedLines[processedLines.length - 1];
          if (lastLine && lastLine.trim() !== '') processedLines.push('');
        }
        inTable = true;
      }
      processedLines.push(line);
    } else {
      if (inTable) {
        inTable = false;
        if (trimmedLine !== '') processedLines.push('');
      }
      processedLines.push(line);
    }
  }

  let formatted = processedLines.join('\n');

  const segments: { isTable: boolean; content: string }[] = [];
  const tablePattern = /((?:^[ \t]*\|.*\|[ \t]*$[\r\n]*)+)/gm;
  let lastIndex = 0;
  let match;

  while ((match = tablePattern.exec(formatted)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ isTable: false, content: formatted.slice(lastIndex, match.index) });
    }
    segments.push({ isTable: true, content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < formatted.length) {
    segments.push({ isTable: false, content: formatted.slice(lastIndex) });
  }
  if (segments.length === 0) {
    segments.push({ isTable: false, content: formatted });
  }

  const result = segments.map(segment => {
    if (segment.isTable) return segment.content;

    let content = segment.content;
    content = content.replace(/([^\n])\s*(•\s*Bước\s+\d+)/gi, '$1\n\n$2');
    content = content.replace(/([^\n])\s*(Bước\s+\d+\s*:)/gi, '$1\n\n$2');
    content = content.replace(/([^\n•])\s*•\s+/g, '$1\n\n• ');
    content = content.replace(/([^\n\d])\s+(\d+\.\s+[A-ZĐ])/g, '$1\n\n$2');
    content = content.replace(/([^\n])\s*(Trạm\s+\d+\s*:)/gi, '$1\n\n$2');
    content = content.replace(/([^\n])\s+(\d+\.\d+\.?\s+[A-ZĐ])/g, '$1\n\n$2');
    content = content.replace(/\.(\s{2,})([A-ZĐÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÈÉẺẼẸÊẾỀỂỄỆÌÍỈĨỊÒÓỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÙÚỦŨỤƯỨỪỬỮỰỲÝỶỸỴ])/g, '.\n\n$2');
    content = content.replace(/\n{4,}/g, '\n\n\n');
    return content;
  }).join('');

  return result;
}

interface Props {
  content: string;
  onUpdate?: (newContent: string) => void;
  isEditable?: boolean;
  isStreaming?: boolean;
}

export const DocumentPreview: React.FC<Props> = ({ content, onUpdate, isEditable = false, isStreaming = false }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempContent, setTempContent] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) setTempContent(content);
  }, [content, isEditing]);

  const handleSave = () => {
    if (onUpdate) onUpdate(tempContent);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempContent(content);
    setIsEditing(false);
  };

  const toggleEdit = () => {
    if (isEditing) {
      handleCancel();
    } else {
      setIsEditing(true);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        }
      }, 100);
    }
  };

  // Chỉ format khi KHÔNG streaming (tránh regex nặng mỗi chunk)
  const formattedContent = useMemo(() => {
    if (isStreaming) return content; // Skip formatting khi streaming
    return formatContent(content);
  }, [content, isStreaming]);

  return (
    <div className="bg-white shadow-xl rounded-xl border border-gray-200 min-h-[600px] h-full overflow-hidden flex flex-col relative">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex justify-between items-center flex-shrink-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="flex space-x-2">
            <div className="w-3 h-3 rounded-full bg-red-400"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <div className="w-3 h-3 rounded-full bg-green-400"></div>
          </div>
          <span className="text-gray-500 text-sm font-medium flex items-center gap-2">
            <FileText size={14} />
            Bản thảo SKKN.docx
            {isStreaming && <span className="text-green-600 animate-pulse text-xs ml-2">● Đang viết</span>}
          </span>
        </div>

        {isEditable && !isStreaming && (
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                >
                  <X size={14} /> Hủy
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 border border-transparent rounded hover:bg-green-700 transition-colors shadow-sm"
                >
                  <Save size={14} /> Lưu thay đổi
                </button>
              </>
            ) : (
              <button
                onClick={toggleEdit}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded hover:bg-sky-100 transition-colors"
              >
                <Edit size={14} /> Chỉnh sửa
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={tempContent}
            onChange={(e) => setTempContent(e.target.value)}
            className="w-full h-full p-8 md:p-12 resize-none focus:outline-none font-mono text-sm leading-relaxed text-gray-800 bg-gray-50 overflow-y-auto custom-scrollbar"
            placeholder="Nhập nội dung tại đây..."
            spellCheck={false}
          />
        ) : isStreaming ? (
          /* Khi streaming: dùng lightweight renderer - KHÔNG dùng ReactMarkdown */
          <StreamingPreview content={content} />
        ) : (
          /* Khi xong: full ReactMarkdown render */
          <div className="h-full overflow-y-auto max-h-[calc(100vh-140px)] custom-scrollbar p-8 md:p-12">
            {content ? (
              <article className="prose prose-sky prose-lg max-w-none text-gray-900 pb-12">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {formattedContent}
                </ReactMarkdown>
                <div ref={bottomRef} />
              </article>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
                <div className="w-16 h-16 border-4 border-gray-200 border-t-sky-500 rounded-full animate-spin"></div>
                <p>Đang chờ nội dung từ chuyên gia AI...</p>
              </div>
            )}
          </div>
        )}

        {isEditing && (
          <div className="absolute bottom-4 right-6 bg-black/75 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none backdrop-blur-sm">
            Nhấn "Lưu thay đổi" để cập nhật nội dung cho AI
          </div>
        )}
      </div>
    </div>
  );
};
