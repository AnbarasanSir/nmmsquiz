import { GoogleGenAI } from '@google/genai';
import { Question, NMMS_Subject } from '../types';

let genAIClient: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI | null {
  if (!genAIClient) {
    const apiKey =
      (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
      (import.meta as any).env?.VITE_GEMINI_API_KEY ||
      (window as any).__GEMINI_API_KEY__ ||
      '';

    if (apiKey) {
      genAIClient = new GoogleGenAI({ apiKey });
    }
  }
  return genAIClient;
}

export interface ExtractQuestionsOptions {
  text?: string;
  images?: { id: string; name: string; base64: string }[];
  subject?: NMMS_Subject;
  targetCount?: number;
}

/**
 * Safely extracts a clean string from any input (primitive, object, nested dict).
 * Guaranteed to NEVER return "[object Object]".
 */
function extractCleanString(val: any, fallback: string = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '[object Object]') return fallback;
    return trimmed;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (typeof val === 'object') {
    if (typeof val.text === 'string' && val.text.trim() && val.text !== '[object Object]') {
      return val.text.trim();
    }
    if (typeof val.text === 'number') return String(val.text);
    if (typeof val.value === 'string' && val.value.trim() && val.value !== '[object Object]') {
      return val.value.trim();
    }
    if (typeof val.value === 'number') return String(val.value);
    if (typeof val.option === 'string' && val.option.trim() && val.option !== '[object Object]') {
      return val.option.trim();
    }
    if (typeof val.choice === 'string' && val.choice.trim() && val.choice !== '[object Object]') {
      return val.choice.trim();
    }
    if (typeof val.statement === 'string' && val.statement.trim()) return val.statement.trim();
    if (typeof val.label === 'string' && val.label.trim()) return val.label.trim();
    if (typeof val.title === 'string' && val.title.trim()) return val.title.trim();
    if (typeof val.content === 'string' && val.content.trim()) return val.content.trim();

    // Check key-value pairs like { "A": "12 cm" } or { "0": "12 cm" }
    const keys = Object.keys(val);
    for (const k of keys) {
      if (k !== 'id' && typeof val[k] === 'string' && val[k].trim() && val[k] !== '[object Object]') {
        return val[k].trim();
      }
      if (k !== 'id' && typeof val[k] === 'number') {
        return String(val[k]);
      }
    }
  }
  return fallback;
}

/**
 * Extracts 4 clean option objects from any arbitrary structure (array of strings, array of objects, map, etc.)
 */
function parseRawOptions(rawOptions: any, item: any): { id: 'A' | 'B' | 'C' | 'D'; text: string }[] {
  const letters: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
  const extractedList: string[] = [];

  if (Array.isArray(rawOptions) && rawOptions.length > 0) {
    for (let i = 0; i < 4; i++) {
      const rawOpt = rawOptions[i];
      const str = extractCleanString(rawOpt, '');
      extractedList.push(str);
    }
  } else if (rawOptions && typeof rawOptions === 'object') {
    for (let i = 0; i < 4; i++) {
      const letter = letters[i];
      const val =
        rawOptions[letter] ??
        rawOptions[letter.toLowerCase()] ??
        rawOptions[String(i)] ??
        rawOptions[String(i + 1)] ??
        rawOptions[`option${letter}`] ??
        rawOptions[`option_${letter}`];
      extractedList.push(extractCleanString(val, ''));
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const letter = letters[i];
      const val =
        item[`option${letter}`] ??
        item[`option_${letter}`] ??
        item[`option_${letter.toLowerCase()}`] ??
        item[letter] ??
        item[letter.toLowerCase()];
      extractedList.push(extractCleanString(val, ''));
    }
  }

  return letters.map((letter, idx) => {
    const textVal = extractedList[idx];
    return {
      id: letter,
      text: textVal && textVal.trim() !== '' && textVal !== '[object Object]' ? textVal.trim() : `விருப்பம் ${letter}`,
    };
  });
}

/**
 * Parses correct option key from various representations.
 */
function parseCorrectOption(
  rawCorrect: any,
  options: { id: 'A' | 'B' | 'C' | 'D'; text: string }[],
  item: any
): 'A' | 'B' | 'C' | 'D' {
  const val =
    rawCorrect ??
    item.correctOption ??
    item.correct_option ??
    item.answer ??
    item.correctAnswer ??
    item.correct_answer ??
    item.key;

  if (typeof val === 'number') {
    if (val >= 0 && val <= 3) return ['A', 'B', 'C', 'D'][val] as any;
    if (val >= 1 && val <= 4) return ['A', 'B', 'C', 'D'][val - 1] as any;
  }

  if (typeof val === 'string') {
    const trimmed = val.trim().toUpperCase();
    if (trimmed === 'A' || trimmed === 'B' || trimmed === 'C' || trimmed === 'D') return trimmed as any;
    if (trimmed === '0') return 'A';
    if (trimmed === '1') return 'B';
    if (trimmed === '2') return 'C';
    if (trimmed === '3') return 'D';
    if (trimmed.startsWith('OPTION ') || trimmed.startsWith('OPTION_')) {
      const char = trimmed.charAt(trimmed.length - 1);
      if (['A', 'B', 'C', 'D'].includes(char)) return char as any;
    }
    // Check if the answer matches the exact text of one of the options
    const matched = options.find(
      (opt) => opt.text.trim().toLowerCase() === val.trim().toLowerCase()
    );
    if (matched) return matched.id;
  }

  return 'A';
}

/**
 * Extracts question statement text cleanly.
 */
function parseQuestionText(item: any, fallbackNum: number): string {
  const raw =
    item.questionText ??
    item.question ??
    item.question_text ??
    item.text ??
    item.statement ??
    item.title ??
    item.q ??
    item.prompt;
  const clean = extractCleanString(raw, '');
  if (clean && clean.trim() !== '' && clean !== `வினா ${fallbackNum}` && clean !== '[object Object]') {
    return clean.trim();
  }
  return `வினா ${fallbackNum}`;
}

export async function extractQuestionsAI(options: ExtractQuestionsOptions): Promise<Question[]> {
  const ai = getGenAI();

  if (!ai) {
    if (options.text && options.text.trim()) {
      return parseQuestionsFromTextLocally(options.text, options.subject || 'MAT');
    }
    // If no API key, use fallback generator
    return generateFallbackQuestions(options.subject || 'MAT', 'பொதுப் பயிற்சி', options.targetCount || 5);
  }

  try {
    const parts: any[] = [];

    const prompt = `You are an expert Tamil Medium NMMS (National Means-cum-Merit Scholarship) Examination Teacher.
Extract or generate high-quality Tamil Medium Multiple-Choice Questions (MCQs) for 8th Standard NMMS Exam.
Subject: ${options.subject || 'MAT'}.

Requirements for EACH question:
1. "question": Full question text in Tamil with LaTeX math formatting ($x^2$, $\\frac{a}{b}$, $\\sqrt{n}$).
2. "question_en": English translation of the question.
3. "options": Array of EXACTLY 4 STRINGS in Tamil (e.g. ["விருப்பம் 1", "விருப்பம் 2", "விருப்பம் 3", "விருப்பம் 4"]). Do NOT return objects inside the options array.
4. "options_en": Array of 4 English string options.
5. "correct": Index of correct option (0 for A, 1 for B, 2 for C, 3 for D).
6. "explanation": Clear step-by-step solution in Tamil with LaTeX formulas.
7. "explanation_en": English solution.
8. "topic": Specific subtopic name in Tamil.

CRITICAL: Return ONLY a raw JSON array of question objects. Example format:
[
  {
    "question": "8, 27, 64, 125, ... அடுத்த எண் எது?",
    "question_en": "8, 27, 64, 125, ... What is the next number in the series?",
    "options": ["216", "256", "343", "512"],
    "options_en": ["216", "256", "343", "512"],
    "correct": 0,
    "explanation": "கொடுக்கப்பட்டவை தொடர்ச்சியான கன எண்கள் ($2^3=8, 3^3=27, 4^3=64, 5^3=125, 6^3=216$).",
    "explanation_en": "These are consecutive cubes ($6^3 = 216$).",
    "topic": "எண் தொடர்"
  }
]`;

    if (options.text) {
      parts.push({ text: `${prompt}\n\nInput Content / Questions:\n${options.text}` });
    } else {
      parts.push({ text: prompt });
    }

    if (options.images && options.images.length > 0) {
      for (const img of options.images) {
        const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64;
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Data,
          },
        });
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: parts,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text || '[]';
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(responseText);
      if (!Array.isArray(parsed) && typeof parsed === 'object') {
        parsed = (parsed as any).questions || (parsed as any).data || [parsed];
      }
    } catch {
      parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return generateFallbackQuestions(options.subject || 'MAT', 'பொதுப் பயிற்சி', options.targetCount || 5);
    }

    return parsed.map((item: any, idx: number) => {
      const qNum = idx + 1;
      const cleanOptions = parseRawOptions(item.options, item);
      const correctOption = parseCorrectOption(item.correct, cleanOptions, item);

      return {
        id: `ai-extracted-${Date.now()}-${qNum}`,
        subject: options.subject || 'MAT',
        topic: extractCleanString(item.topic, 'NMMS மாதிரி வினாக்கள்'),
        questionText: parseQuestionText(item, qNum),
        question_en: extractCleanString(item.question_en, undefined as any),
        options: cleanOptions,
        options_en: Array.isArray(item.options_en) ? item.options_en.map((o: any) => extractCleanString(o, '')) : undefined,
        correctOption,
        explanation: extractCleanString(item.explanation, 'சரியான விடையைத் தேர்ந்தெடுக்கவும்.'),
        explanation_en: extractCleanString(item.explanation_en, undefined as any),
        marks: 1,
        negativeMarks: 0,
      };
    });
  } catch (err: any) {
    console.error('AI Question Extraction Error:', err);
    if (options.text && options.text.trim()) {
      return parseQuestionsFromTextLocally(options.text, options.subject || 'MAT');
    }
    return generateFallbackQuestions(options.subject || 'MAT', 'பொதுப் பயிற்சி', options.targetCount || 5);
  }
}

export async function generateQuestionsAI(
  topic: string,
  subject: NMMS_Subject,
  count: number = 5,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): Promise<Question[]> {
  const ai = getGenAI();

  if (!ai) {
    // If no API key is provided, generate high-standard offline questions for the topic
    return generateFallbackQuestions(subject, topic, count);
  }

  try {
    const prompt = `Create ${count} high-standard Tamil Medium Multiple-Choice Questions (MCQs) for 8th Standard NMMS Examination.
Topic: "${topic}".
Subject: ${subject}.
Difficulty: ${difficulty}.

Requirements for EACH question:
1. "question": Full question statement in Tamil with proper LaTeX formatting ($...$) for numbers, equations, and algebra.
2. "question_en": English translation of the question.
3. "options": EXACTLY 4 STRINGS in Tamil (e.g. ["216", "256", "343", "512"]). Do NOT return objects in this array.
4. "options_en": 4 English string options.
5. "correct": Index of correct option (0 for A, 1 for B, 2 for C, 3 for D).
6. "explanation": Clear step-by-step solution in Tamil with LaTeX formulas.
7. "explanation_en": English explanation.
8. "topic": "${topic}".

CRITICAL: Return ONLY a valid JSON array of objects. Example:
[
  {
    "question": "8, 27, 64, 125, ... தொடரின் அடுத்த எண் எது?",
    "question_en": "8, 27, 64, 125, ... What is the next number in the series?",
    "options": ["216", "256", "343", "512"],
    "options_en": ["216", "256", "343", "512"],
    "correct": 0,
    "explanation": "இவை தொடர்ச்சியான கன எண்கள் ($2^3, 3^3, 4^3, 5^3, 6^3=216$).",
    "explanation_en": "These are consecutive cubes ($6^3 = 216$).",
    "topic": "${topic}"
  }
]`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text || '[]';
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(responseText);
      if (!Array.isArray(parsed) && typeof parsed === 'object') {
        parsed = (parsed as any).questions || (parsed as any).data || [parsed];
      }
    } catch {
      parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return generateFallbackQuestions(subject, topic, count);
    }

    return parsed.map((item: any, idx: number) => {
      const qNum = idx + 1;
      const cleanOptions = parseRawOptions(item.options, item);
      const correctOption = parseCorrectOption(item.correct, cleanOptions, item);

      return {
        id: `ai-gen-${Date.now()}-${qNum}`,
        subject,
        topic: extractCleanString(item.topic, topic || 'NMMS மாதிரி வினாக்கள்'),
        questionText: parseQuestionText(item, qNum),
        question_en: extractCleanString(item.question_en, undefined as any),
        options: cleanOptions,
        options_en: Array.isArray(item.options_en) ? item.options_en.map((o: any) => extractCleanString(o, '')) : undefined,
        correctOption,
        explanation: extractCleanString(item.explanation, 'சரியான விடையைத் தேர்ந்தெடுக்கவும்.'),
        explanation_en: extractCleanString(item.explanation_en, undefined as any),
        marks: 1,
        negativeMarks: 0,
      };
    });
  } catch (err: any) {
    console.warn('AI generation API encountered error, using high-quality local generator:', err);
    return generateFallbackQuestions(subject, topic, count);
  }
}

/**
 * Intelligent Local Text Parser for OCR or copied text
 */
function parseQuestionsFromTextLocally(text: string, subject: NMMS_Subject): Question[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const questions: Question[] = [];
  let currentQ: Partial<Question> | null = null;

  for (const line of lines) {
    const qMatch = line.match(/^(\d+)[\.\)]\s*(.*)/);
    const optMatch = line.match(/^[\(\[]?([A-Da-d1-4])[\)\]\.\:\-]\s*(.*)/);

    if (qMatch) {
      if (currentQ && currentQ.questionText) {
        questions.push(finalizeQuestion(currentQ, questions.length + 1, subject));
      }
      currentQ = {
        questionText: qMatch[2],
        options: [],
      };
    } else if (optMatch && currentQ) {
      const rawKey = optMatch[1].toUpperCase();
      let key: 'A' | 'B' | 'C' | 'D' = 'A';
      if (['A', 'B', 'C', 'D'].includes(rawKey)) key = rawKey as any;
      else if (rawKey === '1') key = 'A';
      else if (rawKey === '2') key = 'B';
      else if (rawKey === '3') key = 'C';
      else if (rawKey === '4') key = 'D';

      if (!currentQ.options) currentQ.options = [];
      currentQ.options.push({ id: key, text: optMatch[2] || `Option ${key}` });
    } else if (currentQ) {
      if (!currentQ.options || currentQ.options.length === 0) {
        currentQ.questionText += ' ' + line;
      }
    }
  }

  if (currentQ && currentQ.questionText) {
    questions.push(finalizeQuestion(currentQ, questions.length + 1, subject));
  }

  return questions;
}

function finalizeQuestion(q: Partial<Question>, index: number, subject: NMMS_Subject): Question {
  const optionLetters: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
  const options = optionLetters.map((letter) => {
    const existing = q.options?.find((o) => o.id === letter);
    return {
      id: letter,
      text: existing && existing.text ? existing.text : `விருப்பம் ${letter}`,
    };
  });

  return {
    id: `extracted-q-${Date.now()}-${index}`,
    subject,
    topic: 'பயிற்சி வினாக்கள்',
    questionText: q.questionText || `வினா ${index}`,
    options,
    correctOption: 'A',
    explanation: 'சரியான விடையைத் தேர்ந்தெடுக்கவும்.',
    marks: 1,
    negativeMarks: 0,
  };
}

/**
 * Rich offline Tamil NMMS question bank generator covering MAT and SAT subjects.
 */
function generateFallbackQuestions(subject: NMMS_Subject, topic: string, count: number): Question[] {
  const bank: Question[] = [];
  const topicLower = (topic || '').toLowerCase();

  if (subject === 'MAT') {
    if (topicLower.includes('number') || topicLower.includes('எண் தொடர்') || topicLower.includes('series') || topicLower.includes('வரிசை')) {
      bank.push(
        {
          id: `gen-mat-${Date.now()}-1`,
          subject: 'MAT',
          topic: 'எண் தொடர் (Number Series)',
          questionText: '$3, 8, 15, 24, 35, \\dots$ என்ற தொடரின் அடுத்த எண் யாது?',
          options: [
            { id: 'A', text: '$46$' },
            { id: 'B', text: '$48$' },
            { id: 'C', text: '$50$' },
            { id: 'D', text: '$52$' },
          ],
          correctOption: 'B',
          explanation: 'வித்தியாசம்: $+5, +7, +9, +11, +13$. அடுத்த எண் $35 + 13 = 48$. (அல்லது $n^2 - 1$: $2^2-1, 3^2-1, 4^2-1, 5^2-1, 6^2-1, 7^2-1 = 48$).',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-2`,
          subject: 'MAT',
          topic: 'எண் தொடர் (Number Series)',
          questionText: '$2, 6, 12, 20, 30, 42, \\dots$ தொடரின் விடுபட்ட அடுத்த எண் எது?',
          options: [
            { id: 'A', text: '$52$' },
            { id: 'B', text: '$54$' },
            { id: 'C', text: '$56$' },
            { id: 'D', text: '$60$' },
          ],
          correctOption: 'C',
          explanation: 'இவை $n \\times (n+1)$ தொடர் ($1\\times2=2, 2\\times3=6, 3\\times4=12, 4\\times5=20, 5\\times6=30, 6\\times7=42, 7\\times8=56$).',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-3`,
          subject: 'MAT',
          topic: 'எண் தொடர் (Number Series)',
          questionText: '$1, 8, 27, 64, 125, \\dots$ அடுத்த உறுப்பு என்ன?',
          options: [
            { id: 'A', text: '$216$' },
            { id: 'B', text: '$256$' },
            { id: 'C', text: '$343$' },
            { id: 'D', text: '$512$' },
          ],
          correctOption: 'A',
          explanation: 'தொடர்ச்சியான கன எண்கள்: $1^3, 2^3, 3^3, 4^3, 5^3, 6^3 = 216$.',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-4`,
          subject: 'MAT',
          topic: 'எண் தொடர் (Number Series)',
          questionText: '$2, 3, 5, 7, 11, 13, 17, \\dots$ அடுத்த பகா எண் எது?',
          options: [
            { id: 'A', text: '$18$' },
            { id: 'B', text: '$19$' },
            { id: 'C', text: '$21$' },
            { id: 'D', text: '$23$' },
          ],
          correctOption: 'B',
          explanation: 'கொடுக்கப்பட்டவை வரிசையான பகா எண்கள் (Prime numbers). $17$-க்கு அடுத்த பகா எண் $19$ ஆகும்.',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-5`,
          subject: 'MAT',
          topic: 'எண் தொடர் (Number Series)',
          questionText: '$4, 9, 19, 39, 79, \\dots$ அடுத்த எண் யாது?',
          options: [
            { id: 'A', text: '$149$' },
            { id: 'B', text: '$159$' },
            { id: 'C', text: '$169$' },
            { id: 'D', text: '$179$' },
          ],
          correctOption: 'B',
          explanation: 'விதிமுறை: $\\times 2 + 1$. ($4\\times2+1=9$, $9\\times2+1=19$, $19\\times2+1=39$, $39\\times2+1=79$, $79\\times2+1=159$).',
          marks: 1,
        }
      );
    } else if (topicLower.includes('letter') || topicLower.includes('எழுத்து') || topicLower.includes('coding') || topicLower.includes('குறியீட்டு')) {
      bank.push(
        {
          id: `gen-mat-${Date.now()}-1`,
          subject: 'MAT',
          topic: 'எழுத்து தொடர் (Letter Series)',
          questionText: '$\\text{B, D, G, K, P, } \\dots$ தொடரின் அடுத்த எழுத்து எது?',
          options: [
            { id: 'A', text: 'S' },
            { id: 'B', text: 'T' },
            { id: 'C', text: 'V' },
            { id: 'D', text: 'W' },
          ],
          correctOption: 'C',
          explanation: 'எழுத்துகளின் இடைவெளி: $+2, +3, +4, +5, +6$. $\\text{P}(16) + 6 = 22 = \\text{V}$.',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-2`,
          subject: 'MAT',
          topic: 'குறியீட்டு மொழி (Coding-Decoding)',
          questionText: 'ஒரு குறிப்பிட்ட குறியீட்டு மொழியில் $\\text{TAMIL}$ என்பது $\\text{UBNJM}$ எனக் குறிப்பிடப்பட்டால், $\\text{MATHS}$ என்பது எவ்வாறு குறிப்பிடப்படும்?',
          options: [
            { id: 'A', text: 'NBUIT' },
            { id: 'B', text: 'NBSIU' },
            { id: 'C', text: 'NZSIT' },
            { id: 'D', text: 'OCUIT' },
          ],
          correctOption: 'A',
          explanation: 'ஒவ்வொரு எழுத்தும் அடுத்த எழுத்தால் மாற்றப்பட்டுள்ளது ($+1$). $\\text{M}\\to\\text{N}, \\text{A}\\to\\text{B}, \\text{T}\\to\\text{U}, \\text{H}\\to\\text{I}, \\text{S}\\to\\text{T} \\implies \\text{NBUIT}$.',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-3`,
          subject: 'MAT',
          topic: 'எழுத்து ஒப்புமை (Letter Analogy)',
          questionText: '$\\text{AZ : BY :: CX : ?}$ விடுபட்ட ஜோடி எது?',
          options: [
            { id: 'A', text: 'DW' },
            { id: 'B', text: 'EV' },
            { id: 'C', text: 'DU' },
            { id: 'D', text: 'DX' },
          ],
          correctOption: 'A',
          explanation: 'எதிர் எதிர் எழுத்துகளின் இணை: $\\text{A-Z, B-Y, C-X, D-W}$.',
          marks: 1,
        }
      );
    } else {
      bank.push(
        {
          id: `gen-mat-${Date.now()}-1`,
          subject: 'MAT',
          topic: 'ஒப்புமை வினாக்கள் (Analogy)',
          questionText: '$12 : 144 :: 15 : ?$',
          options: [
            { id: 'A', text: '$215$' },
            { id: 'B', text: '$225$' },
            { id: 'C', text: '$235$' },
            { id: 'D', text: '$255$' },
          ],
          correctOption: 'B',
          explanation: '$12^2 = 144$. அதேபோல் $15^2 = 225$.',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-2`,
          subject: 'MAT',
          topic: 'பொருந்தாததைக் கண்டறிதல் (Odd One Out)',
          questionText: 'கீழ்க்கண்டவற்றுள் பொருந்தாத ஒன்றைத் தேர்ந்தெடுக்கவும்:',
          options: [
            { id: 'A', text: '$27$' },
            { id: 'B', text: '$64$' },
            { id: 'C', text: '$125$' },
            { id: 'D', text: '$144$' },
          ],
          correctOption: 'D',
          explanation: '$27(3^3), 64(4^3), 125(5^3)$ ஆகியவை கன எண்கள். $144(12^2)$ மட்டுமே வர்க்க எண்.',
          marks: 1,
        },
        {
          id: `gen-mat-${Date.now()}-3`,
          subject: 'MAT',
          topic: 'கணிதக் குறியீடுகள் (Mathematical Operations)',
          questionText: '$+$ என்பது $\\times$ எனவும், $-$ என்பது $\\div$ எனவும், $\\times$ என்பது $+$ எனவும் கொண்டால், $12 + 3 - 6 \\times 2$ என்பதன் மதிப்பு என்ன?',
          options: [
            { id: 'A', text: '$6$' },
            { id: 'B', text: '$8$' },
            { id: 'C', text: '$10$' },
            { id: 'D', text: '$12$' },
          ],
          correctOption: 'B',
          explanation: 'குறியீடு மாற்ற: $12 \\times 3 \\div 6 + 2 = (36 \\div 6) + 2 = 6 + 2 = 8$.',
          marks: 1,
        }
      );
    }
  } else if (subject === 'SAT_MATHS') {
    bank.push(
      {
        id: `gen-math-${Date.now()}-1`,
        subject: 'SAT_MATHS',
        topic: 'விகிதமுறு எண்கள் (Rational Numbers)',
        questionText: '$\\left(-\\frac{5}{8}\\right)$ இன் கூட்டல் எதிர்மறை மற்றும் பெருக்கல் தலைகீழி ஆகியவற்றின் பெருக்கற்பலன் யாது?',
        options: [
          { id: 'A', text: '$1$' },
          { id: 'B', text: '$-1$' },
          { id: 'C', text: '$\\frac{25}{64}$' },
          { id: 'D', text: '$-\\frac{25}{64}$' },
        ],
        correctOption: 'B',
        explanation: 'கூட்டல் எதிர்மறை = $\\frac{5}{8}$; பெருக்கல் தலைகீழி = $-\\frac{8}{5}$. பெருக்கற்பலன் = $\\frac{5}{8} \\times \\left(-\\frac{8}{5}\\right) = -1$.',
        marks: 1,
      },
      {
        id: `gen-math-${Date.now()}-2`,
        subject: 'SAT_MATHS',
        topic: 'இயற்கணிதம் (Algebra)',
        questionText: '$(a+b)^2 - (a-b)^2$ என்பதன் மதிப்பு என்ன?',
        options: [
          { id: 'A', text: '$2(a^2+b^2)$' },
          { id: 'B', text: '$4ab$' },
          { id: 'C', text: '$2ab$' },
          { id: 'D', text: '$0$' },
        ],
        correctOption: 'B',
        explanation: '$(a^2+2ab+b^2) - (a^2-2ab+b^2) = 4ab$.',
        marks: 1,
      },
      {
        id: `gen-math-${Date.now()}-3`,
        subject: 'SAT_MATHS',
        topic: 'அளவியல் (Mensuration)',
        questionText: 'ஒரு சாய் சதுரத்தின் மூலைவிட்டங்கள் $d_1 = 12\\text{ cm}$, $d_2 = 16\\text{ cm}$ எனில் அதன் பரப்பளவு என்ன?',
        options: [
          { id: 'A', text: '$192\\text{ cm}^2$' },
          { id: 'B', text: '$96\\text{ cm}^2$' },
          { id: 'C', text: '$48\\text{ cm}^2$' },
          { id: 'D', text: '$28\\text{ cm}^2$' },
        ],
        correctOption: 'B',
        explanation: 'சாய் சதுரத்தின் பரப்பளவு $A = \\frac{1}{2} \\times d_1 \\times d_2 = \\frac{1}{2} \\times 12 \\times 16 = 96\\text{ cm}^2$.',
        marks: 1,
      },
      {
        id: `gen-math-${Date.now()}-4`,
        subject: 'SAT_MATHS',
        topic: 'அடுக்குகள் (Exponents & Powers)',
        questionText: '$\\left(2^3\\right)^2 \\times 2^{-4}$ என்பதன் எளிய வடிவம் என்ன?',
        options: [
          { id: 'A', text: '$2$' },
          { id: 'B', text: '$4$' },
          { id: 'C', text: '$8$' },
          { id: 'D', text: '$16$' },
        ],
        correctOption: 'B',
        explanation: '$2^{3\\times 2} \\times 2^{-4} = 2^6 \\times 2^{-4} = 2^{6-4} = 2^2 = 4$.',
        marks: 1,
      },
      {
        id: `gen-math-${Date.now()}-5`,
        subject: 'SAT_MATHS',
        topic: 'வடிவவியல் (Geometry)',
        questionText: 'ஒரு ஒழுங்கு பலகோணத்தின் ஒரு வெளிக்கோணம் $36^\\circ$ எனில், அப்பலகோணத்தின் பக்கங்களின் எண்ணிக்கை யாது?',
        options: [
          { id: 'A', text: '$8$' },
          { id: 'B', text: '$10$' },
          { id: 'C', text: '$12$' },
          { id: 'D', text: '$15$' },
        ],
        correctOption: 'B',
        explanation: 'பக்கங்களின் எண்ணிக்கை $n = \\frac{360^\\circ}{\\text{வெளிக்கோணம்}} = \\frac{360^\\circ}{36^\\circ} = 10$.',
        marks: 1,
      }
    );
  } else if (subject === 'SAT_SCIENCE') {
    bank.push(
      {
        id: `gen-sci-${Date.now()}-1`,
        subject: 'SAT_SCIENCE',
        topic: 'விசை மற்றும் அழுத்தம் (Force and Pressure)',
        questionText: 'அழுத்தத்தின் SI அலகு எது?',
        options: [
          { id: 'A', text: 'நியூட்டன் (N)' },
          { id: 'B', text: 'பாஸ்கல் (Pa)' },
          { id: 'C', text: 'ஜூல் (J)' },
          { id: 'D', text: 'வாட் (W)' },
        ],
        correctOption: 'B',
        explanation: 'அழுத்தம் $P = \\frac{F}{A}$ (விசை/பரப்பு). இதன் SI அலகு நியூட்டன்/மீட்டர்$^2$ அல்லது பாஸ்கல் (Pascal) ஆகும்.',
        marks: 1,
      },
      {
        id: `gen-sci-${Date.now()}-2`,
        subject: 'SAT_SCIENCE',
        topic: 'ஒளி (Light)',
        questionText: 'சமதள ஆடியில் தோன்றும் பிம்பத்தின் தன்மை என்ன?',
        options: [
          { id: 'A', text: 'மாய, நேரான, பக்கவாட்டு இடவல மாற்றம் கொண்ட பிம்பம்' },
          { id: 'B', text: 'மெய், தலைகீழான பிம்பம்' },
          { id: 'C', text: 'மெய், நேரான பிம்பம்' },
          { id: 'D', text: 'மாய, தலைகீழான பிம்பம்' },
        ],
        correctOption: 'A',
        explanation: 'சமதள ஆடியில் தோன்றும் பிம்பம் மாயப் பிம்பம், நேரானது மற்றும் இடவல மாற்றமடைந்தது (Lateral Inversion).',
        marks: 1,
      },
      {
        id: `gen-sci-${Date.now()}-3`,
        subject: 'SAT_SCIENCE',
        topic: 'அமிலங்கள் மற்றும் காரங்கள் (Acids and Bases)',
        questionText: 'நீல லிட்மஸ் தாளை சிவப்பாக மாற்றும் கரைசல் எது?',
        options: [
          { id: 'A', text: 'சோடியம் ஹைட்ராக்சைடு' },
          { id: 'B', text: 'எலுமிச்சை சாறு (அமிலம்)' },
          { id: 'C', text: 'சுண்ணாம்பு நீர்' },
          { id: 'D', text: 'சமையல் சோடா கரைசல்' },
        ],
        correctOption: 'B',
        explanation: 'அமிலங்கள் நீல லிட்மஸ் தாளை சிவப்பாக மாற்றும். எலுமிச்சை சாற்றில் சிட்ரிக் அமிலம் உள்ளது.',
        marks: 1,
      },
      {
        id: `gen-sci-${Date.now()}-4`,
        subject: 'SAT_SCIENCE',
        topic: 'நுண்ணுயிரிகள் (Microorganisms)',
        questionText: 'பாலினைத் தயிராக மாற்றும் பாக்டீரியா எது?',
        options: [
          { id: 'A', text: 'லாக்டோபேசில்லஸ்' },
          { id: 'B', text: 'ரைசோபியம்' },
          { id: 'C', text: 'ஈஸ்ட்' },
          { id: 'D', text: 'பெனிசிலியம்' },
        ],
        correctOption: 'A',
        explanation: 'பாலில் உள்ள லாக்டோஸ் சர்க்கரையை லாக்டிக் அமிலமாக மாற்றி தயிராக்குவது லாக்டோபேசில்லஸ் பாக்டீரியா ஆகும்.',
        marks: 1,
      },
      {
        id: `gen-sci-${Date.now()}-5`,
        subject: 'SAT_SCIENCE',
        topic: 'செல்லின் அமைப்பு (Cell Structure)',
        questionText: 'செல்லின் ஆற்றல் மையம் (Powerhouse of the Cell) என்று அழைக்கப்படுவது எது?',
        options: [
          { id: 'A', text: 'உட்கரு (Nucleus)' },
          { id: 'B', text: 'மைட்டோகாண்ட்ரியா (Mitochondria)' },
          { id: 'C', text: 'ரிபோசோம் (Ribosome)' },
          { id: 'D', text: 'லைசோசோம் (Lysosome)' },
        ],
        correctOption: 'B',
        explanation: 'மைட்டோகாண்ட்ரியா செல்லுக்குத் தேவையான ATP ஆற்றலை உற்பத்தி செய்வதால் ஆற்றல் மையம் எனப்படும்.',
        marks: 1,
      }
    );
  } else {
    // SAT_SOCIAL
    bank.push(
      {
        id: `gen-soc-${Date.now()}-1`,
        subject: 'SAT_SOCIAL',
        topic: 'வரலாறு - ஐரோப்பியர்களின் வருகை (History)',
        questionText: 'கி.பி. 1498-இல் இந்தியாவுக்கான புதிய கடல்வழியைக் கண்டுபிடித்த போர்ச்சுகீசிய மாலுமி யார்?',
        options: [
          { id: 'A', text: 'கிறிஸ்டோபர் கொலம்பஸ்' },
          { id: 'B', text: 'வாஸ்கோடகாமா' },
          { id: 'C', text: 'அல்மேடா' },
          { id: 'D', text: 'அல்புவர்க்' },
        ],
        correctOption: 'B',
        explanation: 'வாஸ்கோடகாமா கி.பி. 1498-இல் நன்னம்பிக்கை முனையைச் சுற்றி இந்தியாவின் கள்ளிக்கோட்டைக்கு வந்தடைந்தார்.',
        marks: 1,
      },
      {
        id: `gen-soc-${Date.now()}-2`,
        subject: 'SAT_SOCIAL',
        topic: 'வரலாறு - 1857 பெரும் புரட்சி (Great Revolt)',
        questionText: '1857 பெரும் புரட்சியின் போது கான்பூரில் புரட்சியை வழிநடத்தியவர் யார்?',
        options: [
          { id: 'A', text: 'ராணி லட்சுமிபாய்' },
          { id: 'B', text: 'நானா சாகேப்' },
          { id: 'C', text: 'பகதூர் ஷா II' },
          { id: 'D', text: 'கன்வர் சிங்' },
        ],
        correctOption: 'B',
        explanation: 'கான்பூரில் நானா சாகேப் மற்றும் தாந்தியா தோப் ஆகியோர் 1857 புரட்சியை முன்னின்று நடத்தினர்.',
        marks: 1,
      },
      {
        id: `gen-soc-${Date.now()}-3`,
        subject: 'SAT_SOCIAL',
        topic: 'புவியியல் - பாறை மற்றும் மண் (Rocks and Soil)',
        questionText: 'பருத்தி பயிரிடுவதற்கு மிகவும் ஏற்ற மண் எது?',
        options: [
          { id: 'A', text: 'வண்டல் மண்' },
          { id: 'B', text: 'கரிசல் மண் (Regur Soil)' },
          { id: 'C', text: 'செம்மண்' },
          { id: 'D', text: 'சரளை மண்' },
        ],
        correctOption: 'B',
        explanation: 'கரிசல் மண் (Black Soil/Regur) ஈரப்பதத்தை தக்கவைத்துக்கொள்ளும் திறன் கொண்டதால் பருத்தி சாகுபடிக்கு சிறந்தது.',
        marks: 1,
      },
      {
        id: `gen-soc-${Date.now()}-4`,
        subject: 'SAT_SOCIAL',
        topic: 'குடிமையியல் - இந்திய அரசியலமைப்பு (Civics)',
        questionText: 'இந்திய அரசியலமைப்பு சட்ட வரைவுக் குழுவின் தலைவர் யார்?',
        options: [
          { id: 'A', text: 'டாக்டர் ராஜேந்திர பிரசாத்' },
          { id: 'B', text: 'டாக்டர் பி. ஆர். அம்பேத்கர்' },
          { id: 'C', text: 'ஜவஹர்லால் நேரு' },
          { id: 'D', text: 'சர்தார் வல்லபாய் படேல்' },
        ],
        correctOption: 'B',
        explanation: 'டாக்டர் பி. ஆர். அம்பேத்கர் இந்திய அரசியலமைப்பின் தந்தை மற்றும் வரைவுக் குழுவின் (Drafting Committee) தலைவர் ஆவார்.',
        marks: 1,
      },
      {
        id: `gen-soc-${Date.now()}-5`,
        subject: 'SAT_SOCIAL',
        topic: 'பொருளியல் - பணம் மற்றும் சேமிப்பு (Economics)',
        questionText: 'இந்தியாவில் ரூபாய்க்கான சின்னத்தை (₹) வடிவமைத்தவர் யார்?',
        options: [
          { id: 'A', text: 'ரகுராம் ராஜன்' },
          { id: 'B', text: 'டி. உதயகுமார்' },
          { id: 'C', text: 'அமர்த்தியா சென்' },
          { id: 'D', text: 'மன்மோகன் சிங்' },
        ],
        correctOption: 'B',
        explanation: 'தமிழ்நாட்டைச் சேர்ந்த திரு. டி. உதயகுமார் 2010-இல் இந்திய ரூபாய்க்கான (₹) புதிய சின்னத்தை வடிவமைத்தார்.',
        marks: 1,
      }
    );
  }

  // Pick count items, cycle if needed
  const selected: Question[] = [];
  for (let i = 0; i < count; i++) {
    const template = bank[i % bank.length];
    selected.push({
      ...template,
      id: `ai-gen-${Date.now()}-${i + 1}`,
      questionText: template.questionText,
      options: template.options.map((opt) => ({ id: opt.id, text: opt.text })),
    });
  }

  return selected;
}
