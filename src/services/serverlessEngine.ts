import { clientDb } from './db';
import { getPyqPapersSummaries, getPyqQuizById, deployPyqPaper } from './pyqService';
import {
  getSubjectUnitSummaries,
  getAllSubjectUnits,
  getUnitQuestions,
  updateQuestionInUnit,
  addQuestionToUnit,
  deleteQuestionFromUnit,
  resetUnitToDefault,
  buildQuizFromUnit,
} from './subjectUnitsService';
import { submitExamAttempt } from './examGradingService';
import { extractQuestionsAI, generateQuestionsAI } from './aiService';
import { NMMS_Subject, Quiz } from '../types';

// Active reset tokens for password recovery flow
const activeResetTokens = new Map<string, number>();

function generateResetToken(): string {
  const token = 'rst_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  activeResetTokens.set(token, Date.now() + 15 * 60 * 1000); // 15 mins validity
  return token;
}

function isValidResetToken(token?: string): boolean {
  if (!token) return false;
  const expiry = activeResetTokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    activeResetTokens.delete(token);
    return false;
  }
  return true;
}

function consumeResetToken(token?: string): boolean {
  if (token && isValidResetToken(token)) {
    activeResetTokens.delete(token);
    return true;
  }
  return false;
}

/**
 * Serverless API Engine:
 * Intercepts and executes all /api requests locally in the browser with zero backend server.
 */
export async function executeServerlessApi(
  path: string,
  options?: RequestInit
): Promise<any> {
  const method = (options?.method || 'GET').toUpperCase();
  const urlObj = new URL(path, 'http://localhost');
  const pathname = urlObj.pathname;
  const searchParams = urlObj.searchParams;

  let body: any = null;
  if (options?.body) {
    if (typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = options.body;
      }
    } else {
      body = options.body;
    }
  }

  // 1. Health & DB Status
  if (pathname === '/api/health') {
    return { status: 'ok', serverless: true, database: 'Client-Side Persistent DB' };
  }

  if (pathname === '/api/db-status') {
    return clientDb.getStatus();
  }

  // 2. Admin Authentication & Security
  if (pathname === '/api/admin/login' && method === 'POST') {
    const { password } = body || {};
    if (clientDb.verifyAdminPassword(password)) {
      return { success: true, message: 'ஆசிரியர் உள்நுழைவு வெற்றிகரமானது (Teacher Login Successful)' };
    }
    throw new Error('தவறான கடவுச்சொல் (Invalid Teacher Password).');
  }

  if (pathname === '/api/admin/forgot-password/verify-pin' && method === 'POST') {
    const { pin, adminPin } = body || {};
    const effectivePin = pin || adminPin;
    if (clientDb.verifyAdminPin(effectivePin)) {
      const resetToken = generateResetToken();
      return { 
        success: true, 
        resetToken, 
        message: 'பாதுகாப்பு பின் குறியீடு சரியானது (Security PIN verified).' 
      };
    }
    throw new Error('தவறான பாதுகாப்பு பின் குறியீடு (Invalid Security PIN). ஆசிரியர் PIN: 273464');
  }

  if (pathname === '/api/admin/forgot-password/reset-password' && method === 'POST') {
    const { pin, adminPin, resetToken, newPassword } = body || {};
    const effectivePin = pin || adminPin;
    const hasValidToken = resetToken && isValidResetToken(resetToken);
    const hasValidPin = effectivePin && clientDb.verifyAdminPin(effectivePin);

    if (!hasValidToken && !hasValidPin) {
      throw new Error('காலாவதியான அல்லது தவறான பாதுகாப்பு சரிபார்ப்பு. தயவுசெய்து PIN-ஐ மீண்டும் சரிபார்க்கவும்.');
    }
    if (!newPassword || newPassword.trim().length < 4) {
      throw new Error('புதிய கடவுச்சொல் குறைந்தது 4 எழுத்துக்களைக் கொண்டிருக்க வேண்டும்.');
    }
    if (resetToken) {
      consumeResetToken(resetToken);
    }
    clientDb.setAdminPassword(newPassword);
    return { success: true, message: 'கடவுச்சொல் வெற்றிகரமாக மாற்றப்பட்டது.' };
  }

  if (pathname === '/api/admin/change-password' && method === 'POST') {
    const { currentPassword, newPassword } = body || {};
    if (!clientDb.verifyAdminPassword(currentPassword)) {
      throw new Error('தற்போதைய கடவுச்சொல் தவறானது (Current password incorrect).');
    }
    if (!newPassword || newPassword.length < 4) {
      throw new Error('புதிய கடவுச்சொல் குறைந்தது 4 எழுத்துக்களைக் கொண்டிருக்க வேண்டும்.');
    }
    clientDb.setAdminPassword(newPassword);
    return { success: true, message: 'கடவுச்சொல் வெற்றிகரமாக மாற்றப்பட்டது.' };
  }

  if (pathname === '/api/admin/change-pin' && method === 'POST') {
    const { currentPin, newPin, currentPassword } = body || {};
    if (!clientDb.verifyAdminPin(currentPin) && !clientDb.verifyAdminPassword(currentPassword)) {
      throw new Error('தற்போதைய பின் அல்லது கடவுச்சொல் தவறானது.');
    }
    if (!newPin || newPin.trim().length < 4) {
      throw new Error('புதிய PIN எண் குறைந்தது 4 இலக்கங்களைக் கொண்டிருக்க வேண்டும்.');
    }
    clientDb.setAdminPin(newPin);
    return { success: true, message: 'பாதுகாப்பு PIN வெற்றிகரமாக மாற்றப்பட்டது.' };
  }

  // 3. Student Roster & Verification
  if (pathname === '/api/students/verify') {
    const examNumber = searchParams.get('examNumber') || body?.examNumber;
    const quizId = searchParams.get('quizId') || body?.quizId;
    const student = clientDb.findStudent(examNumber);
    if (!student) {
      return {
        authorized: false,
        success: false,
        error: 'அங்கீகரிக்கப்படாத மாணவர் எண் (Invalid Student Exam Number). தயவுசெய்து உங்கள் தேர்வு எண்ணை சரியாக உள்ளிடவும்.',
      };
    }
    const previousAttempts = clientDb.getAttempts(quizId, student.examNumber);
    return {
      authorized: true,
      success: true,
      student,
      previousAttemptsCount: previousAttempts.length,
      previousAttempts,
      allAttempts: previousAttempts,
      latestAttempt: previousAttempts[0] || null,
    };
  }

  if (pathname === '/api/students/roster' && method === 'GET') {
    const students = clientDb.getStudents();
    const attempts = clientDb.getAttempts();

    const rosterWithStats = students.map((s) => {
      const studentAttempts = attempts.filter(
        (a) => a.examNumber.toUpperCase() === s.examNumber.toUpperCase()
      );
      const totalScore = studentAttempts.reduce((acc, curr) => acc + (curr.score?.percentage || 0), 0);
      const averagePercentage =
        studentAttempts.length > 0 ? Math.round(totalScore / studentAttempts.length) : 0;
      const passedCount = studentAttempts.filter((a) => a.score?.isEligible).length;

      return {
        ...s,
        totalAttempts: studentAttempts.length,
        averagePercentage,
        passedCount,
        lastAttemptAt: studentAttempts[0]?.submittedAt || null,
      };
    });

    return { students: rosterWithStats };
  }

  if (pathname === '/api/students' && method === 'POST') {
    const { examNumber, studentName, school, adminPin, pin } = body || {};
    const effectivePin = pin || adminPin;
    if (!clientDb.verifyAdminPin(effectivePin)) {
      throw new Error('தவறான ஆசிரியர் பாதுகாப்பு பின் (Invalid Admin PIN: 273464).');
    }
    if (!examNumber || !studentName) {
      throw new Error('மாணவர் எண் மற்றும் பெயர் கட்டாயமாகும்.');
    }
    const cleanExam = String(examNumber).trim().toUpperCase();
    const cleanName = String(studentName).trim();
    const success = clientDb.addStudent({ examNumber: cleanExam, studentName: cleanName, school: school || 'GHS Kadayam' });
    if (!success) {
      throw new Error('இந்த மாணவர் எண் ஏற்கனவே பட்டியலில் உள்ளது.');
    }
    return { success: true, message: 'மாணவர் வெற்றிகரமாக சேர்க்கப்பட்டார்.' };
  }

  if (pathname.startsWith('/api/students/') && pathname.endsWith('/history') && method === 'GET') {
    const examNumber = decodeURIComponent(pathname.replace('/api/students/', '').replace('/history', ''));
    const student = clientDb.findStudent(examNumber);
    const attempts = clientDb.getAttempts(undefined, examNumber);

    // Group attempts by quiz
    const quizMap = new Map<string, typeof attempts>();
    attempts.forEach((a) => {
      const qList = quizMap.get(a.quizId) || [];
      qList.push(a);
      quizMap.set(a.quizId, qList);
    });

    const quizSummaries = Array.from(quizMap.entries()).map(([quizId, atts]) => {
      const best = atts.reduce((max, curr) => (curr.score?.percentage || 0) > (max.score?.percentage || 0) ? curr : max, atts[0]);
      const latest = atts[0];
      return {
        quizId,
        quizTitle: latest.quizTitle || quizId,
        attemptCount: atts.length,
        bestScore: best.score?.totalObtained || 0,
        totalPossible: best.score?.totalPossible || 0,
        bestPercentage: best.score?.percentage || 0,
        latestScore: latest.score?.totalObtained || 0,
        latestPercentage: latest.score?.percentage || 0,
        latestSubmittedAt: latest.submittedAt || new Date().toISOString(),
        attempts: atts,
      };
    });

    const totalAttempts = attempts.length;
    const overallAveragePercentage = totalAttempts > 0
      ? Math.round(attempts.reduce((sum, a) => sum + (a.score?.percentage || 0), 0) / totalAttempts)
      : 0;

    const overallBestScore = attempts.reduce((max, a) => Math.max(max, a.score?.totalObtained || 0), 0);

    // Calculate subject averages safely
    const subTotals: Record<NMMS_Subject, { accSum: number; count: number }> = {
      MAT: { accSum: 0, count: 0 },
      SAT_MATHS: { accSum: 0, count: 0 },
      SAT_SCIENCE: { accSum: 0, count: 0 },
      SAT_SOCIAL: { accSum: 0, count: 0 },
    };

    attempts.forEach((a) => {
      if (a.score?.subjectBreakdown) {
        (['MAT', 'SAT_MATHS', 'SAT_SCIENCE', 'SAT_SOCIAL'] as NMMS_Subject[]).forEach((sub) => {
          const b = a.score.subjectBreakdown[sub];
          if (b && typeof b.accuracy === 'number') {
            subTotals[sub].accSum += b.accuracy;
            subTotals[sub].count += 1;
          }
        });
      }
    });

    const subjectAverages = {
      MAT: subTotals.MAT.count > 0 ? Math.round(subTotals.MAT.accSum / subTotals.MAT.count) : 0,
      SAT_MATHS: subTotals.SAT_MATHS.count > 0 ? Math.round(subTotals.SAT_MATHS.accSum / subTotals.SAT_MATHS.count) : 0,
      SAT_SCIENCE: subTotals.SAT_SCIENCE.count > 0 ? Math.round(subTotals.SAT_SCIENCE.accSum / subTotals.SAT_SCIENCE.count) : 0,
      SAT_SOCIAL: subTotals.SAT_SOCIAL.count > 0 ? Math.round(subTotals.SAT_SOCIAL.accSum / subTotals.SAT_SOCIAL.count) : 0,
    };

    return {
      student: {
        examNumber: student ? student.examNumber : examNumber,
        studentName: student ? student.studentName : (attempts[0]?.studentName || 'Student'),
      },
      totalAttempts,
      totalQuizzesAttempted: quizSummaries.length,
      overallAveragePercentage,
      overallBestScore,
      quizSummaries,
      allAttempts: attempts,
      subjectAverages,
    };
  }

  if (pathname.startsWith('/api/students/') && method === 'DELETE') {
    const examNumber = decodeURIComponent(pathname.replace('/api/students/', ''));
    const { adminPin, pin } = body || {};
    const effectivePin = pin || adminPin;
    if (!clientDb.verifyAdminPin(effectivePin)) {
      throw new Error('தவறான ஆசிரியர் பாதுகாப்பு பின் (Invalid Admin PIN: 273464).');
    }
    const removed = clientDb.removeStudent(examNumber);
    if (!removed) {
      throw new Error('மாணவர் காணப்படவில்லை.');
    }
    return { success: true, message: 'மாணவர் பட்டியலிலிருந்து நீக்கப்பட்டார்.', removed };
  }

  // 4. Quizzes
  if (pathname === '/api/quizzes' && method === 'GET') {
    return clientDb.getQuizzes();
  }

  if (pathname === '/api/quizzes' && method === 'POST') {
    const newQuiz: Quiz = {
      ...body,
      id: body.id || `quiz-${Date.now()}`,
      status: body.status || 'active',
      createdAt: new Date().toISOString(),
    };
    clientDb.saveQuiz(newQuiz);
    return newQuiz;
  }

  if (pathname.match(/^\/api\/quizzes\/[^\/]+$/)) {
    const quizId = decodeURIComponent(pathname.replace('/api/quizzes/', ''));

    if (method === 'GET') {
      let quiz = clientDb.getQuiz(quizId);
      if (!quiz && quizId.startsWith('pyq-')) {
        quiz = await getPyqQuizById(quizId);
      }
      if (!quiz && quizId.startsWith('unit-')) {
        const parts = quizId.replace('unit-', '').split('-');
        const subPrefix = parts[0];
        const unitNum = parseInt(parts[1], 10);
        let subject: NMMS_Subject = 'MAT';
        if (subPrefix === 'mat') subject = 'MAT';
        else if (subPrefix === 'satmaths') subject = 'SAT_MATHS';
        else if (subPrefix === 'satscience') subject = 'SAT_SCIENCE';
        else if (subPrefix === 'satsocial') subject = 'SAT_SOCIAL';
        const built = await buildQuizFromUnit(subject, unitNum);
        if (built) quiz = built;
      }
      if (!quiz) {
        throw new Error('தேர்வு வினாத்தாள் கிடைக்கவில்லை (Quiz not found).');
      }
      return quiz;
    }

    if (method === 'PUT') {
      const updated = clientDb.saveQuiz({ ...body, id: quizId });
      return updated;
    }

    if (method === 'DELETE') {
      const deleted = clientDb.deleteQuiz(quizId);
      clientDb.deleteAttemptsByQuiz(quizId);
      return { success: deleted };
    }
  }

  // 5. Submit Quiz & Analytics
  if (pathname.match(/^\/api\/quizzes\/[^\/]+\/submit$/) && method === 'POST') {
    const quizId = decodeURIComponent(pathname.replace('/api/quizzes/', '').replace('/submit', ''));
    let quiz = clientDb.getQuiz(quizId);
    if (!quiz && quizId.startsWith('pyq-')) {
      quiz = await getPyqQuizById(quizId);
      if (quiz) clientDb.saveQuiz(quiz);
    }
    if (!quiz && quizId.startsWith('unit-')) {
      const parts = quizId.replace('unit-', '').split('-');
      const subPrefix = parts[0];
      const unitNum = parseInt(parts[1], 10);
      let subject: NMMS_Subject = 'MAT';
      if (subPrefix === 'mat') subject = 'MAT';
      else if (subPrefix === 'satmaths') subject = 'SAT_MATHS';
      else if (subPrefix === 'satscience') subject = 'SAT_SCIENCE';
      else if (subPrefix === 'satsocial') subject = 'SAT_SOCIAL';
      const built = await buildQuizFromUnit(subject, unitNum);
      if (built) {
        quiz = built;
        clientDb.saveQuiz(built);
      }
    }

    const result = submitExamAttempt(quizId, body);
    return result;
  }

  if (pathname.match(/^\/api\/quizzes\/[^\/]+\/attempts$/)) {
    const quizId = decodeURIComponent(pathname.replace('/api/quizzes/', '').replace('/attempts', ''));
    if (method === 'GET') {
      return clientDb.getAttempts(quizId);
    }
    if (method === 'DELETE') {
      const count = clientDb.deleteAttemptsByQuiz(quizId);
      return { success: true, deletedCount: count };
    }
  }

  if (pathname.match(/^\/api\/quizzes\/[^\/]+\/analytics$/) && method === 'GET') {
    const quizId = decodeURIComponent(pathname.replace('/api/quizzes/', '').replace('/analytics', ''));
    let quiz = clientDb.getQuiz(quizId);
    if (!quiz && quizId.startsWith('pyq-')) {
      quiz = (await getPyqQuizById(quizId)) || undefined;
    }
    const attempts = clientDb.getAttempts(quizId);

    const totalAttempts = attempts.length;
    const passedCount = attempts.filter((a) => a.score?.isEligible).length;
    const passRate = totalAttempts > 0 ? Math.round((passedCount / totalAttempts) * 100) : 0;
    const averagePercentage =
      totalAttempts > 0
        ? Math.round(attempts.reduce((sum, a) => sum + (a.score?.percentage || 0), 0) / totalAttempts)
        : 0;
    const averageScore =
      totalAttempts > 0
        ? Math.round((attempts.reduce((sum, a) => sum + (a.score?.totalObtained || 0), 0) / totalAttempts) * 10) / 10
        : 0;
    const highestScore = attempts.reduce((max, a) => Math.max(max, a.score?.totalObtained || 0), 0);
    const lowestScore = totalAttempts > 0 ? attempts.reduce((min, a) => Math.min(min, a.score?.totalObtained || 0), attempts[0].score?.totalObtained || 0) : 0;
    const averageTimeSeconds =
      totalAttempts > 0
        ? Math.round(attempts.reduce((sum, a) => sum + (a.timeTakenSeconds || 0), 0) / totalAttempts)
        : 0;

    const subTotals: Record<NMMS_Subject, { accSum: number; count: number }> = {
      MAT: { accSum: 0, count: 0 },
      SAT_MATHS: { accSum: 0, count: 0 },
      SAT_SCIENCE: { accSum: 0, count: 0 },
      SAT_SOCIAL: { accSum: 0, count: 0 },
    };

    attempts.forEach((a) => {
      if (a.score?.subjectBreakdown) {
        (['MAT', 'SAT_MATHS', 'SAT_SCIENCE', 'SAT_SOCIAL'] as NMMS_Subject[]).forEach((sub) => {
          const b = a.score.subjectBreakdown[sub];
          if (b && typeof b.accuracy === 'number') {
            subTotals[sub].accSum += b.accuracy;
            subTotals[sub].count += 1;
          }
        });
      }
    });

    const subjectAverages = {
      MAT: subTotals.MAT.count > 0 ? Math.round(subTotals.MAT.accSum / subTotals.MAT.count) : 0,
      SAT_MATHS: subTotals.SAT_MATHS.count > 0 ? Math.round(subTotals.SAT_MATHS.accSum / subTotals.SAT_MATHS.count) : 0,
      SAT_SCIENCE: subTotals.SAT_SCIENCE.count > 0 ? Math.round(subTotals.SAT_SCIENCE.accSum / subTotals.SAT_SCIENCE.count) : 0,
      SAT_SOCIAL: subTotals.SAT_SOCIAL.count > 0 ? Math.round(subTotals.SAT_SOCIAL.accSum / subTotals.SAT_SOCIAL.count) : 0,
    };

    const questionStats = (quiz?.questions || []).map((q, idx) => {
      let correctCount = 0;
      let wrongCount = 0;
      let unattempted = 0;

      attempts.forEach((a) => {
        const ans = a.answers?.[q.id];
        if (!ans) {
          unattempted++;
        } else if (ans === q.correctOption) {
          correctCount++;
        } else {
          wrongCount++;
        }
      });

      const totalResponses = correctCount + wrongCount + unattempted;
      const correctRate = totalResponses > 0 ? Math.round((correctCount / totalResponses) * 100) : 0;
      const difficultyRating: 'Easy' | 'Moderate' | 'Hard' =
        correctRate >= 70 ? 'Easy' : correctRate >= 40 ? 'Moderate' : 'Hard';

      return {
        questionId: q.id,
        questionNumber: idx + 1,
        subject: q.subject,
        questionText: q.questionText,
        correctRate,
        correctAttempts: correctCount,
        wrongAttempts: wrongCount,
        unattempted,
        difficultyRating,
      };
    });

    return {
      quizId,
      quizTitle: quiz?.title || quizId,
      totalAttempts,
      averageScore,
      averagePercentage,
      highestScore,
      lowestScore,
      averageTimeSeconds,
      passRate,
      subjectAverages,
      questionStats,
      recentAttempts: attempts,
    };
  }

  // 6. Attempts List & Deletion
  if (pathname === '/api/attempts' && method === 'GET') {
    const quizId = searchParams.get('quizId') || undefined;
    const examNumber = searchParams.get('examNumber') || undefined;
    return clientDb.getAttempts(quizId, examNumber);
  }

  if (pathname.startsWith('/api/attempts/') && method === 'DELETE') {
    const attemptId = decodeURIComponent(pathname.replace('/api/attempts/', ''));
    const deleted = clientDb.deleteAttempt(attemptId);
    return { success: deleted };
  }

  // 7. PYQ Papers
  if (pathname === '/api/pyq/papers' && method === 'GET') {
    const papers = await getPyqPapersSummaries();
    return { papers };
  }

  if (pathname === '/api/pyq/deploy' && method === 'POST') {
    const { paperId, ...options } = body || {};
    if (!paperId) {
      throw new Error('வினாத்தாள் எண் குறிப்பிடப்படவில்லை (Paper ID required).');
    }
    const deployed = await deployPyqPaper(paperId, options);
    return { success: true, quiz: deployed, message: 'வினாத்தாள் மாதிரித் தேர்வாக வெளியிடப்பட்டது.' };
  }

  if ((pathname === '/api/pyq/deploy-all' || pathname === '/api/pyq/papers/deploy-all') && method === 'POST') {
    const papers = await getPyqPapersSummaries();
    let count = 0;
    for (const p of papers) {
      await deployPyqPaper(p.id);
      count++;
    }
    return { success: true, count, message: `${count} வினாத்தாள்கள் மாதிரித் தேர்வுகளாக வெளியிடப்பட்டன!` };
  }

  if (pathname.match(/^\/api\/pyq\/papers\/[^\/]+\/deploy$/) && method === 'POST') {
    const paperId = decodeURIComponent(pathname.replace('/api/pyq/papers/', '').replace('/deploy', ''));
    const deployed = await deployPyqPaper(paperId, body);
    return { success: true, quiz: deployed, message: 'வினாத்தாள் மாதிரித் தேர்வாக வெளியிடப்பட்டது.' };
  }

  if (pathname.match(/^\/api\/pyq\/papers\/[^\/]+$/) && method === 'GET') {
    const paperId = decodeURIComponent(pathname.replace('/api/pyq/papers/', ''));
    const paper = await getPyqQuizById(paperId);
    if (!paper) {
      throw new Error('முந்தைய ஆண்டு வினாத்தாள் கிடைக்கவில்லை (PYQ Paper not found).');
    }
    return paper;
  }

  // 8. Subject Units
  if (pathname === '/api/subject-units' && method === 'GET') {
    const subjectParam = searchParams.get('subject') as NMMS_Subject | null;
    if (subjectParam) {
      const units = await getSubjectUnitSummaries(subjectParam);
      return { units };
    }
    const all = await getAllSubjectUnits();
    return { units: all };
  }

  // Deploy single unit via /api/subject-units/deploy
  if (pathname === '/api/subject-units/deploy' && method === 'POST') {
    const { subject, unitNum, ...options } = body || {};
    if (!subject || unitNum === undefined) {
      throw new Error('பாடப் பிரிவு மற்றும் அலகு எண் அவசியம் (Subject and unit number required).');
    }
    const builtQuiz = await buildQuizFromUnit(subject as NMMS_Subject, Number(unitNum), options);
    if (!builtQuiz) {
      throw new Error('அலகு வினாத்தாள் உருவாக்க முடியவில்லை.');
    }
    clientDb.saveQuiz(builtQuiz);
    return { success: true, quiz: builtQuiz, message: 'அலகு மாதிரித் தேர்வாக வெளியிடப்பட்டது.' };
  }

  // Bulk deploy all units of a subject via /api/subject-units/deploy-all
  if (pathname === '/api/subject-units/deploy-all' && method === 'POST') {
    const { subject } = body || {};
    if (!subject) {
      throw new Error('பாடப் பிரிவு குறிப்பிடப்படவில்லை (Subject is required).');
    }
    const units = await getSubjectUnitSummaries(subject as NMMS_Subject);
    let deployedCount = 0;
    for (const unit of units) {
      const builtQuiz = await buildQuizFromUnit(subject as NMMS_Subject, unit.unitNumber);
      if (builtQuiz) {
        clientDb.saveQuiz(builtQuiz);
        deployedCount++;
      }
    }
    return {
      success: true,
      count: deployedCount,
      message: `${deployedCount} அலகுகள் மாதிரித் தேர்வுகளாக வெற்றிகரமாக வெளியிடப்பட்டன!`,
    };
  }

  // Question subpaths (/api/subject-units/:subject/:unitNum/questions/...)
  const questionPathMatch = pathname.match(/^\/api\/subject-units\/([^\/]+)\/(\d+)\/questions(?:\/([^\/]+))?$/);
  if (questionPathMatch) {
    const subject = questionPathMatch[1] as NMMS_Subject;
    const unitNum = parseInt(questionPathMatch[2], 10);
    const questionIdFromPath = questionPathMatch[3];

    if (method === 'POST') {
      const added = await addQuestionToUnit(subject, unitNum, body);
      return added;
    }

    if (method === 'PUT') {
      const targetQId = questionIdFromPath || body?.id || body?.questionId;
      const { questionId, ...updateFields } = body || {};
      const updated = await updateQuestionInUnit(subject, unitNum, targetQId, updateFields);
      return updated;
    }

    if (method === 'DELETE') {
      const targetQId = questionIdFromPath || searchParams.get('questionId') || body?.questionId;
      const deleted = await deleteQuestionFromUnit(subject, unitNum, targetQId);
      return { success: deleted, message: 'வினா வெற்றிகரமாக நீக்கப்பட்டது.' };
    }
  }

  if (pathname.match(/^\/api\/subject-units\/[^\/]+\/\d+\/reset$/) && method === 'POST') {
    const parts = pathname.replace('/api/subject-units/', '').replace('/reset', '').split('/');
    const subject = parts[0] as NMMS_Subject;
    const unitNum = parseInt(parts[1], 10);
    const success = await resetUnitToDefault(subject, unitNum);
    return { success, message: 'அலகு வினாக்கள் மீட்டமைக்கப்பட்டன.' };
  }

  if (pathname.match(/^\/api\/subject-units\/[^\/]+\/\d+\/deploy$/) && method === 'POST') {
    const parts = pathname.replace('/api/subject-units/', '').replace('/deploy', '').split('/');
    const subject = parts[0] as NMMS_Subject;
    const unitNum = parseInt(parts[1], 10);
    const builtQuiz = await buildQuizFromUnit(subject, unitNum, body);
    if (!builtQuiz) {
      throw new Error('அலகு வினாத்தாள் உருவாக்க முடியவில்லை.');
    }
    clientDb.saveQuiz(builtQuiz);
    return { success: true, quiz: builtQuiz, message: 'அலகு மாதிரித் தேர்வாக வெளியிடப்பட்டது.' };
  }

  if (pathname.match(/^\/api\/subject-units\/[^\/]+\/\d+$/)) {
    const parts = pathname.replace('/api/subject-units/', '').split('/');
    const subject = parts[0] as NMMS_Subject;
    const unitNum = parseInt(parts[1], 10);

    if (method === 'GET') {
      const questions = await getUnitQuestions(subject, unitNum);
      return { questions };
    }

    if (method === 'POST') {
      const added = await addQuestionToUnit(subject, unitNum, body);
      return added;
    }

    if (method === 'PUT') {
      const { questionId, ...updateFields } = body;
      const updated = await updateQuestionInUnit(subject, unitNum, questionId, updateFields);
      return updated;
    }

    if (method === 'DELETE') {
      const questionId = searchParams.get('questionId') || body?.questionId;
      const deleted = await deleteQuestionFromUnit(subject, unitNum, questionId);
      return { success: deleted };
    }
  }

  // 9. AI Question Extraction & Generation
  if (pathname === '/api/ai/extract-questions' && method === 'POST') {
    const questions = await extractQuestionsAI(body);
    return { success: true, questions };
  }

  if (pathname === '/api/ai/generate-questions' && method === 'POST') {
    const { topic, subject, count, difficulty } = body;
    const questions = await generateQuestionsAI(topic, subject, count, difficulty);
    return { success: true, questions };
  }

  // 10. Database Backup & Restore
  if (pathname === '/api/db/export' && method === 'GET') {
    return { json: clientDb.exportDatabaseJSON() };
  }

  if (pathname === '/api/db/import' && method === 'POST') {
    const { jsonString } = body;
    const res = clientDb.importDatabaseJSON(jsonString);
    return res;
  }

  throw new Error(`Serverless endpoint not found: ${method} ${pathname}`);
}
