import { Quiz, Question, NMMS_Subject, PyqPaperSummary } from '../types';
import { clientDb } from './db';

// Cache for loaded PYQ papers
const pyqQuizzesMap = new Map<string, Quiz>();
let isLoaded = false;

export const PYQ_YEARS = [2026, 2025, 2024, 2023, 2021, 2020, 2019, 2018, 2017];
export const PYQ_TYPES: ('MAT' | 'SAT')[] = ['MAT', 'SAT'];

function formatPyqQuestion(
  raw: any,
  index: number,
  paperId: string,
  type: 'MAT' | 'SAT'
): Question {
  const qNum = typeof raw.id === 'number' ? raw.id : index + 1;
  const optionLetters: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];

  let subject: NMMS_Subject = 'MAT';
  let topic = 'மனத்திறன் தேர்வு (MAT)';

  if (type === 'SAT') {
    if (qNum <= 110) {
      subject = 'SAT_MATHS';
      topic = 'கணிதம் (Mathematics)';
    } else if (qNum <= 145) {
      subject = 'SAT_SCIENCE';
      topic = 'அறிவியல் (Science)';
    } else {
      subject = 'SAT_SOCIAL';
      topic = 'சமூக அறிவியல் (Social Science)';
    }
  }

  const rawOpts = Array.isArray(raw.options) ? raw.options : [];
  const options = optionLetters.map((letter, idx) => ({
    id: letter,
    text: String(rawOpts[idx] !== undefined ? rawOpts[idx] : `விருப்பம் ${letter}`),
  }));

  let correctOption: 'A' | 'B' | 'C' | 'D' = 'A';
  if (typeof raw.correct === 'number') {
    if (raw.correct >= 0 && raw.correct <= 3) {
      correctOption = optionLetters[raw.correct];
    } else if (raw.correct >= 1 && raw.correct <= 4) {
      correctOption = optionLetters[raw.correct - 1];
    }
  } else if (typeof raw.correct === 'string') {
    const uc = raw.correct.trim().toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(uc)) {
      correctOption = uc as 'A' | 'B' | 'C' | 'D';
    } else {
      const num = parseInt(uc, 10);
      if (!isNaN(num) && num >= 0 && num <= 3) correctOption = optionLetters[num];
      else if (!isNaN(num) && num >= 1 && num <= 4) correctOption = optionLetters[num - 1];
    }
  }

  let questionImage: string | undefined = undefined;
  if (raw.image && typeof raw.image === 'string' && raw.image.trim()) {
    let img = raw.image.trim().replace(/^\/+/, '');
    if (!img.startsWith('assets/')) {
      img = `assets/pyq/${img}`;
    }
    questionImage = `/${img}`;
  }

  return {
    id: `${paperId}-q${qNum}`,
    subject,
    topic,
    questionText: raw.question || `வினா ${qNum}`,
    questionImage,
    options,
    correctOption,
    explanation: raw.explanation || '',
    marks: 1,
    negativeMarks: 0,
    question_en: raw.question_en || undefined,
    options_en: Array.isArray(raw.options_en) ? raw.options_en : undefined,
    explanation_en: raw.explanation_en || undefined,
  };
}

export async function loadPyqPaper(year: number, type: 'MAT' | 'SAT'): Promise<Quiz | null> {
  const paperId = `pyq-${year}-${type.toLowerCase()}`;
  if (pyqQuizzesMap.has(paperId)) {
    return pyqQuizzesMap.get(paperId)!;
  }

  try {
    const fileName = `${type.toLowerCase()}${year}.json`;
    const res = await fetch(`/assets/pyq/data/${fileName}`);
    if (!res.ok) {
      return null;
    }
    const rawData = await res.json();
    if (!Array.isArray(rawData) || rawData.length === 0) {
      return null;
    }

    const title =
      type === 'MAT'
        ? `NMMS ${year} - MAT (மனத்திறன் தேர்வு - Mental Ability Test)`
        : `NMMS ${year} - SAT (படிப்பறிவுத் திறன் தேர்வு - Scholastic Aptitude Test)`;

    const description =
      type === 'MAT'
        ? `Official NMMS ${year} Mental Ability Test (MAT) with 90 official previous year questions, diagrams, and step-by-step solutions.`
        : `Official NMMS ${year} Scholastic Aptitude Test (SAT) covering Mathematics (Q91-110), Science (Q111-145), and Social Science (Q146-180) with 90 questions.`;

    const questions: Question[] = rawData.map((raw, idx) =>
      formatPyqQuestion(raw, idx, paperId, type)
    );

    const quiz: Quiz = {
      id: paperId,
      title,
      description,
      durationMinutes: 90,
      totalMarks: questions.length,
      passPercentage: 40,
      enableAntiCheat: true,
      shuffleQuestions: false,
      showResultsImmediately: true,
      allowReview: true,
      status: 'active',
      createdAt: `${year}-01-01T00:00:00.000Z`,
      questions,
    };

    pyqQuizzesMap.set(paperId, quiz);
    return quiz;
  } catch (err) {
    console.warn(`Could not load PYQ paper ${year} ${type}:`, err);
    return null;
  }
}

export async function initAllPyqPapers(): Promise<void> {
  if (isLoaded) return;
  const loadPromises: Promise<any>[] = [];
  for (const year of PYQ_YEARS) {
    for (const type of PYQ_TYPES) {
      loadPromises.push(loadPyqPaper(year, type));
    }
  }
  await Promise.all(loadPromises);
  isLoaded = true;
}

export async function getPyqPapersSummaries(): Promise<PyqPaperSummary[]> {
  await initAllPyqPapers();
  const quizzes = clientDb.getQuizzes();
  const attempts = clientDb.getAttempts();

  const list: PyqPaperSummary[] = Array.from(pyqQuizzesMap.values()).map((q) => {
    const match = q.id.match(/^pyq-(\d{4})-(mat|sat)$/i);
    const year = match ? parseInt(match[1], 10) : 2024;
    const type = match ? (match[2].toUpperCase() as 'MAT' | 'SAT') : 'MAT';
    const isDeployed = quizzes.some((existing) => existing.id === q.id);
    const attemptsCount = attempts.filter((a) => a.quizId === q.id).length;
    const subjects: NMMS_Subject[] = Array.from(new Set(q.questions.map((item) => item.subject)));

    return {
      id: q.id,
      year,
      type,
      title: q.title,
      description: q.description,
      questionCount: q.questions.length,
      durationMinutes: q.durationMinutes,
      totalMarks: q.totalMarks,
      subjects,
      isDeployed,
      attemptsCount,
    };
  });

  list.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return a.type === 'MAT' ? -1 : 1;
  });

  return list;
}

export async function getPyqQuizById(id: string): Promise<Quiz | undefined> {
  if (pyqQuizzesMap.has(id)) {
    return pyqQuizzesMap.get(id);
  }
  const match = id.match(/^pyq-(\d{4})-(mat|sat)$/i);
  if (match) {
    const year = parseInt(match[1], 10);
    const type = match[2].toUpperCase() as 'MAT' | 'SAT';
    const loaded = await loadPyqPaper(year, type);
    if (loaded) return loaded;
  }
  return undefined;
}

export async function deployPyqPaper(paperId: string, customOptions?: Partial<Quiz>): Promise<Quiz> {
  let quiz = await getPyqQuizById(paperId);
  if (!quiz) {
    throw new Error('PYQ paper not found.');
  }

  const deployedQuiz: Quiz = {
    ...quiz,
    ...(customOptions || {}),
    id: paperId,
    status: 'active',
  };

  clientDb.saveQuiz(deployedQuiz);
  return deployedQuiz;
}
