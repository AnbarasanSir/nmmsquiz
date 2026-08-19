import {
  Quiz,
  Question,
  StudentAttempt,
  StudentScoreResult,
  SubjectScoreBreakdown,
  NMMS_Subject,
  SUBJECT_METADATA,
} from '../types';
import { clientDb } from './db';

// Fisher-Yates shuffle algorithm
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const OPTION_IDS: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];

export function prepareQuestionsForStudent(quiz: Quiz): Question[] {
  let questions = [...quiz.questions];

  // 1. Shuffle questions if enabled
  if (quiz.shuffleQuestions) {
    questions = shuffleArray(questions);
  }

  // 2. Limit question count per attempt if enabled
  if (quiz.enableQuestionLimit && quiz.questionsPerAttempt && quiz.questionsPerAttempt > 0) {
    questions = questions.slice(0, quiz.questionsPerAttempt);
  }

  // 3. Shuffle options inside questions if enabled
  if (quiz.shuffleOptions) {
    questions = questions.map((q) => {
      if (!q.options || q.options.length === 0) return q;

      const correctOptText = q.options.find((opt) => opt.id === q.correctOption)?.text;
      const shuffledOptions = shuffleArray(q.options);

      const newOptions = shuffledOptions.map((opt, idx) => ({
        id: OPTION_IDS[idx] || 'A',
        text: opt.text,
        image: opt.image,
      }));

      let newCorrectOption: 'A' | 'B' | 'C' | 'D' = 'A';
      if (correctOptText) {
        const found = newOptions.find((opt) => opt.text === correctOptText);
        if (found) newCorrectOption = found.id;
      }

      return {
        ...q,
        options: newOptions,
        correctOption: newCorrectOption,
      };
    });
  }

  return questions;
}

function emptyBreakdown(): SubjectScoreBreakdown {
  return {
    obtained: 0,
    possible: 0,
    accuracy: 0,
    correctCount: 0,
    wrongCount: 0,
    unattemptedCount: 0,
  };
}

export function calculateScore(
  quiz: Quiz,
  answers: Record<string, 'A' | 'B' | 'C' | 'D' | null> = {},
  activeQuestions: Question[] = [],
  studentName: string = '',
  examNumber: string = ''
): StudentScoreResult {
  const questions = activeQuestions.length > 0 ? activeQuestions : (quiz.questions || []);
  let totalObtained = 0;
  let totalPossible = 0;

  const subjectBreakdown: {
    MAT: SubjectScoreBreakdown;
    SAT_MATHS: SubjectScoreBreakdown;
    SAT_SCIENCE: SubjectScoreBreakdown;
    SAT_SOCIAL: SubjectScoreBreakdown;
  } = {
    MAT: emptyBreakdown(),
    SAT_MATHS: emptyBreakdown(),
    SAT_SCIENCE: emptyBreakdown(),
    SAT_SOCIAL: emptyBreakdown(),
  };

  const topicAccuracy: Record<string, { correct: number; total: number }> = {};

  questions.forEach((q, idx) => {
    const qMarks = Number(q.marks) || 1;
    totalPossible += qMarks;

    const subKey: NMMS_Subject = q.subject || 'MAT';
    const b = subjectBreakdown[subKey] || subjectBreakdown.MAT;
    b.possible += qMarks;

    const topic = q.topic || 'பொதுப் பகுதி';
    if (!topicAccuracy[topic]) {
      topicAccuracy[topic] = { correct: 0, total: 0 };
    }
    topicAccuracy[topic].total += 1;

    // Resolve selected answer
    let rawSelected = answers[q.id];
    if (rawSelected === undefined || rawSelected === null) {
      rawSelected = answers[String(q.id)];
    }
    if (rawSelected === undefined || rawSelected === null) {
      rawSelected = answers[`q${idx + 1}`];
    }
    if (rawSelected === undefined || rawSelected === null) {
      rawSelected = answers[String(idx + 1)];
    }

    const selected = rawSelected ? String(rawSelected).trim().toUpperCase() : null;

    // Resolve correct option
    let correctOpt = String(q.correctOption || 'A').trim().toUpperCase();
    if (correctOpt === '0') correctOpt = 'A';
    else if (correctOpt === '1') correctOpt = 'B';
    else if (correctOpt === '2') correctOpt = 'C';
    else if (correctOpt === '3') correctOpt = 'D';

    if (!selected) {
      b.unattemptedCount += 1;
    } else if (selected === correctOpt) {
      totalObtained += qMarks;
      b.obtained += qMarks;
      b.correctCount += 1;
      topicAccuracy[topic].correct += 1;
    } else {
      b.wrongCount += 1;
      if (q.negativeMarks && q.negativeMarks > 0) {
        totalObtained = Math.max(0, totalObtained - Number(q.negativeMarks));
      }
    }
  });

  // Calculate accuracies for each subject
  (Object.keys(subjectBreakdown) as NMMS_Subject[]).forEach((k) => {
    const b = subjectBreakdown[k];
    b.accuracy = b.possible > 0 ? Math.round((b.obtained / b.possible) * 100) : 0;
  });

  const percentage = totalPossible > 0 ? Math.round((totalObtained / totalPossible) * 100) : 0;
  const isEligible = percentage >= (quiz.passPercentage || 40);

  const matScore = subjectBreakdown.MAT.obtained;
  const satScore =
    subjectBreakdown.SAT_MATHS.obtained +
    subjectBreakdown.SAT_SCIENCE.obtained +
    subjectBreakdown.SAT_SOCIAL.obtained;

  // Determine strength and weakness subjects
  let highestAcc = -1;
  let lowestAcc = 101;
  let strengthSubject = 'MAT';
  let weaknessSubject = 'SAT_MATHS';

  (Object.keys(subjectBreakdown) as NMMS_Subject[]).forEach((k) => {
    const b = subjectBreakdown[k];
    if (b.possible > 0) {
      const meta = SUBJECT_METADATA[k];
      const name = meta ? meta.name : k;
      if (b.accuracy > highestAcc) {
        highestAcc = b.accuracy;
        strengthSubject = name;
      }
      if (b.accuracy < lowestAcc) {
        lowestAcc = b.accuracy;
        weaknessSubject = name;
      }
    }
  });

  const aiDiagnosticInsights: string[] = [];
  if (percentage >= 80) {
    aiDiagnosticInsights.push(
      `அருமையான சாதனை, ${studentName || 'மாணவர்'}! ${percentage}% மதிப்பெண்களுடன் நீங்கள் NMMS உதவித்தொகை தேர்வுக்கு மிகச் சிறந்த தயாரிப்பு நிலையில் உள்ளீர்கள்.`
    );
    aiDiagnosticInsights.push(`உங்கள் பலம்: ${strengthSubject}. இதே கவனத்துடன் தொடர்ந்து பயிற்சி பெறவும்.`);
  } else if (percentage >= 60) {
    aiDiagnosticInsights.push(
      `நல்ல முயற்சி, ${studentName || 'மாணவர்'}! ${percentage}% மதிப்பெண்கள் பெற்றுள்ளீர்கள். ${weaknessSubject} பகுதியில் கூடுதல் பயிற்சி தேவை.`
    );
    aiDiagnosticInsights.push('தவறான வினாக்களுக்கான குறிப்புகளை மீண்டும் படித்து மீண்டும் ஒருமுறை பயிற்சி செய்யவும்.');
  } else if (isEligible) {
    aiDiagnosticInsights.push(
      `தேர்ச்சி பெற்றுள்ளீர்கள் (${percentage}%), ${studentName || 'மாணவர்'}. NMMS உதவித்தொகை பெற இன்னும் கூடுதல் மதிப்பெண்கள் தேவை.`
    );
  } else {
    aiDiagnosticInsights.push(
      `${studentName || 'மாணவர்'}, மேலும் தொடர் பயிற்சி தேவை. வினாக்களின் விரிவான விளக்கக் குறிப்புகளைப் பார்த்து மீண்டும் தேர்வு எழுதவும்.`
    );
  }

  return {
    totalObtained,
    totalPossible,
    percentage,
    isEligible,
    matScore,
    satScore,
    subjectBreakdown,
    strengthSubject,
    weaknessSubject,
    aiDiagnosticInsights,
  };
}

export function submitExamAttempt(
  quizId: string,
  payload: {
    studentName: string;
    examNumber: string;
    answers: Record<string, 'A' | 'B' | 'C' | 'D' | null>;
    timeSpentSeconds?: number;
    timeTakenSeconds?: number;
    tabSwitches?: number;
    tabSwitchCount?: number;
    startedAt?: string;
    activeQuestions?: Question[];
    clientQuestions?: Question[];
    questions?: Question[];
    questionStatus?: Record<string, 'answered' | 'marked' | 'visited' | 'unvisited' | 'marked_answered'>;
  }
): any {
  const quiz = clientDb.getQuiz(quizId);
  if (!quiz) {
    throw new Error('தேர்வு வினாத்தாள் கிடைக்கவில்லை (Quiz not found).');
  }

  const activeQuestions =
    (payload.activeQuestions && payload.activeQuestions.length > 0)
      ? payload.activeQuestions
      : (payload.clientQuestions && payload.clientQuestions.length > 0)
      ? payload.clientQuestions
      : (payload.questions && payload.questions.length > 0)
      ? payload.questions
      : quiz.questions;

  const scoreResult = calculateScore(
    quiz,
    payload.answers || {},
    activeQuestions,
    payload.studentName || '',
    payload.examNumber || ''
  );

  const timeTaken = payload.timeTakenSeconds ?? payload.timeSpentSeconds ?? 0;
  const tabSwitches = payload.tabSwitchCount ?? payload.tabSwitches ?? 0;

  const attemptRecord: StudentAttempt = {
    id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    quizId: quiz.id,
    quizTitle: quiz.title,
    studentName: (payload.studentName || 'மாணவர்').trim(),
    examNumber: (payload.examNumber || '').trim().toUpperCase(),
    startedAt: payload.startedAt || new Date(Date.now() - timeTaken * 1000).toISOString(),
    submittedAt: new Date().toISOString(),
    timeTakenSeconds: timeTaken,
    answers: payload.answers || {},
    questionStatus: payload.questionStatus,
    tabSwitchCount: tabSwitches,
    score: scoreResult,
  };

  clientDb.saveAttempt(attemptRecord);

  return {
    success: true,
    attempt: attemptRecord,
    score: scoreResult,
    quizDetails: {
      id: quiz.id,
      title: quiz.title,
      questions: activeQuestions,
    },
    ...scoreResult,
  };
}
