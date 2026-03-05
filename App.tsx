import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserInfo, GenerationStep, GenerationState, SKKNTemplate } from './types';
import { STEPS_INFO, SECTION_III_1_PROMPT, FALLBACK_MODELS, HIGHER_ED_LEVELS, HIGHER_ED_SYSTEM_INSTRUCTION } from './constants';
import { initializeGeminiChat, sendMessageStream, getFriendlyErrorMessage, parseApiError, getChatHistory, setChatHistory } from './services/geminiService';
import { apiKeyManager } from './services/apiKeyManager';
import { SKKNForm } from './components/SKKNForm';
import { DocumentPreview } from './components/DocumentPreview';
import { Button } from './components/Button';
import { ApiKeyModal } from './components/ApiKeyModal';
// SolutionReviewModal removed - mẫu mới không cần review từng giải pháp
import { Download, ChevronRight, Wand2, FileText, CheckCircle, RefreshCw, Settings, AlertTriangle, Save, Trash2, XCircle, Loader2 } from 'lucide-react';

import { LockScreen } from './components/LockScreen';

// Progress mapping: mỗi step tương ứng với % tiến trình
const STEP_PROGRESS: Record<number, { percent: number; label: string }> = {
  [GenerationStep.INPUT_FORM]: { percent: 0, label: 'Chuẩn bị' },
  [GenerationStep.OUTLINE]: { percent: 10, label: 'Lập dàn ý' },
  [GenerationStep.PART_I]: { percent: 20, label: 'Phần I - Thông tin chung' },
  [GenerationStep.PART_II]: { percent: 35, label: 'Phần II - Giải pháp đã biết' },
  [GenerationStep.PART_III_1]: { percent: 55, label: 'Phần III.1 - Nội dung giải pháp' },
  [GenerationStep.PART_III_2]: { percent: 75, label: 'Phần III.2 - Tính mới, sáng tạo' },
  [GenerationStep.PART_III_3]: { percent: 85, label: 'Phần III.3 - Phạm vi ảnh hưởng' },
  [GenerationStep.PART_III_4]: { percent: 92, label: 'Phần III.4 - Hiệu quả, lợi ích' },
  [GenerationStep.COMPLETED]: { percent: 100, label: 'Hoàn thành!' },
};

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
    solutionCount: 0,
    includePracticalExamples: false,
    includeStatistics: false,
    requirementsConfirmed: false,
    customTemplate: undefined
  });

  // Flag ngăn vòng lặp khôi phục ref docs
  const refDocsRestoredRef = useRef(false);

  // Khôi phục referenceDocuments từ sessionStorage khi mount
  useEffect(() => {
    if (refDocsRestoredRef.current) return;
    try {
      const savedRefDocs = sessionStorage.getItem(SESSION_REF_DOCS_KEY);
      if (savedRefDocs && !userInfo.referenceDocuments) {
        refDocsRestoredRef.current = true;
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
  // ABORT CONTROLLER: Cho phép hủy quá trình generation
  // ═══════════════════════════════════════════════════════════
  const abortControllerRef = useRef<AbortController | null>(null);

  // Tạo AbortController mới cho mỗi lần generation
  const createAbortController = useCallback(() => {
    // Hủy controller cũ nếu còn
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    return abortControllerRef.current;
  }, []);

  // Hàm hủy generation
  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(prev => ({ ...prev, isStreaming: false, error: '🛑 Đã hủy quá trình. Bạn có thể bấm "Viết tiếp" để tiếp tục.' }));
  }, []);

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

  // Tự động lưu khi state thay đổi (debounce 5 giây, loại bỏ saveSession khỏi deps để tránh loop)
  useEffect(() => {
    if (state.step <= GenerationStep.INPUT_FORM || state.isStreaming) return;

    const timer = setTimeout(() => {
      saveSession();
    }, 5000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.fullDocument, appendixDocument]);

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

  // Helper: Tính toán phân bổ trang cho từng phần sáng kiến (10-12 trang, NGHIÊM NGẶT)
  const getPageAllocation = useCallback(() => {
    // Mặc định 10 trang nếu không có pageLimit, tối đa 12
    const pages = Math.min(12, Math.max(10, (userInfo.pageLimit && typeof userInfo.pageLimit === 'number') ? userInfo.pageLimit : 10));
    const wordsPerPage = 350;
    const charsPerPage = 2500;

    // Phân bổ CỨNG theo dung lượng chuẩn SKKN:
    // II: 2 trang | III.1: 4 trang | III.2: 2 trang | III.3: 1 trang | III.4: 1 trang = 10 trang
    // Nếu pages > 10, phần dư thêm vào III.1 (trái tim sáng kiến)
    const extraPages = Math.max(0, pages - 10);
    const partII_pages = 2;
    const partIII_1_pages = 4 + extraPages; // Phần quan trọng nhất được thêm trang
    const partIII_2_pages = 2;
    const partIII_3_pages = 1;
    const partIII_4_pages = 1;

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

    const section = alloc[sectionKey];
    const maxChars = Math.ceil(section.chars * 1.1); // Chỉ cho phép vượt 10%
    return `
🚨🚨🚨 GIỚI HẠN TRANG CHO PHẦN NÀY - TUYỆT ĐỐI KHÔNG VƯỢT QUÁ 🚨🚨🚨
📌 ${sectionName}: ĐÚNG ${section.pages} TRANG (≈ ${section.words.toLocaleString()} từ ≈ ${section.chars.toLocaleString()} ký tự)
🚫 TRẦN TUYỆT ĐỐI: KHÔNG QUÁ ${maxChars.toLocaleString()} ký tự. DỪNG NGAY khi gần đạt.
⚠️ Sáng kiến tổng cộng chỉ ${alloc.totalPages} trang. Mỗi từ phải có giá trị.

📝 QUY TẮC VIẾT GỌN:
- KHÔNG mở đầu lan man, đi thẳng vào vấn đề
- KHÔNG lặp lại ý đã viết ở phần trước
- Dùng bảng biểu thay cho mô tả dài dòng
- Mỗi đoạn văn tối đa 4-5 câu, mỗi câu mang thông tin mới
- Giọng văn TỰ NHIÊN, không sáo rỗng, không khuôn mẫu
`;
  }, [getPageAllocation]);

  // Helper function để tạo prompt nhắc lại các yêu cầu đặc biệt
  const getPageLimitPrompt = useCallback(() => {
    if (!userInfo.requirementsConfirmed) return '';

    const requirements: string[] = [];

    const alloc = getPageAllocation();
    requirements.push(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 GIỚI HẠN SỐ TRANG - NGHIÊM NGẶT TUYỆT ĐỐI 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 TỔNG SỐ TRANG: ${alloc.totalPages} TRANG (KHÔNG HƠN, KHÔNG KÉM)

📊 PHÂN BỔ CỨNG:
│ Phần II (Giải pháp đã biết)     │ ${alloc.partII.pages} trang (≤${alloc.partII.chars.toLocaleString()} ký tự) │
│ Phần III.1 (Nội dung giải pháp) │ ${alloc.partIII_1.pages} trang (≤${alloc.partIII_1.chars.toLocaleString()} ký tự) │
│ Phần III.2 (Tính mới, sáng tạo) │ ${alloc.partIII_2.pages} trang (≤${alloc.partIII_2.chars.toLocaleString()} ký tự) │
│ Phần III.3 (Phạm vi ảnh hưởng)  │ ${alloc.partIII_3.pages} trang (≤${alloc.partIII_3.chars.toLocaleString()} ký tự) │
│ Phần III.4 (Hiệu quả, lợi ích)  │ ${alloc.partIII_4.pages} trang (≤${alloc.partIII_4.chars.toLocaleString()} ký tự) │

🚫 CẢNH BÁO: VIẾT VƯỢT QUÁ SỐ TRANG = THẤT BẠI!

📝 NGUYÊN TẮC VIẾT GỌN - KHÔNG LAN MAN:
1. ĐI THẲNG VÀO VẤN ĐỀ, không mở đầu dài dòng
2. MỖI CÂU phải mang thông tin MỚI, không lặp lại
3. Dùng BẢNG BIỂU thay cho mô tả dài
4. Đoạn văn ngắn (3-5 câu), ý rõ ràng
5. GIỌNG VĂN TỰ NHIÊN - viết như người thật đang kể, không sáo rỗng
6. KHÔNG dùng các cụm mở đầu cũ mòn: "Trong bối cảnh...", "Trong thời đại..."
7. KHÔNG kê khai lý thuyết suông, phải gắn với thực tế`);

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

    if (userInfo.solutionCount > 0) {
      requirements.push(`
🎯 SỐ LƯỢNG GIẢI PHÁP - BẮT BUỘC TUYỆT ĐỐI:
- Người dùng YÊU CẦU CHÍNH XÁC ${userInfo.solutionCount} GIẢI PHÁP.
- KHÔNG ĐƯỢC viết nhiều hơn hoặc ít hơn ${userInfo.solutionCount} giải pháp.
- Dàn ý và nội dung Phần III.1 phải có ĐÚNG ${userInfo.solutionCount} giải pháp.`);
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
  }, [userInfo.requirementsConfirmed, userInfo.pageLimit, userInfo.solutionCount, userInfo.includePracticalExamples, userInfo.includeStatistics, userInfo.specialRequirements, getPageAllocation]);

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

      const controller = createAbortController();
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
${userInfo.solutionCount > 0 ? `✓ PHẦN III.1 PHẢI CÓ ĐÚNG ${userInfo.solutionCount} GIẢI PHÁP (người dùng đã chọn ${userInfo.solutionCount} giải pháp)` : '✓ Phần III.1 nên có 2-3 giải pháp (AI tự quyết định phù hợp)'}

${getPageLimitPrompt()}

Kết thúc phần dàn ý, hiển thị hộp thoại:
┌─────────────────────────────────┐
│ ✅ Đồng ý dàn ý này ?            │
│ ✏️ Bạn có thể CHỈNH SỬA trực   │
│    tiếp bằng nút "Chỉnh sửa"    │
└─────────────────────────────────┘
`;

      let generatedText = "";
      let pendingChunks_sg = '';
      let lastFlush_sg = Date.now();
      const FLUSH_SG = 150;
      await sendMessageStream(initMessage, (chunk) => {
        generatedText += chunk;
        pendingChunks_sg += chunk;
        const now = Date.now();
        if (now - lastFlush_sg >= FLUSH_SG) {
          lastFlush_sg = now;
          const text = generatedText; // capture current full text
          pendingChunks_sg = '';
          setState(prev => ({ ...prev, fullDocument: text }));
        }
      }, { signal: controller.signal });
      // Flush cuối
      setState(prev => ({ ...prev, fullDocument: generatedText }));

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
      const controller = createAbortController();
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
      let pendingChunks_ro = '';
      let lastFlush_ro = Date.now();
      const FLUSH_RO = 150;
      await sendMessageStream(feedbackMessage, (chunk) => {
        generatedText += chunk;
        pendingChunks_ro += chunk;
        const now = Date.now();
        if (now - lastFlush_ro >= FLUSH_RO) {
          lastFlush_ro = now;
          const text = generatedText;
          pendingChunks_ro = '';
          setState(prev => ({ ...prev, fullDocument: text }));
        }
      }, { signal: controller.signal });
      // Flush cuối
      setState(prev => ({ ...prev, fullDocument: generatedText }));

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

━━━━ CẤU TRÚC HÌNH PHỄU (VĨ MÔ → VI MÔ) ━━━━

📌 1. THỰC TRẠNG CHUNG (Việt Nam & ${userInfo.location}):
- Nêu khái quát các văn bản chỉ đạo, xu hướng giáo dục/quản lý hiện nay liên quan đến đề tài
- VD: "Tại Việt Nam, việc... đang là ưu tiên hàng đầu... Tại ${userInfo.location}, Sở GD&ĐT đã có những chỉ đạo sát sao về..."

📌 2. THỰC TRẠNG TẠI ĐƠN VỊ ${userInfo.applicationUnit || userInfo.school}:
- Mô tả chi tiết CÁCH LÀM CŨ mà đơn vị đang áp dụng
- Số liệu minh chứng: kết quả khảo sát, bảng điểm, bảng kiểm trước khi có sáng kiến (số lẻ tự nhiên)
- Dùng bảng Markdown chuẩn để trình bày số liệu

📌 3. PHÂN TÍCH ƯU ĐIỂM giải pháp cũ:
- Thừa nhận mặt tích cực (dễ thực hiện, đã đi vào nề nếp, chi phí thấp...)

📌 4. PHÂN TÍCH NHƯỢC ĐIỂM, BẤT CẬP (TRỌNG TÂM - viết KỸ NHẤT):
- Tính lạc hậu: Giải pháp cũ không còn phù hợp với chương trình mới/yêu cầu thực tế
- Tính hiệu quả thấp: Tốn thời gian, công sức nhưng kết quả không cao
- Sự nhàm chán: Cách làm cũ gây ra sự thụ động cho ${userInfo.researchSubjects || 'học sinh'}

📌 5. CHỐT VẤN ĐỀ:
- Từ những bất cập trên → khẳng định việc đưa ra "${userInfo.topic}" là CẤP THIẾT để khắc phục triệt để các tồn tại

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

━━━━ CẤU TRÚC HÌNH PHỄU (VĨ MÔ → VI MÔ) ━━━━

📌 1. THỰC TRẠNG CHUNG (Việt Nam & ${userInfo.location}):
- Nêu khái quát các văn bản chỉ đạo, xu hướng giáo dục/quản lý hiện nay liên quan đến đề tài
- VD: "Tại Việt Nam, việc... đang là ưu tiên hàng đầu... Tại ${userInfo.location}, Sở GD&ĐT đã có những chỉ đạo sát sao về..."

📌 2. THỰC TRẠNG TẠI ĐƠN VỊ ${userInfo.applicationUnit || userInfo.school}:
- Mô tả chi tiết CÁCH LÀM CŨ mà đơn vị đang áp dụng
- Số liệu minh chứng: kết quả khảo sát, bảng điểm, bảng kiểm trước khi có sáng kiến (dùng số lẻ tự nhiên)
- Dùng bảng Markdown chuẩn để trình bày số liệu

📌 3. PHÂN TÍCH ƯU ĐIỂM giải pháp cũ:
- Thừa nhận mặt tích cực (dễ thực hiện, đã đi vào nề nếp, chi phí thấp...)

📌 4. PHÂN TÍCH NHƯỢC ĐIỂM, BẤT CẬP (TRỌNG TÂM - viết KỸ NHẤT):
- Tính lạc hậu: Giải pháp cũ không còn phù hợp với chương trình mới/yêu cầu thực tế
- Tính hiệu quả thấp: Tốn thời gian, công sức nhưng kết quả không cao
- Sự nhàm chán: Cách làm cũ gây ra sự thụ động cho ${userInfo.researchSubjects || 'học sinh'}

📌 5. CHỐT VẤN ĐỀ:
- Từ những bất cập trên → khẳng định việc đưa ra "${userInfo.topic}" là CẤP THIẾT để khắc phục triệt để các tồn tại

⚠️ BÁM SÁT: Cấp ${userInfo.level}, Khối ${userInfo.grade}, Môn ${userInfo.subject}
Trường: ${userInfo.school}, Địa phương: ${userInfo.location}

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần II', 'partII')}
`,
          nextStep: GenerationStep.PART_II
        },
        [GenerationStep.PART_II]: {
          prompt: `
${SECTION_III_1_PROMPT}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 THỰC THI: PHẦN III.1 - NỘI DUNG GIẢI PHÁP (3-5 trang)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Đề tài: "${userInfo.topic}"
Môn: ${userInfo.subject} - Cấp: ${userInfo.level} - Lớp: ${userInfo.grade}
Trường: ${userInfo.school}
CSVC: ${userInfo.facilities}
Công nghệ/AI: ${userInfo.applyAI}

━━━━ ĐI THẲNG VÀO QUY TRÌNH THỰC HIỆN TỪNG GIẢI PHÁP ━━━━
⚠️ KHÔNG VIẾT: Mục tiêu giải pháp, Cơ sở khoa học, Điều kiện thực hiện, Lưu ý chung
⚠️ CHỈ VIẾT: Cách thực hiện cụ thể từng bước — NỔI BẬT, CHI TIẾT, THỰC TẾ

📌 QUY TẮC QUAN TRỌNG VỀ SỐ GIẢI PHÁP:
${userInfo.solutionCount > 0 ? `🚨🚨🚨 NGƯỜI DÙNG ĐÃ CHỌN CHÍNH XÁC ${userInfo.solutionCount} GIẢI PHÁP 🚨🚨🚨
- BẮT BUỘC viết ĐÚNG ${userInfo.solutionCount} giải pháp, KHÔNG ĐƯỢC viết nhiều hơn hoặc ít hơn!
- Phân bổ nội dung đều cho ${userInfo.solutionCount} giải pháp để ĐẢM BẢO tổng phần này đạt 3-5 trang` : `- TỐI ĐA 3 GIẢI PHÁP (có thể 2 nếu mỗi giải pháp cần viết sâu)
- Linh hoạt số giải pháp để ĐẢM BẢO tổng phần này đạt 3-5 trang
- Nếu đề tài đơn giản → 2 giải pháp, mỗi GP viết KỸ hơn
- Nếu đề tài phong phú → 3 giải pháp, mỗi GP viết vừa đủ`}

📌 CẤU TRÚC MỖI GIẢI PHÁP (KHAI THÁC TỐI ĐA):
  🔹 Tên giải pháp: Đặt tên ẤN TƯỢNG, SÁNG TẠO (không chung chung)
  🔹 Các bước thực hiện: Viết CHI TIẾT từng bước
     - Mô tả CỤ THỂ cách làm (ai làm gì, ở đâu, khi nào, bằng công cụ gì)
     - Ví dụ minh họa THỰC TẾ (giáo án mẫu, tình huống cụ thể, bài tập mẫu)
     - Kết quả đạt được sau mỗi bước
  🔹 Điểm NỔI BẬT của giải pháp: 1-2 câu khẳng định tính ưu việt

💡 VÍ DỤ CẤU TRÚC:
### Giải pháp 1: [Tên sáng tạo]
**Bước 1: [Tên bước]**
Cách thực hiện chi tiết... Ví dụ cụ thể...
**Bước 2: [Tên bước]**
Cách thực hiện chi tiết... Ví dụ cụ thể...

### Giải pháp 2: [Tên sáng tạo]
...

🖼️ GỢI Ý HÌNH ẢNH MINH HỌA (BẮT BUỘC):
Gợi ý 2-3 vị trí nên đặt hình ảnh minh họa:
**[🖼️ GỢI Ý HÌNH ẢNH: Mô tả chi tiết - Đặt sau phần nào]**

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần III.1 (Nội dung giải pháp)', 'partIII_1')}
`,
          nextStep: GenerationStep.PART_III_1
        },
        [GenerationStep.PART_III_1]: {
          prompt: `
Tiếp tục viết PHẦN III.2: TÍNH MỚI, TÍNH SÁNG TẠO (1,5-2 trang).

━━━━ MỤC ĐÍCH: THUYẾT PHỤC HỘI ĐỒNG ĐÂY KHÔNG PHẢI SAO CHÉP ━━━━

📌 1. ĐIỂM MỚI - Sáng kiến có gì mà các giải pháp trước đây CHƯA CÓ?
- Ứng dụng công nghệ mới? Thay đổi quy trình? Cách tiếp cận đối tượng khác biệt?
- Liệt kê rõ ràng từng điểm mới

📌 2. TÍNH SÁNG TẠO:
- Cách kết hợp các phương pháp cũ để tạo ra hiệu quả mới
- Cách giải quyết vấn đề hóc búa bằng ý tưởng độc đáo

📌 3. TÍNH ƯU VIỆT - SO SÁNH TRỰC DIỆN VỚI PHẦN II:
⚠️ BẮT BUỘC so sánh với NHƯỢC ĐIỂM đã nêu ở Phần II (Mô tả giải pháp đã biết)
- Sử dụng các cụm từ: "Thay vì... như trước đây, giải pháp mới đã...", "Điểm đột phá của sáng kiến nằm ở chỗ..."
- Có thể dùng bảng so sánh Markdown: | Tiêu chí | Giải pháp cũ | Giải pháp mới |

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

━━━━ CHỨNG MINH SÁNG KIẾN KHÔNG CHỈ CHO RIÊNG MÌNH ━━━━

📌 1. KHẢ NĂNG ÁP DỤNG:
- Khẳng định giải pháp KHÔNG CHỈ dùng cho lớp mình, trường mình
- Có thể áp dụng cho các đơn vị có đặc điểm tương đồng (cùng khối lớp, cùng quận/huyện, hoặc toàn tỉnh/thành phố ${userInfo.location})
- Nêu rõ CÁC ĐIỀU KIỆN CẦN THIẾT để đơn vị khác triển khai thành công (CSVC, nhân lực, kinh phí...)

📌 2. PHẠM VI ẢNH HƯỞNG:
- Tác động tích cực đến ĐỒNG NGHIỆP: thông qua các buổi chuyên đề, sinh hoạt chuyên môn, trao đổi kinh nghiệm
- Tác động đến ${userInfo.researchSubjects || 'HỌC SINH'}: thay đổi thái độ, kỹ năng, kết quả học tập
- Tác động đến CỘNG ĐỒNG/PHỤ HUYNH (nếu có)
- Nếu đã được báo cáo tại hội nghị cấp quận/thành phố → nêu rõ

Đơn vị: ${userInfo.applicationUnit || userInfo.school}
Địa phương: ${userInfo.location}

${getPageLimitPrompt()}
${getSectionPagePrompt('Phần III.3 (Phạm vi ảnh hưởng)', 'partIII_3')}
`,
          nextStep: GenerationStep.PART_III_3
        },
        [GenerationStep.PART_III_3]: {
          prompt: `
Tiếp tục viết PHẦN III.4: HIỆU QUẢ, LỢI ÍCH THU ĐƯỢC TỪ SÁNG KIẾN (khoảng 1 trang + minh chứng).

━━━━ SO SÁNH TRƯỚC & SAU - ĐỊNH LƯỢNG + ĐỊNH TÍNH ━━━━

📌 1. HIỆU QUẢ ĐỊNH LƯỢNG (BẮT BUỘC CÓ BẢNG BIỂU):
- Bảng so sánh Markdown: | Tiêu chí | Trước khi áp dụng | Sau khi áp dụng | Mức tăng/giảm |
- Tỷ lệ ${userInfo.researchSubjects || 'học sinh'} khá giỏi tăng bao nhiêu %
- Điểm số khảo sát, số giờ tiết kiệm, kết quả kiểm tra...
- ⚠️ DÙNG SỐ LIỆU LẺ TỰ NHIÊN: 31/45 em (68,9%) thay vì 70%, 23/45 em (51,1%) thay vì 50%
- Có thể thêm biểu đồ mô tả bằng text nếu phù hợp

📌 2. HIỆU QUẢ ĐỊNH TÍNH:
- Sự thay đổi về nhận thức, thái độ, không khí học tập/làm việc
- Sự hứng thú của ${userInfo.researchSubjects || 'học sinh'}
- Sự hài lòng của phụ huynh hoặc cấp trên

📌 3. LỢI ÍCH KINH TẾ - XÃ HỘI (nếu có):
- Tiết kiệm chi phí ngân sách
- Giá trị tinh thần tốt đẹp cho cộng đồng giáo dục

📌 4. MINH CHỨNG:
- Nhắc đến các phụ lục đính kèm: hình ảnh, video, sản phẩm của ${userInfo.researchSubjects || 'học sinh'}, phiếu nhận xét của đồng nghiệp
- Ghi chú: "(Xem Phụ lục 1, 2, 3...)"

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

    const controller = createAbortController();
    setState(prev => ({ ...prev, isStreaming: true, error: null, step: nextStepEnum }));

    try {
      let sectionText = "\n\n---\n\n";
      // Throttle: Batch nhiều chunk lại, chỉ update UI mỗi 150ms để tránh đơ
      let pendingChunks = '';
      let lastFlush = Date.now();
      const FLUSH_INTERVAL = 150; // ms

      const flushPending = () => {
        if (pendingChunks && shouldAppend) {
          const toFlush = pendingChunks;
          pendingChunks = '';
          setState(prev => ({
            ...prev,
            fullDocument: prev.fullDocument + toFlush
          }));
        }
      };

      await sendMessageStream(currentStepPrompt, (chunk) => {
        sectionText += chunk;
        if (shouldAppend) {
          pendingChunks += chunk;
          const now = Date.now();
          if (now - lastFlush >= FLUSH_INTERVAL) {
            lastFlush = now;
            flushPending();
          }
        }
      }, { signal: controller.signal });

      // Flush phần còn lại sau khi stream kết thúc
      flushPending();

      // Auto-continue: Nếu output bị cắt giữa chừng (AI hết token), tự động yêu cầu viết tiếp
      const trimmedSection = sectionText.trim();
      const lastLine = trimmedSection.split('\n').pop()?.trim() || '';
      const isTruncated = (
        lastLine.endsWith('|') || // Bảng bị cắt
        lastLine.endsWith(',') || // Câu bị cắt
        lastLine.endsWith(':') || // Đang liệt kê
        (lastLine.length > 10 && !lastLine.endsWith('.') && !lastLine.endsWith('!') && !lastLine.endsWith('"') && !lastLine.endsWith(')') && !lastLine.endsWith('*') && !lastLine.endsWith('---') && !lastLine.endsWith('```')) // Kết thúc bất thường
      );

      if (isTruncated && shouldAppend) {
        console.log('⚠️ Output bị cắt, tự động tiếp tục viết...');
        // Gửi lệnh tiếp tục
        let continuedText = '';
        let pendingCont = '';
        let lastFlushCont = Date.now();

        await sendMessageStream(
          'Tiếp tục viết từ chỗ bạn dừng lại. KHÔNG lặp lại nội dung đã viết. Viết tiếp ngay từ chỗ bị cắt.',
          (chunk) => {
            continuedText += chunk;
            pendingCont += chunk;
            const now = Date.now();
            if (now - lastFlushCont >= FLUSH_INTERVAL) {
              lastFlushCont = now;
              const toFlush = pendingCont;
              pendingCont = '';
              setState(prev => ({ ...prev, fullDocument: prev.fullDocument + toFlush }));
            }
          },
          { signal: controller.signal }
        );
        // Flush cuối
        if (pendingCont) {
          const toFlush = pendingCont;
          pendingCont = '';
          setState(prev => ({ ...prev, fullDocument: prev.fullDocument + toFlush }));
        }
      }

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
      const { exportSKKNToDocx } = await import('./services/docxExporter');
      const filename = `SangKien_${userInfo.topic.substring(0, 30).replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '_')}.docx`;
      await exportSKKNToDocx(state.fullDocument, userInfo, filename);
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
      let pendingAppendix = '';
      let lastFlushAppendix = Date.now();
      const FLUSH_APPENDIX = 150; // ms - throttle giống các phần khác
      await sendMessageStream(appendixPrompt, (chunk) => {
        appendixText += chunk;
        pendingAppendix += chunk;
        const now = Date.now();
        if (now - lastFlushAppendix >= FLUSH_APPENDIX) {
          lastFlushAppendix = now;
          const text = appendixText;
          pendingAppendix = '';
          setAppendixDocument(text);
        }
      });
      // Flush cuối cùng
      setAppendixDocument(appendixText);

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
            SKKN 2026
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
            <h1 className="font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-sky-500 text-xl" style={{ fontFamily: 'Nunito, sans-serif' }}>SKKN 2026</h1>
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
            {/* Progress Bar + Cancel Button */}
            {state.isStreaming && (
              <div className="mb-3 bg-white/90 backdrop-blur-sm rounded-xl border border-sky-200 p-4 shadow-sm animate-in fade-in">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Loader2 size={16} className="text-sky-600 animate-spin" />
                    <span className="text-sm font-medium text-gray-700">
                      {STEP_PROGRESS[state.step]?.label || 'Đang xử lý...'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-sky-600">
                      {STEP_PROGRESS[state.step]?.percent || 0}%
                    </span>
                    <button
                      onClick={cancelGeneration}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition-colors border border-red-200"
                      title="Hủy quá trình"
                    >
                      <XCircle size={14} />
                      Hủy
                    </button>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-sky-400 to-sky-600 h-full transition-all duration-700 ease-out"
                    style={{ width: `${STEP_PROGRESS[state.step]?.percent || 0}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1.5 text-center">
                  ⏱️ Quá trình có thể mất vài phút. Vui lòng không đóng tab.
                </p>
              </div>
            )}

            <DocumentPreview
              content={state.fullDocument}
              onUpdate={handleDocumentUpdate}
              isEditable={state.step === GenerationStep.OUTLINE && !state.isStreaming}
              isStreaming={state.isStreaming}
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

