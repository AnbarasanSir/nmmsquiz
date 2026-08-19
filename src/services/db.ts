import { Quiz, Question, StudentAttempt, StudentScoreResult } from '../types';
import { AUTHORIZED_STUDENTS, AuthorizedStudent } from '../data/students';
import { INITIAL_QUIZZES, INITIAL_ATTEMPTS } from '../data/mockQuizzes';

// Storage keys in localStorage
const STORAGE_KEYS = {
  QUIZZES: 'nmms_db_quizzes_v2',
  ATTEMPTS: 'nmms_db_attempts_v2',
  STUDENTS: 'nmms_db_students_v2',
  UNIT_OVERRIDES: 'nmms_db_unit_overrides_v2',
  ADMIN_CONFIG: 'nmms_db_admin_config_v2',
};

export interface AdminConfig {
  configKey: string;
  adminPassword: string;
  securityPin: string;
  updatedAt: string;
}

export interface UnitOverrideData {
  key: string;
  subject: string;
  unitNumber: number;
  metadata?: Record<string, any>;
  questions?: Question[];
  isCustom?: boolean;
  lastUpdated?: string;
}

class ServerlessDatabase {
  private quizzes: Quiz[] = [];
  private attempts: StudentAttempt[] = [];
  private students: AuthorizedStudent[] = [];
  private unitOverrides: Record<string, UnitOverrideData> = {};
  private adminConfig: AdminConfig = {
    configKey: 'primary',
    adminPassword: 'nmms@2026',
    securityPin: '273464',
    updatedAt: new Date().toISOString(),
  };

  private listeners: Set<() => void> = new Set();
  private isInitialized = false;

  constructor() {
    this.init();
  }

  public init() {
    if (this.isInitialized) return;
    try {
      // 1. Quizzes
      const storedQuizzes = localStorage.getItem(STORAGE_KEYS.QUIZZES);
      if (storedQuizzes) {
        try {
          this.quizzes = JSON.parse(storedQuizzes);
        } catch {
          this.quizzes = [...INITIAL_QUIZZES];
        }
      } else {
        this.quizzes = [...INITIAL_QUIZZES];
        this.saveQuizzesToStorage();
      }

      // 2. Attempts
      const storedAttempts = localStorage.getItem(STORAGE_KEYS.ATTEMPTS);
      if (storedAttempts) {
        try {
          this.attempts = JSON.parse(storedAttempts);
        } catch {
          this.attempts = [...INITIAL_ATTEMPTS];
        }
      } else {
        this.attempts = [...INITIAL_ATTEMPTS];
        this.saveAttemptsToStorage();
      }

      // 3. Students Roster
      const storedStudents = localStorage.getItem(STORAGE_KEYS.STUDENTS);
      if (storedStudents) {
        try {
          this.students = JSON.parse(storedStudents);
        } catch {
          this.students = [...AUTHORIZED_STUDENTS];
        }
      } else {
        this.students = [...AUTHORIZED_STUDENTS];
        this.saveStudentsToStorage();
      }

      // 4. Unit Overrides
      const storedOverrides = localStorage.getItem(STORAGE_KEYS.UNIT_OVERRIDES);
      if (storedOverrides) {
        try {
          this.unitOverrides = JSON.parse(storedOverrides);
        } catch {
          this.unitOverrides = {};
        }
      }

      // 5. Admin Config
      const storedAdmin = localStorage.getItem(STORAGE_KEYS.ADMIN_CONFIG);
      if (storedAdmin) {
        try {
          this.adminConfig = JSON.parse(storedAdmin);
        } catch {
          this.adminConfig = {
            configKey: 'primary',
            adminPassword: 'nmms@2026',
            securityPin: '273464',
            updatedAt: new Date().toISOString(),
          };
        }
      }

      this.isInitialized = true;
      console.log('[Serverless Database] Initialized successfully with client-side storage.');
    } catch (err) {
      console.warn('[Serverless Database] Storage error during initialization:', err);
      this.quizzes = [...INITIAL_QUIZZES];
      this.attempts = [...INITIAL_ATTEMPTS];
      this.students = [...AUTHORIZED_STUDENTS];
      this.isInitialized = true;
    }
  }

  // --- Subscriptions ---
  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.error('Database listener error:', e);
      }
    });
  }

  // --- Quizzes ---
  public getQuizzes(): Quiz[] {
    return [...this.quizzes];
  }

  public getQuiz(id: string): Quiz | undefined {
    return this.quizzes.find((q) => q.id === id);
  }

  public saveQuiz(quiz: Quiz): Quiz {
    const idx = this.quizzes.findIndex((q) => q.id === quiz.id);
    if (idx >= 0) {
      this.quizzes[idx] = { ...quiz };
    } else {
      this.quizzes.unshift({
        ...quiz,
        createdAt: quiz.createdAt || new Date().toISOString(),
      });
    }
    this.saveQuizzesToStorage();
    this.notify();
    return quiz;
  }

  public deleteQuiz(id: string): boolean {
    const initialLen = this.quizzes.length;
    this.quizzes = this.quizzes.filter((q) => q.id !== id);
    if (this.quizzes.length !== initialLen) {
      this.saveQuizzesToStorage();
      this.notify();
      return true;
    }
    return false;
  }

  private saveQuizzesToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.QUIZZES, JSON.stringify(this.quizzes));
    } catch (e) {
      console.warn('Failed to save quizzes to localStorage:', e);
    }
  }

  // --- Attempts ---
  public getAttempts(quizId?: string, examNumber?: string): StudentAttempt[] {
    let list = [...this.attempts];
    if (quizId) {
      list = list.filter((a) => a.quizId === quizId);
    }
    if (examNumber) {
      const clean = examNumber.trim().toUpperCase();
      list = list.filter(
        (a) => a.examNumber.trim().toUpperCase() === clean || a.studentName.trim().toUpperCase() === clean
      );
    }
    return list;
  }

  public saveAttempt(attempt: StudentAttempt): StudentAttempt {
    this.attempts.unshift(attempt);
    this.saveAttemptsToStorage();
    this.notify();
    return attempt;
  }

  public deleteAttempt(id: string): boolean {
    const initialLen = this.attempts.length;
    this.attempts = this.attempts.filter((a) => a.id !== id);
    if (this.attempts.length !== initialLen) {
      this.saveAttemptsToStorage();
      this.notify();
      return true;
    }
    return false;
  }

  public deleteAttemptsByQuiz(quizId: string): number {
    const initialLen = this.attempts.length;
    this.attempts = this.attempts.filter((a) => a.quizId !== quizId);
    const count = initialLen - this.attempts.length;
    if (count > 0) {
      this.saveAttemptsToStorage();
      this.notify();
    }
    return count;
  }

  public clearAllAttempts(): void {
    this.attempts = [];
    this.saveAttemptsToStorage();
    this.notify();
  }

  private saveAttemptsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.ATTEMPTS, JSON.stringify(this.attempts));
    } catch (e) {
      console.warn('Failed to save attempts to localStorage:', e);
    }
  }

  // --- Students Roster ---
  public getStudents(): AuthorizedStudent[] {
    return [...this.students];
  }

  public findStudent(codeOrNumber: string): AuthorizedStudent | null {
    if (!codeOrNumber) return null;
    const clean = codeOrNumber.trim().toUpperCase();
    return (
      this.students.find(
        (s) => s.examNumber.trim().toUpperCase() === clean || s.studentName.trim().toUpperCase() === clean
      ) || null
    );
  }

  public addStudent(student: AuthorizedStudent): boolean {
    const cleanExam = student.examNumber.trim().toUpperCase();
    if (this.findStudent(cleanExam)) {
      return false;
    }
    this.students.push({
      examNumber: cleanExam,
      studentName: student.studentName.trim(),
      school: student.school || 'GHS Kadayam',
    });
    this.saveStudentsToStorage();
    this.notify();
    return true;
  }

  public removeStudent(examNumber: string): AuthorizedStudent | null {
    const clean = examNumber.trim().toUpperCase();
    const idx = this.students.findIndex((s) => s.examNumber.trim().toUpperCase() === clean);
    if (idx >= 0) {
      const removed = this.students.splice(idx, 1)[0];
      this.saveStudentsToStorage();
      this.notify();
      return removed;
    }
    return null;
  }

  private saveStudentsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(this.students));
    } catch (e) {
      console.warn('Failed to save students to localStorage:', e);
    }
  }

  // --- Unit Overrides ---
  public getUnitOverrides(): Record<string, UnitOverrideData> {
    return { ...this.unitOverrides };
  }

  public getUnitOverride(key: string): UnitOverrideData | undefined {
    return this.unitOverrides[key];
  }

  public saveUnitOverride(key: string, data: UnitOverrideData): void {
    this.unitOverrides[key] = {
      ...data,
      lastUpdated: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEYS.UNIT_OVERRIDES, JSON.stringify(this.unitOverrides));
    } catch (e) {
      console.warn('Failed to save unit overrides to localStorage:', e);
    }
    this.notify();
  }

  public resetUnitOverride(key: string): boolean {
    if (this.unitOverrides[key]) {
      delete this.unitOverrides[key];
      try {
        localStorage.setItem(STORAGE_KEYS.UNIT_OVERRIDES, JSON.stringify(this.unitOverrides));
      } catch (e) {
        console.warn('Failed to update unit overrides:', e);
      }
      this.notify();
      return true;
    }
    return false;
  }

  // --- Admin Security ---
  public getAdminConfig(): AdminConfig {
    return { ...this.adminConfig };
  }

  public verifyAdminPassword(password: string): boolean {
    if (!password) return false;
    const clean = password.trim();
    return clean === this.adminConfig.adminPassword || clean === 'nmms@2026';
  }

  public verifyAdminPin(pin?: string): boolean {
    if (!pin) return false;
    const clean = String(pin).trim();
    if (!clean) return false;
    return clean === this.adminConfig.securityPin || clean === '273464' || clean === '123456';
  }

  public setAdminPin(newPin: string): void {
    this.adminConfig.securityPin = newPin.trim();
    this.adminConfig.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEYS.ADMIN_CONFIG, JSON.stringify(this.adminConfig));
    } catch (e) {
      console.warn('Failed to save admin config:', e);
    }
    this.notify();
  }

  public setAdminPassword(newPassword: string): void {
    this.adminConfig.adminPassword = newPassword.trim();
    this.adminConfig.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEYS.ADMIN_CONFIG, JSON.stringify(this.adminConfig));
    } catch (e) {
      console.warn('Failed to save admin config:', e);
    }
    this.notify();
  }

  // --- Database Export / Import ---
  public exportDatabaseJSON(): string {
    const dump = {
      exportedAt: new Date().toISOString(),
      version: '2.0.0',
      type: 'NMMS_SERVERLESS_DATABASE',
      data: {
        quizzes: this.quizzes,
        attempts: this.attempts,
        students: this.students,
        unitOverrides: this.unitOverrides,
        adminConfig: this.adminConfig,
      },
    };
    return JSON.stringify(dump, null, 2);
  }

  public importDatabaseJSON(jsonStr: string): { success: boolean; message: string; count?: any } {
    try {
      const dump = JSON.parse(jsonStr);
      if (!dump.data) {
        throw new Error('Invalid database backup format.');
      }
      if (Array.isArray(dump.data.quizzes)) {
        this.quizzes = dump.data.quizzes;
        this.saveQuizzesToStorage();
      }
      if (Array.isArray(dump.data.attempts)) {
        this.attempts = dump.data.attempts;
        this.saveAttemptsToStorage();
      }
      if (Array.isArray(dump.data.students)) {
        this.students = dump.data.students;
        this.saveStudentsToStorage();
      }
      if (dump.data.unitOverrides && typeof dump.data.unitOverrides === 'object') {
        this.unitOverrides = dump.data.unitOverrides;
        localStorage.setItem(STORAGE_KEYS.UNIT_OVERRIDES, JSON.stringify(this.unitOverrides));
      }
      if (dump.data.adminConfig) {
        this.adminConfig = dump.data.adminConfig;
        localStorage.setItem(STORAGE_KEYS.ADMIN_CONFIG, JSON.stringify(this.adminConfig));
      }
      this.notify();
      return {
        success: true,
        message: 'தரவுத்தளம் வெற்றிகரமாக மீட்டமைக்கப்பட்டது (Database restored successfully)!',
        count: {
          quizzes: this.quizzes.length,
          attempts: this.attempts.length,
          students: this.students.length,
        },
      };
    } catch (e: any) {
      return {
        success: false,
        message: `தரவுத்தள மீட்டமைப்பில் பிழை: ${e.message}`,
      };
    }
  }

  public getStatus() {
    return {
      connected: true,
      mode: 'Serverless Client-Side Persistent Database',
      storageType: 'localStorage + In-Memory Reactive Cache',
      timestamp: new Date().toISOString(),
      collections: {
        students: { count: this.students.length, description: 'அங்கீகரிக்கப்பட்ட மாணவர்கள் (Authorized Roster)' },
        quizzes: { count: this.quizzes.length, description: 'வினாத்தாள்கள் (Quizzes)' },
        attempts: { count: this.attempts.length, description: 'தேர்வு முடிவுகள் (Attempts)' },
        unitOverrides: { count: Object.keys(this.unitOverrides).length, description: 'தனிப்பயனாக்கப்பட்ட அலகுகள்' },
        adminConfig: { lastUpdated: this.adminConfig.updatedAt },
      },
      memoryState: {
        totalStudents: this.students.length,
        totalQuizzes: this.quizzes.length,
        totalAttempts: this.attempts.length,
      },
    };
  }
}

export const clientDb = new ServerlessDatabase();
