import React, { useState, useEffect, useCallback } from 'react';
import { UserInfo, GenerationStep, GenerationState, SKKNTemplate } from './types';
import { STEPS_INFO, SECTION_III_1_PROMPT, FALLBACK_MODELS, HIGHER_ED_LEVELS, HIGHER_ED_SYSTEM_INSTRUCTION } from './constants';
import { initializeGeminiChat, sendMessageStream, getFriendlyErrorMessage, parseApiError, getChatHistory, setChatHistory } from './services/geminiService';
import { apiKeyManager } from './services/apiKeyManager';
import { SKKNForm } from './components/SKKNForm';
import { DocumentPreview } from './components/DocumentPreview';
import { Button } from './components/Button';
import { ApiKeyModal } from './components/ApiKeyModal';
// SolutionReviewModal removed - mẫu mới không cần review từng giải pháp
import { Download, ChevronRight, Wand2, FileText, CheckCircle, RefreshCw, Settings, AlertTriangle, Save, Trash2 } from 'lucide-react';

import { LockScreen } from './components/LockScreen';

// Helper: Truncate text dài cho AI prompt - giữ phần đầu (nội dung chính) và thông báo lược bớt
const MAX_REF_DOCS_FOR_PROMPT = 80000; // ~80K ký tự tối đa cho tài liệu tham khảo trong prompt

const truncateForPrompt = (text: string, maxChars: number = MAX_REF_DOCS_FOR_PROMPT): string => {
  if (!text || text.length <= maxChars) return text;

  const truncated = text.substring(0, maxChars);
  const removedChars = text.length - maxChars;
  const estimatedPages = Math.round(removedChars / 2500); // ~2500 ký tự/trang A4

  return truncated + `\n\n[... ĐÃ LƯỢC BỚT ${removedChars.toLocaleString()} KÝ TỰ (~${estimatedPages} trang) DO QUÁ DÀI. Nội dung phía trên đã đủ để tham khảo các ý chính ...]`;
};

// SessionStorage key cho tài liệu tham khảo lớn
const SESSION_REF_DOCS_KEY = 'skkn_ref_docs';
const SESSION_REF_NAMES_KEY = 'skkn_ref_file_names';

// LocalStorage key cho lưu/khôi phục phiên làm việc
const SESSION_SAVE_KEY = 'skkn_session_data';

// Interface cho session data
interface SessionData {
  userInfo: Omit<UserInfo, 'referenceDocuments'> & { hasReferenceDocuments: boolean };
  state: {
    step: GenerationStep;
    messages: Array<{ role: string; text: string }>;
    fullDocument: string;
  };
  appendixDocument: string;
  outlineFeedback: string;
  chatHistory: any[];
  savedAt: string;
}

const App: React.FC = () => {
  // Lock Screen State
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Session Restore State
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [pendingSessionData, setPendingSessionData] = useState<SessionData | null>(null);
  const [sessionSavedAt, setSessionSavedAt] = useState<string | null>(null);

  // API Key State
  const [apiKey, setApiKey] = useState('');
  const [showApiModal, setShowApiModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODELS[0]);

  // Check LocalStorage on Mount
  useEffect(() => {
    const authState = localStorage.getItem('skkn_app_unlocked');
    if (authState === 'true') {
      setIsUnlocked(true);
    }

    // Load API key từ localStorage hoặc .env
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedModel = localStorage.getItem('selected_model');

    if (savedKey) {
      setApiKey(savedKey);
    } else {
      // Thử lấy key từ biến môi trường (.env)
      const envKeys = (import.meta.env.VITE_GEMINI_API_KEYS || '').split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
      if (envKeys.length > 0) {
        const firstEnvKey = envKeys[0];
        setApiKey(firstEnvKey);
        localStorage.setItem('gemini_api_key', firstEnvKey);
        console.log('🔑 Tự động sử dụng API key từ biến môi trường');
      } else {
        // Không có key nào → hiển thị modal bắt buộc nhập
        setShowApiModal(true);
      }
    }

    if (savedModel && FALLBACK_MODELS.includes(savedModel)) {
      setSelectedModel(savedModel);
    }

    // Kiểm tra phiên làm việc đã lưu
    try {
      const savedSession = localStorage.getItem(SESSION_SAVE_KEY);
      if (savedSession) {
        const sessionData: SessionData = JSON.parse(savedSession);
        // Chỉ hiện modal khôi phục nếu phiên có tiến trình (step > INPUT_FORM)
        if (sessionData.state && sessionData.state.step > GenerationStep.INPUT_FORM) {
          setPendingSessionData(sessionData);
          setShowRestoreModal(true);
        }
      }
    } catch (e) {
      console.warn('Không thể đọc phiên đã lưu:', e);
      localStorage.removeItem(SESSION_SAVE_KEY);
    }

    setCheckingAuth(false);
  }, []);

  const handleSaveApiKey = (key: string, model: string) => {
    localStorage.setItem('gemini_api_key', key);
    localStorage.setItem('selected_model', model);
    setApiKey(key);
    setSelectedModel(model);
    setShowApiModal(false);

    // 🆕 Nếu đang có lỗi (ví dụ: hết quota), clear error và reinitialize chat với key mới
    if (state.error) {
      setState(prev => ({ ...prev, error: null }));
      // Reinitialize chat session với key mới
      initializeGeminiChat(key, model);
    }
  };

  const handleLogin = (username: string) => {
    localStorage.setItem('skkn_app_unlocked', 'true');
    localStorage.setItem('skkn_logged_user', username);
    setIsUnlocked(true);
  };

  const [userInfo, setUserInfo] = useState<UserInfo>({
    topic: '',
    subject: '',
    level: '',
    grade: '',
    school: '',
    location: '',
    facilities: '',
    // Thông tin tác giả
    authorName: '',
    authorDob: '',
    authorPosition: '',
    authorPhone: '',
    // Đồng tác giả
    coAuthorName: '',
    coAuthorDob: '',
    coAuthorPosition: '',
    coAuthorPhone: '',
    // Đơn vị áp dụng
    applicationUnit: '',
    applicationAddress: '',
    applicationPhone: '',
    // Lĩnh vực
    fieldOfApplication: '',
    textbook: '',
    researchSubjects: '',
    timeframe: '',
    applyAI: '',
    focus: '',
    referenceDocuments: '',
    skknTemplate: '',
    specialRequirements: '',
    pageLimit: '',
    includePracticalExamples: false,
    includeStatistics: false,
    requirementsConfirmed: false,
    customTemplate: undefined
  });

  // Khôi phục referenceDocuments từ sessionStorage khi mount
  useEffect(() => {
    try {
      const savedRefDocs = sessionStorage.getItem(SESSION_REF_DOCS_KEY);
      if (savedRefDocs && !userInfo.referenceDocuments) {
        setUserInfo(prev => ({ ...prev, referenceDocuments: savedRefDocs }));
        console.log(`📄 Đã khôi phục tài liệu tham khảo từ session (${(savedRefDocs.length / 1024).toFixed(1)}KB)`);
      }
    } catch (e) {
      console.warn('Không thể khôi phục tài liệu tham khảo:', e);
    }
  }, []);

  // Lưu referenceDocuments vào sessionStorage khi thay đổi
  useEffect(() => {
    try {
      if (userInfo.referenceDocuments) {
        sessionStorage.setItem(SESSION_REF_DOCS_KEY, userInfo.referenceDocuments);
      } else {
        sessionStorage.removeItem(SESSION_REF_DOCS_KEY);
      }
    } catch (e) {
      console.warn('Text quá lớn cho sessionStorage, bỏ qua persistence:', e);
    }
  }, [userInfo.referenceDocuments]);

  const [state, setState] = useState<GenerationState>({
    step: GenerationStep.INPUT_FORM,
    messages: [],
    fullDocument: '',
    isStreaming: false,
    error: null
  });

  const [outlineFeedback, setOutlineFeedback] = useState("");

  // Phụ lục riêng biệt
  const [appendixDocument, setAppendixDocument] = useState('');
  const [isAppendixLoading, setIsAppendixLoading] = useState(false);

  // ═══════════════════════════════════════════════════════════
  // SESSION PERSISTENCE: Tự động lưu phiên vào localStorage
  // ═══════════════════════════════════════════════════════════

  // Hàm lưu phiên
  const saveSession = useCallback(() => {
    // Chỉ lưu khi đã bắt đầu làm việc (không lưu khi đang ở form nhập)
    if (state.step <= GenerationStep.INPUT_FORM || state.isStreaming) return;

    try {
      const sessionData: SessionData = {
        userInfo: {
          ...userInfo,
          referenceDocuments: '', // Không lưu ref docs (quá lớn, đã có sessionStorage)
          hasReferenceDocuments: !!userInfo.referenceDocuments,
        } as any,
        state: {
          step: state.step,
          messages: state.messages,
          fullDocument: state.fullDocument,
        },
        appendixDocument,
        outlineFeedback,
        chatHistory: getChatHistory(),
        savedAt: new Date().toISOString(),
      };

      localStorage.setItem(SESSION_SAVE_KEY, JSON.stringify(sessionData));
      setSessionSavedAt(new Date().toLocaleTimeString('vi-VN'));
      console.log('💾 Đã lưu phiên làm việc:', sessionData.state.step);
    } catch (e) {
      console.warn('Không thể lưu phiên (có thể do dữ liệu quá lớn):', e);
    }
  }, [state.step, state.messages, state.fullDocument, state.isStreaming, userInfo, appendixDocument, outlineFeedback]);

  // Tự động lưu khi state thay đổi (debounce 2 giây)
  useEffect(() => {
    if (state.step <= GenerationStep.INPUT_FORM || state.isStreaming) return;

    const timer = setTimeout(() => {
      saveSession();
    }, 2000);

    return () => clearTimeout(timer);
  }, [state.step, state.fullDocument, appendixDocument, saveSession]);

  // Hàm khôi phục phiên
  const restoreSession = useCallback((sessionData: SessionData) => {
    try {
      // Khôi phục userInfo (trừ referenceDocuments)
      const { hasReferenceDocuments, ...savedUserInfo } = sessionData.userInfo as any;
      setUserInfo(prev => ({
        ...prev,
        ...savedUserInfo,
        referenceDocuments: prev.referenceDocuments || '', // Giữ ref docs từ sessionStorage
      }));

      // Khôi phục GenerationState
      setState({
        step: sessionData.state.step,
        messages: (sessionData.state.messages || []) as any,
        fullDocument: sessionData.state.fullDocument || '',
        isStreaming: false,
        error: null,
      });

      // Khôi phục phụ lục
      if (sessionData.appendixDocument) {
        setAppendixDocument(sessionData.appendixDocument);
      }

      // Khôi phục outline feedback
      if (sessionData.outlineFeedback) {
        setOutlineFeedback(sessionData.outlineFeedback);
      }

      // Khôi phục chat history cho Gemini
      if (sessionData.chatHistory && sessionData.chatHistory.length > 0) {
        setChatHistory(sessionData.chatHistory);
      }

      // Initialize Gemini chat với API key
      const savedKey = localStorage.getItem('gemini_api_key');
      const savedModel = localStorage.getItem('selected_model');
      if (savedKey) {
        initializeGeminiChat(savedKey, savedModel || undefined);
        // Khôi phục history SAU khi init (vì init reset history)
        if (sessionData.chatHistory && sessionData.chatHistory.length > 0) {
          setChatHistory(sessionData.chatHistory);
        }
      }

      console.log('✅ Đã khôi phục phiên làm việc thành công!');
    } catch (e) {
      console.error('Lỗi khôi phục phiên:', e);
      setState(prev => ({ ...prev, error: 'Không thể khôi phục phiên làm việc. Vui lòng bắt đầu lại.' }));
    }
  }, []);

  // Hàm xóa phiên đã lưu
  const clearSavedSession = useCallback(() => {
    localStorage.removeItem(SESSION_SAVE_KEY);
    setSessionSavedAt(null);
    console.log('🗑 Đã xóa phiên làm việc đã lưu');
  }, []);

  // Helper: Tính toán phân bổ trang cho từng phần sáng kiến (8-12 trang)
  const getPageAllocation = useCallback(() => {
    if (!userInfo.pageLimit || typeof userInfo.pageLimit !== 'number') return null;

    const pages = userInfo.pageLimit;
    const wordsPerPage = 350;
    const charsPerPage = 2500;

    // Phân bổ theo mẫu: II (20%), III.1 (40%), III.2 (18%), III.3 (12%), III.4 (10%)
    const partII_pages = Math.max(1, Math.round(pages * 0.20)); // 1.5-2.5 trang
    const partIII_1_pages = Math.max(2, Math.round(pages * 0.40)); // 3-5 trang
    const partIII_2_pages = Math.max(1, Math.round(pages * 0.18)); // 1.5-2 trang
    const partIII_3_pages = Math.max(1, Math.round(pages * 0.12)); // 1-1.5 trang
    const partIII_4_pages = Math.max(1, pages - partII_pages - partIII_1_pages - partIII_2_pages - partIII_3_pages);

    return {
      totalPages: pages,
      wordsPerPage,
      charsPerPage,
      totalWords: pages * wordsPerPage,
      totalChars: pages * charsPerPage,
      partII: { pages: partII_pages, words: partII_pages * wordsPerPage, chars: partII_pages * charsPerPage },
      partIII_1: { pages: partIII_1_pages, words: partIII_1_pages * wordsPerPage, chars: partIII_1_pages * charsPerPage },
      partIII_2: { pages: partIII_2_pages, words: partIII_2_pages * wordsPerPage, chars: partIII_2_pages * charsPerPage },
      partIII_3: { pages: partIII_3_pages, words: partIII_3_pages * wordsPerPage, chars: partIII_3_pages * charsPerPage },
      partIII_4: { pages: partIII_4_pages, words: partIII_4_pages * wordsPerPage, chars: partIII_4_pages * charsPerPage },
    };
  }, [userInfo.pageLimit]);

  // Helper: Tạo prompt giới hạn số từ/trang cho MỘT phần cụ thể đang viết
  const getSectionPagePrompt = useCallback((sectionName: string, sectionKey: 'partII' | 'partIII_1' | 'partIII_2' | 'partIII_3' | 'partIII_4') => {
    const alloc = getPageAllocation();
    if (!alloc) return '';

    const section = alloc[sectionKey];
    return `
🚨 GIỚI HẠN SỐ TRANG CHO PHẦN NÀY (BẮT BUỘC):
📌 ${sectionName}: PHẢI viết khoảng ${section.pages} TRANG (≈ ${section.words.toLocaleString()} từ ≈ ${section.chars.toLocaleString()} ký tự)
⚠️ Trong tổng ${alloc.totalPages} trang sáng kiến, phần này chiếm ${section.pages} trang.
🚫 KHÔNG viết quá ${Math.ceil(section.pages * 1.15)} trang và KHÔNG viết dưới ${Math.max(1, Math.floor(section.pages * 0.85))} trang.
✅ Viết CÔ ĐỌNG, SÚC TÍCH nhưng ĐẦY ĐỦ NỘI DUNG.
`;
  }, [getPageAllocation]);

  // Helper function để tạo prompt nhắc lại các yêu cầu đặc biệt
  const getPageLimitPrompt = useCallback(() => {
    if (!userInfo.requirementsConfirmed) return '';

    const requirements: string[] = [];

    const alloc = getPageAllocation();
    if (alloc) {
      requirements.push(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 GIỚI HẠN SỐ TRANG - BẮT BUỘC TUYỆT ĐỐI 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 TỔNG SỐ TRANG YÊU CẦU: ${alloc.totalPages} TRANG (toàn bộ bản mô tả sáng kiến 8-12 trang)

📊 PHÂN BỔ CHI TIẾT TỪNG PHẦN:
│ Phần II (Giải pháp đã biết)     │ ${alloc.partII.pages} trang    │
│ Phần III.1 (Nội dung giải pháp) │ ${alloc.partIII_1.pages} trang   │
│ Phần III.2 (Tính mới, sáng tạo) │ ${alloc.partIII_2.pages} trang    │
│ Phần III.3 (Phạm vi ảnh hưởng)  │ ${alloc.partIII_3.pages} trang    │
│ Phần III.4 (Hiệu quả, lợi ích)  │ ${alloc.partIII_4.pages} trang    │

🚫 CẢNH BÁO: NẾU VƯỢT QUÁ ${alloc.totalPages} TRANG → VI PHẠM YÊU CẦU!
✅ MỤC TIÊU: Viết CÔ ĐỌNG, SÚC TÍCH nhưng vẫn ĐẦY ĐỦ NỘI DUNG.`);
    }

    if (userInfo.includePracticalExamples) {
      requirements.push(`
📊 YÊU CẦU THÊM VÍ DỤ THỰC TẾ:
- Mỗi phần PHẢI có ít nhất 2-3 ví dụ thực tế cụ thể`);
    }

    if (userInfo.includeStatistics) {
      requirements.push(`
📈 YÊU CẦU BỔ SUNG BẢNG BIỂU, SỐ LIỆU THỐNG KÊ:
- Sử dụng số liệu lẻ tự nhiên, bảng số liệu Markdown chuẩn`);
    }

    if (userInfo.specialRequirements && userInfo.specialRequirements.trim()) {
      requirements.push(`
✏️ YÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG:
${userInfo.specialRequirements}`);
    }

    if (requirements.length === 0) return '';

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CÁC YÊU CẦU ĐẶC BIỆT (BẮT BUỘC TUÂN THỦ):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${requirements.join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }, [userInfo.requirementsConfirmed, userInfo.pageLimit, userInfo.includePracticalExamples, userInfo.includeStatistics, userInfo.specialRequirements, getPageAllocation]);

  // Helper function để tạo prompt cấu trúc từ mẫu SKKN đã trích xuất
  const getCustomTemplatePrompt = useCallback(() => {
    if (!userInfo.customTemplate) return null;

    try {
      const template: SKKNTemplate = JSON.parse(userInfo.customTemplate);
      if (!template.sections || template.sections.length === 0) return null;

      const structureText = template.sections.map(s => {
        const indent = '  '.repeat(s.level - 1);
        const prefix = s.level === 1 ? '📌' : s.level === 2 ? '•' : '○';
        return `${indent}${prefix} ${s.id}. ${s.title}`;
      }).join('\n');

      return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 CẤU TRÚC MẪU SÁNG KIẾN TỪ ${template.name || 'Sở/Phòng GD'} (BẮT BUỘC TUYỆT ĐỐI) 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CẢNH BÁO: Đây là CẤU TRÚC DUY NHẤT được phép sử dụng.
✅ BẮT BUỘC TẠO DÀN Ý VÀ NỘI DUNG THEO ĐÚNG CẤU TRÚC NÀY:

${structureText}

[HẾT CẤU TRÚC MẪU - MỌI NỘI DUNG PHẢI TUÂN THỦ CẤU TRÚC TRÊN]
`;
    } catch (e) {
      console.error('Lỗi parse customTemplate:', e);
      return null;
    }
  }, [userInfo.customTemplate]);

  // Handle Input Changes
  const handleUserChange = (field: keyof UserInfo, value: string) => {
    setUserInfo(prev => {
      const updated = { ...prev, [field]: value };
      // Reset grade khi đổi cấp học giữa bậc phổ thông và bậc cao
      if (field === 'level') {
        const wasHigherEd = HIGHER_ED_LEVELS.includes(prev.level);
        const isHigherEd = HIGHER_ED_LEVELS.includes(value as string);
        if (wasHigherEd !== isHigherEd) {
          updated.grade = '';
        }
      }
      return updated;
    });
  };

  // Handle Manual Document Edit
  const handleDocumentUpdate = (newContent: string) => {
    setState(prev => ({ ...prev, fullDocument: newContent }));
  };

  // Handle Manual Outline Submission (Skip Generation)
  const handleManualOutlineSubmit = (content: string) => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }

    initializeGeminiChat(apiKey, selectedModel);

    setState(prev => ({
      ...prev,
      fullDocument: content,
      step: GenerationStep.OUTLINE,
      isStreaming: false,
      error: null
    }));
  };

  // Start the Generation Process
  const startGeneration = async () => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }

    try {
      setState(prev => ({ ...prev, step: GenerationStep.OUTLINE, isStreaming: true, error: null }));

      initializeGeminiChat(apiKey, selectedModel);

      const isHigherEd = HIGHER_ED_LEVELS.includes(userInfo.level);

      const initMessage = `
Bạn là chuyên gia giáo dục cấp quốc gia, có 20+ năm kinh nghiệm viết, thẩm định và chấm điểm Sáng kiến tại Việt Nam.
${isHigherEd ? `
⚠️ LƯU Ý QUAN TRỌNG: Đây là sáng kiến dành cho BẬC ${userInfo.level.toUpperCase()} - KHÔNG PHẢI PHỔ THÔNG.
` : ''}
NHIỆM VỤ CỦA BẠN:
Lập DÀN Ý CHI TIẾT cho một BẢN MÔ TẢ SÁNG KIẾN (8-12 trang) dựa trên thông tin tôi cung cấp.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THÔNG TIN ĐỀ TÀI:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Tên sáng kiến: ${userInfo.topic}
• Lĩnh vực áp dụng: ${userInfo.fieldOfApplication || userInfo.subject}
• Tác giả: ${userInfo.authorName || '(chưa cung cấp)'}
• Chức vụ, đơn vị: ${userInfo.authorPosition || '(chưa cung cấp)'}
• Đơn vị áp dụng: ${userInfo.applicationUnit || userInfo.school}
• Địa chỉ: ${userInfo.applicationAddress || userInfo.location}
• Môn học: ${userInfo.subject}
• Cấp học: ${userInfo.level}
• Khối lớp: ${userInfo.grade}
• Điều kiện CSVC: ${userInfo.facilities}
• Đối tượng nghiên cứu: ${userInfo.researchSubjects || 'Học sinh tại đơn vị'}
• Thời gian thực hiện: ${userInfo.timeframe || 'Năm học hiện tại'}
• Đặc thù/Công nghệ/AI: ${userInfo.applyAI ? userInfo.applyAI : ''} ${userInfo.focus ? `- ${userInfo.focus}` : ''}

${userInfo.referenceDocuments ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TÀI LIỆU THAM KHẢO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${truncateForPrompt(userInfo.referenceDocuments)}
[HẾT TÀI LIỆU THAM KHẢO]
` : ''}

${userInfo.customTemplate ? getCustomTemplatePrompt() : (userInfo.skknTemplate ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 MẪU YÊU CẦU SÁNG KIẾN (BẮT BUỘC):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${userInfo.skknTemplate}
[HẾT MẪU]
` : '')}

${userInfo.specialRequirements ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YÊU CẦU ĐẶC BIỆT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${userInfo.specialRequirements}
[HẾT YÊU CẦU ĐẶC BIỆT]
` : ''}

${isHigherEd ? HIGHER_ED_SYSTEM_INSTRUCTION : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CẤU TRÚC BẢN MÔ TẢ SÁNG KIẾN (8-12 TRANG):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

I. THÔNG TIN CHUNG VỀ SÁNG KIẾN
   1. Tên sáng kiến
   2. Lĩnh vực áp dụng sáng kiến
   3. Tác giả (Họ tên, Ngày sinh, Chức vụ, Điện thoại)
   4. Đồng tác giả (nếu có)
   5. Đơn vị áp dụng sáng kiến

II. MÔ TẢ GIẢI PHÁP ĐÃ BIẾT (1,5-2,5 trang)
   → Thực trạng giải pháp đã biết tại Việt Nam, Hải Phòng và tại đơn vị
   → Ưu điểm của giải pháp đã biết
   → Tồn tại, bất cập, nhược điểm
   → Từ đó đưa ra giải pháp đề nghị công nhận sáng kiến

III. NỘI DUNG GIẢI PHÁP ĐỀ NGHỊ CÔNG NHẬN SÁNG KIẾN

   III.1. Nội dung giải pháp (3-5 trang)
   → Nêu các bước, các nội dung thực hiện giải pháp
   → Chi tiết cách làm, quy trình

   III.2. Tính mới, tính sáng tạo (1,5-2 trang)
   → Các nội dung cải tiến, sáng tạo
   → Tính ưu việt so với giải pháp đã biết

   III.3. Phạm vi ảnh hưởng, khả năng áp dụng (1-1,5 trang)
   → Khả năng áp dụng cho đối tượng, cơ quan khác
   → Phạm vi ảnh hưởng rộng

   III.4. Hiệu quả, lợi ích thu được
   → So sánh trước và sau áp dụng sáng kiến
   → Minh chứng cụ thể

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YÊU CẦU DÀN Ý (NGẮN GỌN - CHỈ ĐẦU MỤC):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Mỗi phần chỉ ghi tiêu đề mục và các ý chính (1-2 dòng mỗi ý)
✓ KHÔNG viết đoạn văn dài trong dàn ý
✓ Phù hợp với đặc thù môn ${userInfo.subject} và cấp ${userInfo.level}

${getPageLimitPrompt()}

Kết thúc phần dàn ý, hiển thị hộp thoại:
┌─────────────────────────────────┐
│ ✅ Đồng ý dàn ý này ?            │
│ ✏️ Bạn có thể CHỈNH SỬA trực   │
│    tiếp bằng nút "Chỉnh sửa"    │
└─────────────────────────────────┘
`;

      let generatedText = "";
      await sendMessageStream(initMessage, (chunk) => {
        generatedText += chunk;
        setState(prev => ({
          ...prev,
          fullDocument: generatedText
        }));
      });

      setState(prev => ({ ...prev, isStreaming: false }));

    } catch (error: any) {
      const errorType = parseApiError(error);
      if (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT') {
        const rotation = apiKeyManager.markKeyError(apiKey, errorType);
        if (rotation.success && rotation.newKey) {
          console.log(`🔄 Tự động xoay key: ${rotation.message}`);
          setApiKey(rotation.newKey);
          localStorage.setItem('gemini_api_key', rotation.newKey);
          initializeGeminiChat(rotation.newKey, selectedModel);
          setState(prev => ({ ...prev, isStreaming: false, error: null }));
          setTimeout(() => startGeneration(), 500);
          return;
        }
      }
      setState(prev => ({ ...prev, isStreaming: false, error: error.message || "Failed to generate." }));
    }
  };

  // Regenerate Outline based on feedback
  const regenerateOutline = async () => {
    if (!outlineFeedback.trim()) return;

    try {
      setState(prev => ({ ...prev, isStreaming: true, error: null, fullDocument: '' }));

      const feedbackMessage = `
      Dựa trên dàn ý đã lập, người dùng có yêu cầu chỉnh sửa sau:
"${outlineFeedback}"
      
      Hãy viết lại TOÀN BỘ Dàn ý chi tiết mới đã được cập nhật theo yêu cầu trên. 
      Vẫn đảm bảo cấu trúc chuẩn Bản mô tả sáng kiến (I, II, III.1-III.4).
      
      Kết thúc phần dàn ý, hiển thị hộp thoại:
      ┌─────────────────────────────────┐
      │ ✅ Đồng ý dàn ý này ?            │
      │ ✏️ Bạn có thể CHỈNH SỬA trực   │
      │    tiếp bằng nút "Chỉnh sửa"    │
      └─────────────────────────────────┘
`;

      let generatedText = "";
      await sendMessageStream(feedbackMessage, (chunk) => {
        generatedText += chunk;
        setState(prev => ({
          ...prev,
          fullDocument: generatedText
        }));
      });

      setState(prev => ({ ...prev, isStreaming: false }));
      setOutlineFeedback("");

    } catch (error: any) {
      setState(prev => ({ ...prev, isStreaming: false, error: error.message }));
    }
  };

  // Generate Next Section
  const generateNextSection = async () => {
    let currentStepPrompt = "";
    let nextStepEnum = GenerationStep.PART_I;
    let shouldAppend = true;

    if (state.step === GenerationStep.OUTLINE) {
      // Từ Dàn ý → Phần I (Thông tin chung) - tự fill từ form
      const partIContent = `

---

## I. THÔNG TIN CHUNG VỀ SÁNG KIẾN

**1. Tên sáng kiến:** ${userInfo.topic}

**2. Lĩnh vực áp dụng sáng kiến:** ${userInfo.fieldOfApplication || userInfo.subject}

**3. Tác giả:**
- Họ và tên: ${userInfo.authorName || '...........................'}
- Ngày tháng/năm sinh: ${userInfo.authorDob || '...........................'}
- Chức vụ, đơn vị công tác: ${userInfo.authorPosition || '...........................'}
- Điện thoại: ${userInfo.authorPhone || '...........................'}

${userInfo.coAuthorName ? `**4. Đồng tác giả:**
- Họ và tên: ${userInfo.coAuthorName}
- Ngày tháng/năm sinh: ${userInfo.coAuthorDob || '...........................'}
- Chức vụ, đơn vị công tác: ${userInfo.coAuthorPosition || '...........................'}
- Điện thoại: ${userInfo.coAuthorPhone || '...........................'}
` : '**4. Đồng tác giả:** Không có'}

**5. Đơn vị áp dụng sáng kiến:**
- Tên đơn vị: ${userInfo.applicationUnit || userInfo.school}
- Địa chỉ: ${userInfo.applicationAddress || userInfo.location}
- Điện thoại: ${userInfo.applicationPhone || '...........................'}
`;

      // Tự fill Phần I và gửi prompt cho Phần II
      setState(prev => ({
        ...prev,
        fullDocument: prev.fullDocument + partIContent,
      }));

      currentStepPrompt = `
Đây là bản DÀN Ý CHÍNH THỨC mà tôi đã chốt. Hãy DÙNG CHÍNH XÁC NỘI DUNG NÀY:

--- BẮT ĐẦU DÀN Ý CHÍNH THỨC ---
${state.fullDocument}
--- KẾT THÚC DÀN Ý CHÍNH THỨC ---

Phần I (Thông tin chung) đã được tự động điền.

NHIỆM VỤ TIẾP THEO:
Hãy viết chi tiết PHẦN II: MÔ TẢ GIẢI PHÁP ĐÃ BIẾT (1,5-2,5 trang).
- Mô tả thực trạng giải pháp đã biết và đang triển khai tại Việt Nam, tại địa phương ${userInfo.location} và tại đơn vị ${userInfo.applicationUnit || userInfo.school}
- Nêu ưu điểm của giải pháp đã biết
- Đặc biệt nêu rõ tồn tại, bất cập, nhược điểm
- Từ đó đưa ra giải pháp đề nghị công nhận sáng kiến

⚠️ NHẮC LẠI: Đây là sáng kiến cấp ${userInfo.level}, khối ${userInfo.grade}, môn ${userInfo.subject}.
Trường: ${userInfo.school}, Địa phương: ${userInfo.location}

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần II (Mô tả giải pháp đã biết)', 'partII')}
`;
      nextStepEnum = GenerationStep.PART_II;
    } else {
      const nextStepMap: Record<number, { prompt: string, nextStep: GenerationStep, skipAppend?: boolean }> = {
        [GenerationStep.PART_I]: {
          // Trường hợp step PART_I (nếu navigate lại)
          prompt: `
Viết chi tiết PHẦN II: MÔ TẢ GIẢI PHÁP ĐÃ BIẾT (1,5-2,5 trang).
- Mô tả thực trạng giải pháp đã biết tại Việt Nam, tại ${userInfo.location} và tại ${userInfo.applicationUnit || userInfo.school}
- Ưu điểm, tồn tại, bất cập, nhược điểm
- Từ đó đưa ra giải pháp đề nghị công nhận sáng kiến

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần II', 'partII')}
`,
          nextStep: GenerationStep.PART_II
        },
        [GenerationStep.PART_II]: {
          prompt: `
${SECTION_III_1_PROMPT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 THỰC THI: PHẦN III.1 - NỘI DUNG GIẢI PHÁP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Thông tin: "${userInfo.topic}"
Môn: ${userInfo.subject} - Cấp: ${userInfo.level} - Lớp: ${userInfo.grade}
Trường: ${userInfo.school}
CSVC: ${userInfo.facilities}
Công nghệ/AI: ${userInfo.applyAI}

YÊU CẦU:
Viết chi tiết PHẦN III.1: NỘI DUNG GIẢI PHÁP ĐỀ NGHỊ CÔNG NHẬN SÁNG KIẾN (3-5 trang).
- Nêu các bước, các nội dung thực hiện giải pháp
- Chi tiết, cụ thể, có ví dụ minh họa
- Viết gọn, súc tích nhưng đầy đủ

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần III.1 (Nội dung giải pháp)', 'partIII_1')}
`,
          nextStep: GenerationStep.PART_III_1
        },
        [GenerationStep.PART_III_1]: {
          prompt: `
Tiếp tục viết PHẦN III.2: TÍNH MỚI, TÍNH SÁNG TẠO (1,5-2 trang).
- Nêu các nội dung đã cải tiến, sáng tạo
- Tính ưu việt của giải pháp đề nghị công nhận sáng kiến
- So sánh với giải pháp đã biết (Phần II) để làm rõ điểm mới

Đề tài: "${userInfo.topic}"
Cấp: ${userInfo.level}, Môn: ${userInfo.subject}

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần III.2 (Tính mới, tính sáng tạo)', 'partIII_2')}
`,
          nextStep: GenerationStep.PART_III_2
        },
        [GenerationStep.PART_III_2]: {
          prompt: `
Tiếp tục viết PHẦN III.3: PHẠM VI ẢNH HƯỞNG, KHẢ NĂNG ÁP DỤNG CỦA SÁNG KIẾN (1-1,5 trang).
- Chứng minh, phân tích giải pháp có khả năng áp dụng đối với cơ quan, đơn vị khác
- Chứng minh sáng kiến có phạm vi ảnh hưởng rộng ở cơ sở (cơ quan, đơn vị, địa phương), thành phố
- Nêu điều kiện áp dụng

Đơn vị: ${userInfo.applicationUnit || userInfo.school}
Địa phương: ${userInfo.location}

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần III.3 (Phạm vi ảnh hưởng)', 'partIII_3')}
`,
          nextStep: GenerationStep.PART_III_3
        },
        [GenerationStep.PART_III_3]: {
          prompt: `
Tiếp tục viết PHẦN III.4: HIỆU QUẢ, LỢI ÍCH THU ĐƯỢC TỪ SÁNG KIẾN.
- Đánh giá lợi ích thu được hoặc dự kiến thu được
- So sánh tình trạng TRƯỚC và SAU áp dụng sáng kiến → hiệu quả thế nào?
- Minh chứng cụ thể: bảng số liệu, tỷ lệ %, kết quả cụ thể
- Dùng số liệu lẻ (42.3%, 67.8%) thay vì số tròn
- Có bảng so sánh trước/sau (Markdown table chuẩn)

Đề tài: "${userInfo.topic}"
Đối tượng: ${userInfo.researchSubjects || 'Học sinh tại đơn vị'}
Thời gian: ${userInfo.timeframe || 'Năm học hiện tại'}

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần III.4 (Hiệu quả, lợi ích)', 'partIII_4')}
`,
          nextStep: GenerationStep.PART_III_4
        },
        [GenerationStep.PART_III_4]: {
          prompt: `
✅ BẢN MÔ TẢ SÁNG KIẾN ĐÃ HOÀN THÀNH!

Bạn đã viết xong toàn bộ nội dung Bản mô tả sáng kiến.
Bao gồm: I. Thông tin chung, II. Mô tả giải pháp đã biết, III.1-III.4 Nội dung giải pháp.

📌 BÂY GIỜ BẠN CÓ THỂ:
1. Xuất file Word để chỉnh sửa chi tiết
2. Kiểm tra lại nội dung và định dạng

Chúc mừng bạn đã hoàn thành bản mô tả sáng kiến!`,
          nextStep: GenerationStep.COMPLETED,
          skipAppend: true
        }
      };
      const stepConfig = nextStepMap[state.step];
      if (!stepConfig) return;
      currentStepPrompt = stepConfig.prompt;
      nextStepEnum = stepConfig.nextStep;
      shouldAppend = !stepConfig.skipAppend;
    }

    if (!currentStepPrompt) return;

    setState(prev => ({ ...prev, isStreaming: true, error: null, step: nextStepEnum }));

    try {
      let sectionText = "\n\n---\n\n";
      await sendMessageStream(currentStepPrompt, (chunk) => {
        sectionText += chunk;
        if (shouldAppend) {
          setState(prev => ({
            ...prev,
            fullDocument: prev.fullDocument + chunk
          }));
        }
      });

      setState(prev => ({ ...prev, isStreaming: false }));

    } catch (error: any) {
      const errorType = parseApiError(error);
      if (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT') {
        const rotation = apiKeyManager.markKeyError(apiKey, errorType);
        if (rotation.success && rotation.newKey) {
          console.log(`🔄 Tự động xoay key: ${rotation.message}`);
          setApiKey(rotation.newKey);
          localStorage.setItem('gemini_api_key', rotation.newKey);
          initializeGeminiChat(rotation.newKey, selectedModel);
          setState(prev => ({ ...prev, isStreaming: false, error: null }));
          setTimeout(() => generateNextSection(), 500);
          return;
        }
      }
      setState(prev => ({ ...prev, isStreaming: false, error: error.message }));
    }
  };

  // Export to Word
  const exportToWord = async () => {
    try {
      const { exportMarkdownToDocx } = await import('./services/docxExporter');
      const filename = `SangKien_${userInfo.topic.substring(0, 30).replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '_')}.docx`;
      await exportMarkdownToDocx(state.fullDocument, filename);
    } catch (error: any) {
      console.error('Export error:', error);
      alert('Có lỗi khi xuất file. Vui lòng thử lại.');
    }
  };

  // Generate Appendix - Function riêng để tạo phụ lục
  const generateAppendix = async () => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }

    try {
      setIsAppendixLoading(true);

      const appendixPrompt = `
Dựa trên BẢN MÔ TẢ SÁNG KIẾN đã viết hoàn chỉnh, hãy tạo PHỤ LỤC bổ sung:

ĐỀ TÀI: "${userInfo.topic}"
MÔN: ${userInfo.subject} - CẤP: ${userInfo.level} - LỚP: ${userInfo.grade}

PHỤ LỤC CẦN CÓ:
1. Phiếu khảo sát (trước và sau áp dụng sáng kiến)
2. Đề kiểm tra / Đề đánh giá (nếu phù hợp)
3. Bảng tổng hợp kết quả
4. Ảnh minh họa (placeholder: [HÌNH ẢNH: mô tả])
5. Các biểu mẫu, công cụ hỗ trợ

Format: Markdown chuẩn, bảng biểu dùng | | |
`;

      let appendixText = "";
      await sendMessageStream(appendixPrompt, (chunk) => {
        appendixText += chunk;
        setAppendixDocument(appendixText);
      });

      setIsAppendixLoading(false);
    } catch (error: any) {
      console.error('Appendix error:', error);
      setIsAppendixLoading(false);
      setAppendixDocument('');
      alert('Có lỗi khi tạo phụ lục. Vui lòng thử lại.');
    }
  };

  // Export Appendix to Word
  const exportAppendixToWord = async () => {
    try {
      const { exportMarkdownToDocx } = await import('./services/docxExporter');
      const filename = `PhuLuc_${userInfo.topic.substring(0, 20).replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '_')}.docx`;
      await exportMarkdownToDocx(appendixDocument, filename);
    } catch (error: any) {
      console.error('Export appendix error:', error);
      alert('Có lỗi khi xuất file phụ lục.');
    }
  };

  // Render Logic
  const renderSidebar = () => {
    return (
      <div className="w-full lg:w-80 bg-gradient-to-b from-white to-sky-50 border-r border-sky-100 p-6 flex-shrink-0 flex flex-col h-full overflow-y-auto shadow-[4px_0_24px_rgba(56,189,248,0.08)]">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-sky-500 flex items-center gap-2" style={{ fontFamily: 'Nunito, sans-serif' }}>
            <Wand2 className="h-6 w-6 text-blue-500" />
            SKKN PRO
          </h1>
          <p className="text-xs text-blue-800 font-medium mt-1.5 tracking-wide">✨ Trợ lý viết Sáng kiến thông minh</p>
        </div>

        {/* Progress Stepper */}
        <div className="space-y-6">
          {Object.entries(STEPS_INFO).map(([key, info]) => {
            const stepNum = parseInt(key);

            let statusColor = "text-gray-400 border-gray-200";
            let icon = <div className="w-2 h-2 rounded-full bg-gray-300" />;

            // ERROR STATE HANDLING
            if (state.error && state.step === stepNum) {
              statusColor = "text-red-600 border-red-600 bg-red-50";
              icon = <AlertTriangle className="w-4 h-4 text-red-600" />;
            }
            else if (state.step === stepNum && state.isStreaming) {
              statusColor = "text-sky-600 border-sky-600 bg-sky-50";
              icon = <div className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />;
            } else if (state.step > stepNum) {
              statusColor = "text-sky-800 border-sky-200";
              icon = <CheckCircle className="w-4 h-4 text-sky-600" />;
            } else if (state.step === stepNum) {
              statusColor = "text-sky-600 border-sky-600 font-bold";
              icon = <div className="w-2 h-2 rounded-full bg-sky-600" />;
            }

            const isClickable = state.step > stepNum && !state.isStreaming;
            const handleStepClick = () => {
              if (isClickable) {
                setState(prev => ({ ...prev, step: stepNum }));
              }
            };

            return (
              <div
                key={key}
                onClick={handleStepClick}
                className={`flex items-start pl-4 border-l-2 ${statusColor.includes('border-sky') ? 'border-sky-500' : statusColor.includes('border-red') ? 'border-red-500' : 'border-gray-200'} py-1 transition-all ${isClickable ? 'cursor-pointer hover:bg-sky-50 rounded-r-lg' : ''}`}
              >
                <div className="flex-1">
                  <h4 className={`text-sm ${statusColor.includes('text-sky') ? 'text-sky-900' : statusColor.includes('text-red') ? 'text-red-700' : 'text-gray-500'} font-medium`}>
                    {state.error && state.step === stepNum ? "Đã dừng do lỗi" : info.label}
                  </h4>
                  <p className="text-xs text-gray-400">{info.description}</p>
                </div>
                <div className="ml-2 mt-1">
                  {icon}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-auto pt-6 border-t border-gray-100">
          {state.step > GenerationStep.INPUT_FORM && (
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded text-xs text-gray-500 border border-gray-100">
                <span className="font-bold block text-gray-900">Đề tài:</span>
                {userInfo.topic}
              </div>

              {/* Session persistence buttons */}
              <div className="flex gap-2">
                <button
                  onClick={saveSession}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium transition-colors border border-emerald-200"
                  title="Lưu phiên làm việc"
                >
                  <Save size={13} />
                  Lưu phiên
                </button>
                <button
                  onClick={() => {
                    if (confirm('Xóa phiên đã lưu? Bạn sẽ không thể khôi phục lại.')) {
                      clearSavedSession();
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition-colors border border-red-200"
                  title="Xóa phiên đã lưu"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {sessionSavedAt && (
                <p className="text-[10px] text-gray-400 text-center">
                  💾 Lưu lúc {sessionSavedAt}
                </p>
              )}

              {/* Controls */}
              {state.isStreaming ? (
                <Button disabled className="w-full" isLoading>Đang viết...</Button>
              ) : (
                state.step < GenerationStep.COMPLETED && (
                  <>
                    {/* Feedback / Review Section only for OUTLINE Step */}
                    {state.step === GenerationStep.OUTLINE && (
                      <div className="mb-2 space-y-2 border-t border-gray-100 pt-2">
                        <p className="text-sm font-semibold text-sky-700">Điều chỉnh:</p>

                        <div className="text-xs text-gray-500 italic mb-2">
                          💡 Mẹo: Bạn có thể sửa trực tiếp Dàn ý ở màn hình bên phải trước khi bấm "Chốt & Viết tiếp".
                        </div>

                        <textarea
                          value={outlineFeedback}
                          onChange={(e) => setOutlineFeedback(e.target.value)}
                          placeholder="Hoặc nhập yêu cầu để AI viết lại..."
                          className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-sky-500 focus:border-sky-500"
                          rows={3}
                        />
                        <Button
                          variant="secondary"
                          onClick={regenerateOutline}
                          disabled={!outlineFeedback.trim()}
                          className="w-full text-sm"
                          icon={<RefreshCw size={14} />}
                        >
                          Yêu cầu AI viết lại
                        </Button>
                      </div>
                    )}

                    <Button onClick={generateNextSection} className="w-full" icon={<ChevronRight size={16} />}>
                      {state.step === GenerationStep.OUTLINE ? 'Chốt Dàn ý & Viết tiếp' : 'Viết phần tiếp theo'}
                    </Button>
                  </>
                )
              )}

              {/* Nút xuất Word */}
              {(state.step >= GenerationStep.OUTLINE) && (
                <Button variant="secondary" onClick={exportToWord} className="w-full" icon={<Download size={16} />}>
                  Xuất file Word
                </Button>
              )}

              {/* Sau khi hoàn thành: hiển thị các nút phụ lục */}
              {state.step >= GenerationStep.COMPLETED && (
                <>
                  {!appendixDocument ? (
                    <Button
                      onClick={generateAppendix}
                      isLoading={isAppendixLoading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      icon={<FileText size={16} />}
                    >
                      {isAppendixLoading ? 'Đang tạo phụ lục...' : 'TẠO PHỤ LỤC'}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={exportAppendixToWord}
                      className="w-full border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                      icon={<Download size={16} />}
                    >
                      Xuất Word Phụ lục
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (checkingAuth) {
    return <div className="h-screen w-screen bg-white flex items-center justify-center"></div>;
  }

  if (!isUnlocked) {
    return <LockScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 flex flex-col lg:flex-row font-sans text-gray-900">
      <ApiKeyModal
        isOpen={showApiModal}
        onSave={handleSaveApiKey}
        onClose={() => setShowApiModal(false)}
        isDismissible={!!apiKey}
      />

      {/* Session Restore Modal */}
      {showRestoreModal && pendingSessionData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-sky-500 p-6 text-white">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <Save className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Khôi phục phiên làm việc</h3>
                  <p className="text-sm text-blue-100">Bạn có phiên làm việc chưa hoàn thành</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-700">
                  <span className="font-semibold text-sky-800">Đề tài:</span>{' '}
                  {(pendingSessionData.userInfo as any).topic || 'Không rõ'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Đã lưu lúc: {new Date(pendingSessionData.savedAt).toLocaleString('vi-VN')}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Tiến độ: Bước {pendingSessionData.state.step} / {GenerationStep.COMPLETED}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowRestoreModal(false);
                    clearSavedSession();
                    setPendingSessionData(null);
                  }}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors text-sm"
                >
                  ✖ Bắt đầu mới
                </button>
                <button
                  onClick={() => {
                    restoreSession(pendingSessionData);
                    setShowRestoreModal(false);
                    setPendingSessionData(null);
                  }}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-sky-500 hover:from-blue-600 hover:to-sky-600 text-white rounded-xl font-bold transition-colors text-sm shadow-lg"
                >
                  ✔ Tiếp tục làm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header Button for Settings */}
      <button
        onClick={() => setShowApiModal(true)}
        className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-blue-100 hover:bg-blue-50 hover:border-blue-200 hover:shadow-xl transition-all duration-200"
        title="Cấu hình API Key"
      >
        <Settings size={18} className="text-blue-600" />
        <span className="text-blue-700 font-semibold text-sm hidden sm:inline">⚙️ Cài đặt API Key</span>
      </button>

      {/* Sidebar (Desktop) */}
      <div className="hidden lg:block h-screen sticky top-0 z-20">
        {renderSidebar()}
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 lg:p-8 flex flex-col h-screen overflow-hidden relative">

        {/* Mobile Header */}
        <div className="lg:hidden mb-4 bg-gradient-to-r from-white to-sky-50 p-4 rounded-xl shadow-lg border border-sky-100 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <h1 className="font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-sky-500 text-xl" style={{ fontFamily: 'Nunito, sans-serif' }}>SKKN PRO</h1>
            <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">
              {STEPS_INFO[state.step < 9 ? state.step : 8].label}
            </span>
          </div>
          <p className="text-xs text-blue-700 font-medium">✨ Trợ lý viết Sáng kiến thông minh</p>
        </div>

        {state.error && (() => {
          const errorInfo = getFriendlyErrorMessage({ message: state.error });
          return (
            <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-5 mb-4 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-red-800 text-lg">{errorInfo.title}</h3>
                  <p className="text-red-700 text-sm mt-1">{errorInfo.message}</p>
                </div>
              </div>

              <div className="bg-white/70 rounded-lg p-4 mt-3 border border-red-100">
                <p className="text-sm font-semibold text-gray-700 mb-2">💡 Gợi ý khắc phục:</p>
                <ul className="space-y-2">
                  {errorInfo.suggestions.map((suggestion, index) => (
                    <li key={index} className="text-sm text-gray-600 flex items-start gap-2">
                      <span className="text-gray-400">•</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => setState(prev => ({ ...prev, error: null }))}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  ✕ Đóng thông báo
                </button>
                <button
                  onClick={() => setShowApiModal(true)}
                  className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
                >
                  🔑 Đổi API Key
                </button>
                {state.step > GenerationStep.INPUT_FORM && (
                  <button
                    onClick={() => {
                      const rotation = apiKeyManager.rotateToNextKey('manual_retry');
                      let keyToUse = apiKey;
                      if (rotation.success && rotation.newKey) {
                        keyToUse = rotation.newKey;
                        setApiKey(keyToUse);
                        localStorage.setItem('gemini_api_key', keyToUse);
                      } else {
                        apiKeyManager.resetAllKeys();
                        const freshKey = apiKeyManager.getActiveKey();
                        if (freshKey) {
                          keyToUse = freshKey;
                          setApiKey(keyToUse);
                          localStorage.setItem('gemini_api_key', keyToUse);
                        }
                      }
                      setState(prev => ({ ...prev, error: null }));
                      initializeGeminiChat(keyToUse, selectedModel);
                      const savedHistory = getChatHistory();
                      if (savedHistory.length > 0) {
                        setChatHistory(savedHistory);
                      }
                      setTimeout(() => {
                        generateNextSection();
                      }, 300);
                    }}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2"
                  >
                    <RefreshCw size={16} />
                    🔄 Thử lại (đổi key)
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {state.step === GenerationStep.INPUT_FORM ? (
          <div className="flex-1 flex items-start justify-center overflow-y-auto">
            <SKKNForm
              userInfo={userInfo}
              onChange={handleUserChange}
              onSubmit={startGeneration}
              onManualSubmit={handleManualOutlineSubmit}
              isSubmitting={state.isStreaming}
              apiKey={apiKey}
              selectedModel={selectedModel}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 relative">
            <DocumentPreview
              content={state.fullDocument}
              onUpdate={handleDocumentUpdate}
              isEditable={state.step === GenerationStep.OUTLINE && !state.isStreaming}
            />

            {/* Mobile Controls Floating */}
            <div className="lg:hidden absolute bottom-4 left-4 right-4 flex gap-2 shadow-lg">
              {!state.isStreaming && state.step < GenerationStep.COMPLETED && (
                <Button onClick={generateNextSection} className="flex-1 shadow-xl">
                  {state.step === GenerationStep.OUTLINE ? 'Chốt & Tiếp tục' : 'Viết tiếp'}
                </Button>
              )}
              <Button onClick={exportToWord} variant="secondary" className="bg-white shadow-xl text-sky-700">
                <Download size={20} />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

