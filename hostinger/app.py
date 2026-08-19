#!/usr/bin/env python3
"""
NMMS Exam & Quiz Platform - Hostinger Python Backend
Compatible with Hostinger hPanel Python App Manager / Passenger WSGI & MySQL (phpMyAdmin)
"""

import os
import sys
import json
import time
import uuid
import re
import base64
from datetime import datetime
from typing import Dict, List, Any, Optional

from flask import Flask, request, jsonify, send_from_directory, make_response
from flask_cors import CORS
import mysql.connector
from mysql.connector import pooling
from dotenv import load_dotenv

# Load Environment Variables from .env file
load_dotenv()

app = Flask(__name__, static_folder='dist', static_url_path='')
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Configuration
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_USER = os.getenv('DB_USER', 'root')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DB_NAME = os.getenv('DB_NAME', 'nmms_quiz_db')
DB_PORT = int(os.getenv('DB_PORT', '3306'))
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
ADMIN_SECURITY_PIN = os.getenv('ADMIN_SECURITY_PIN', '273464')
DEFAULT_ADMIN_PASSWORD = os.getenv('DEFAULT_ADMIN_PASSWORD', 'nmms@2026')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
DATA_DIR = os.path.join(BASE_DIR, '.data')
os.makedirs(DATA_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Database Connection Manager (MySQL with Pool & Graceful Fallback)
# ---------------------------------------------------------------------------
db_pool = None

def get_db_pool():
    global db_pool
    if db_pool is None:
        try:
            db_pool = pooling.MySQLConnectionPool(
                pool_name="nmms_pool",
                pool_size=5,
                pool_reset_session=True,
                host=DB_HOST,
                user=DB_USER,
                password=DB_PASSWORD,
                database=DB_NAME,
                port=DB_PORT,
                charset='utf8mb4',
                collation='utf8mb4_unicode_ci',
                autocommit=True
            )
            print(f"[MySQL] Successfully connected to MySQL pool on {DB_HOST}:{DB_PORT}/{DB_NAME}")
        except Exception as e:
            print(f"[MySQL Warning] Could not connect to MySQL ({e}). Using fallback file storage.")
            db_pool = None
    return db_pool

def get_db_connection():
    pool = get_db_pool()
    if pool:
        try:
            return pool.get_connection()
        except Exception as e:
            print(f"[MySQL Error] Failed to get connection from pool: {e}")
            return None
    return None

# ---------------------------------------------------------------------------
# Subject Configurations & Unit Metadata
# ---------------------------------------------------------------------------
SUBJECT_CONFIGS = {
    'MAT': {'folder': 'matquiz', 'nameTa': 'மனத்திறன் தேர்வு (MAT)', 'nameEn': 'Mental Ability Test', 'prefix': 'unit-mat', 'defaultDuration': 30},
    'SAT_MATHS': {'folder': 'satmaths', 'nameTa': 'SAT கணிதம்', 'nameEn': 'SAT Mathematics', 'prefix': 'unit-satmaths', 'defaultDuration': 30},
    'SAT_SCIENCE': {'folder': 'satscience', 'nameTa': 'SAT அறிவியல்', 'nameEn': 'SAT Science', 'prefix': 'unit-satscience', 'defaultDuration': 30},
    'SAT_SOCIAL': {'folder': 'satsocial', 'nameTa': 'SAT சமூக அறிவியல்', 'nameEn': 'SAT Social Science', 'prefix': 'unit-satsocial', 'defaultDuration': 30}
}

UNIT_TITLES_MAP = {
    'MAT': {
        1: ('எண் தொடர்', 'Number Series'), 2: ('எழுத்துத் தொடர்', 'Letter Series'), 3: ('எண் மற்றும் எழுத்து தொடர்', 'Alpha-Numeric Series'),
        4: ('விடுபட்ட எண்கள் / எழுத்துகள்', 'Missing Characters'), 5: ('ஒப்புமை எண்கள்', 'Number Analogy'), 6: ('ஒப்புமை எழுத்துகள்', 'Letter Analogy'),
        7: ('ஒப்புமை வார்த்தைகள்', 'Word Analogy'), 8: ('பொருந்தாத எண்', 'Odd One Out - Numbers'), 9: ('பொருந்தாத எழுத்து', 'Odd One Out - Letters'),
        10: ('பொருந்தாத வார்த்தை', 'Odd One Out - Words'), 11: ('குறியீட்டு முறை', 'Coding - Decoding'), 12: ('திசை சார்ந்த கணக்குகள்', 'Direction Sense Test'),
        13: ('இரத்த உறவுகள்', 'Blood Relations'), 14: ('கணிதக் குறியீடுகள் மாற்றம்', 'Mathematical Operations'), 15: ('வென் வரைபடங்கள்', 'Venn Diagrams'),
        16: ('பகடை கணக்குகள்', 'Dice & Cubes'), 17: ('கனச்சதுரம் மற்றும் கனச்செவ்வகம்', 'Cubes and Cuboids'), 18: ('வரிசைப்படுத்துதல் / தரம்', 'Ranking Test'),
        19: ('காலவரிசை மற்றும் கடிகாரம்', 'Clock & Calendar'), 20: ('இயற்கணித சமன்பாடுகள் & புதிர்கள்', 'Algebraic Reasoning'), 21: ('வயது கணக்குகள்', 'Problems on Ages'),
        22: ('பகுப்பாய்வு காரணவியல்', 'Analytical Reasoning'), 23: ('உட்கட்டமைப்புகள்', 'Embedded Figures'), 24: ('விடுபட்ட வரைபடம்', 'Pattern Completion'),
        25: ('அடுத்த வரைபடம்', 'Figure Series'), 26: ('ஒப்புமை வரைபடங்கள்', 'Figure Analogy'), 27: ('மாறுபட்ட படம்', 'Figure Classification'),
        28: ('கண்ணாடி பிம்பம்', 'Mirror Images'), 29: ('நீர் பிம்பம்', 'Water Images'), 30: ('காகித மடிப்பு மற்றும் வெட்டுதல்', 'Paper Folding & Cutting'),
        31: ('வடிவங்கள் எண்ணுதல்', 'Counting Figures'), 32: ('வரைபடப் பகுப்பாய்வு (மேட்ரிக்ஸ்)', 'Figure Matrix'), 34: ('தரவு கையாளுதல்', 'Data Interpretation'),
        35: ('வார்த்தை உருவாக்கம்', 'Word Formation'), 36: ('தர்க்கரீதியான வரிசை', 'Logical Sequence of Words')
    },
    'SAT_MATHS': {
        1: ('முழுக்கள்', 'Integers'), 2: ('பின்னங்கள் மற்றும் தசம எண்கள்', 'Fractions and Decimals'), 3: ('தரவுகளைக் கையாளுதல்', 'Data Handling'),
        4: ('எளிய சமன்பாடுகள்', 'Simple Equations'), 5: ('கோடுகளும் கோணங்களும்', 'Lines and Angles'), 6: ('முக்கோணமும் அதன் பண்புகளும்', 'Triangles & Properties'),
        7: ('முக்கோணங்களின் சர்வசமத்தன்மை', 'Congruence of Triangles'), 8: ('விகிதமுறு எண்கள்', 'Rational Numbers'), 9: ('அளவியல்', 'Mensuration'),
        10: ('இயற்கணிதக் கோவைகள்', 'Algebraic Expressions'), 11: ('அடுக்குகளும் அடுக்குக்குறிகளும்', 'Exponents and Powers'), 12: ('சமச்சீர்த் தன்மை', 'Symmetry'),
        13: ('திண்ம வடிவங்கள்', 'Visualising Solid Shapes'), 14: ('நேர் மற்றும் எதிர் விகிதங்கள்', 'Direct & Inverse Proportions'),
        15: ('வாழ்வியல் கணிதம்', 'Commercial Arithmetic'), 16: ('கூட்டு வட்டி', 'Compound Interest'), 17: ('வடிவியல் அமைப்புகள்', 'Practical Geometry'),
        18: ('சதுரம் மற்றும் சதுரமூலம்', 'Squares and Square Roots'), 19: ('கனம் மற்றும் கனமூலம்', 'Cubes and Cube Roots'), 20: ('காரணிகூறுதல்', 'Factorisation'),
        21: ('வரைபடங்கள் அறிமுகம்', 'Introduction to Graphs'), 22: ('உருவங்களின் புறப்பரப்பளவு & கனஅளவு', 'Surface Area and Volume'), 23: ('தகவல் செயலாக்கம்', 'Information Processing')
    },
    'SAT_SCIENCE': {
        1: ('அளவீட்டியல்', 'Measurement'), 2: ('விசையும் இயக்கமும்', 'Force and Motion'), 3: ('நம்மைச் சுற்றியுள்ள பருப்பொருள்கள்', 'Matter Around Us'),
        4: ('அணு அமைப்பு', 'Atomic Structure'), 5: ('தாவரங்களின் இனப்பெருக்கம்', 'Reproduction in Plants'), 6: ('உடல் நலமும் சுகாதாரமும்', 'Health and Hygiene'),
        7: ('பார்வைத் தொடர்பு மற்றும் கணினி', 'Visual Communication & Computers'), 8: ('வெப்பம் மற்றும் வெப்பநிலை', 'Heat and Temperature'),
        9: ('மின்னியல்', 'Electricity'), 10: ('காந்தவியல்', 'Magnetism'), 11: ('ஒலியியல்', 'Acoustics/Sound'), 12: ('ஒளியியல்', 'Optics/Light'),
        13: ('அண்டம் மற்றும் விண்வெளி', 'Universe & Space Science'), 14: ('நீர் மற்றும் காற்று', 'Water and Air'), 15: ('அமிலங்கள் மற்றும் காரங்கள்', 'Acids, Bases & Salts'),
        16: ('தாவர உலகம் மற்றும் விலங்கு உலகம்', 'Living World of Plants & Animals'), 17: ('செல் உயிரியல்', 'Cell Biology'), 18: ('நுண்ணுயிரிகள்', 'Microorganisms'),
        19: ('சுற்றுச்சூழல் மேலாண்மை', 'Environmental Management')
    },
    'SAT_SOCIAL': {
        1: ('வரலாற்று ஆதாரங்கள்', 'Sources of Medieval India'), 2: ('வட இந்திய புதிய அரசுகளின் தோற்றம்', 'Emergence of New Kingdoms in North India'),
        3: ('தென்னிந்திய புதிய அரசுகள்', 'Later Cholas and Pandyas'), 4: ('தில்லி சுல்தானியம்', 'The Delhi Sultanate'),
        5: ('விஜயநகர் மற்றும் பாமினி அரசுகள்', 'Vijayanagar and Bahmani Kingdoms'), 6: ('முகலாயப் பேரரசு', 'Mughal Empire'),
        7: ('மராத்தியர்கள் மற்றும் பேஷ்வாக்களின் எழுச்சி', 'Rise of Marathas and Peshwas'), 8: ('புவி அமைப்பு & புவி தட்டுகள்', 'Interior of the Earth & Rock Cycle'),
        9: ('நிலத்தோற்றங்கள் & ஆறுகள்', 'Landforms & Fluvial Geomorphology'), 10: ('மக்கள் தொகையும் குடியிருப்புகளும்', 'Population and Settlement'),
        11: ('சுற்றுலா', 'Tourism'), 12: ('சமத்துவம் மற்றும் ஜனநாயகம்', 'Equality and Democracy'), 13: ('அரசியல் கட்சிகள்', 'Political Parties'),
        14: ('உற்பத்தி மற்றும் நுகர்வு', 'Production & Economics'), 15: ('வரி மற்றும் அதன் முக்கியத்துவம்', 'Taxation and its Importance')
    }
}

# ---------------------------------------------------------------------------
# Helper: Load JSON File
# ---------------------------------------------------------------------------
def load_json_file(file_path: str, default=None):
    if os.path.exists(file_path):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading JSON from {file_path}: {e}")
    return default

def save_json_file(file_path: str, data: Any):
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Error saving JSON to {file_path}: {e}")
        return False

# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.route('/api/health', methods=['GET'])
def health_check():
    conn = get_db_connection()
    db_status = "connected" if conn else "fallback_file_mode"
    if conn:
        conn.close()
    return jsonify({
        "status": "ok",
        "service": "NMMS Quiz Platform Python Backend",
        "database": db_status,
        "timestamp": datetime.now().isoformat()
    })

# 1. Quizzes CRUD
@app.route('/api/quizzes', methods=['GET', 'POST'])
def handle_quizzes():
    conn = get_db_connection()
    if request.method == 'POST':
        data = request.json or {}
        quiz_id = data.get('id') or f"quiz_{int(time.time()*1000)}"
        title = data.get('title', 'Untitled Quiz')
        description = data.get('description', '')
        duration = int(data.get('durationMinutes', 30))
        total_marks = int(data.get('totalMarks', 20))
        pass_pct = int(data.get('passPercentage', 40))
        shuffle_q = 1 if data.get('shuffleQuestions', True) else 0
        shuffle_opt = 1 if data.get('shuffleOptions', True) else 0
        enable_limit = 1 if data.get('enableQuestionLimit', False) else 0
        limit_count = data.get('questionsPerAttempt')
        anti_cheat = 1 if data.get('enableAntiCheat', True) else 0
        status = data.get('status', 'active')
        questions = data.get('questions', [])
        questions_json = json.dumps(questions, ensure_ascii=False)

        if conn:
            try:
                cursor = conn.cursor()
                query = """
                    INSERT INTO quizzes (
                        id, title, description, duration_minutes, total_marks, pass_percentage,
                        shuffle_questions, shuffle_options, enable_question_limit, questions_per_attempt,
                        enable_anti_cheat, status, questions_json
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        title=VALUES(title), description=VALUES(description), duration_minutes=VALUES(duration_minutes),
                        total_marks=VALUES(total_marks), pass_percentage=VALUES(pass_percentage),
                        shuffle_questions=VALUES(shuffle_questions), shuffle_options=VALUES(shuffle_options),
                        enable_question_limit=VALUES(enable_question_limit), questions_per_attempt=VALUES(questions_per_attempt),
                        enable_anti_cheat=VALUES(enable_anti_cheat), status=VALUES(status), questions_json=VALUES(questions_json)
                """
                cursor.execute(query, (
                    quiz_id, title, description, duration, total_marks, pass_pct,
                    shuffle_q, shuffle_opt, enable_limit, limit_count, anti_cheat, status, questions_json
                ))
                cursor.close()
                conn.close()
            except Exception as e:
                print(f"[MySQL Save Error] {e}")
                if conn: conn.close()

        # Always save to local data JSON as backup
        quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
        stored_quizzes = load_json_file(quizzes_file, [])
        updated = False
        payload_obj = {
            "id": quiz_id, "title": title, "description": description,
            "durationMinutes": duration, "totalMarks": total_marks, "passPercentage": pass_pct,
            "shuffleQuestions": bool(shuffle_q), "shuffleOptions": bool(shuffle_opt),
            "enableQuestionLimit": bool(enable_limit), "questionsPerAttempt": limit_count,
            "enableAntiCheat": bool(anti_cheat), "showResultsImmediately": True,
            "allowReview": True, "status": status, "questions": questions
        }
        for i, q in enumerate(stored_quizzes):
            if q.get('id') == quiz_id:
                stored_quizzes[i] = payload_obj
                updated = True
                break
        if not updated:
            stored_quizzes.insert(0, payload_obj)
        save_json_file(quizzes_file, stored_quizzes)

        return jsonify({"success": True, "id": quiz_id, "message": "Quiz saved successfully"})

    # GET Quizzes
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id, title, description, duration_minutes, total_marks, pass_percentage, status, questions_json FROM quizzes ORDER BY created_at DESC")
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            quizzes_list = []
            for r in rows:
                qs = json.loads(r.get('questions_json') or '[]')
                quizzes_list.append({
                    "id": r['id'],
                    "title": r['title'],
                    "description": r['description'] or '',
                    "durationMinutes": r['duration_minutes'],
                    "totalMarks": r['total_marks'],
                    "passPercentage": r['pass_percentage'],
                    "questionCount": len(qs),
                    "questions": qs,
                    "status": r['status']
                })
            if quizzes_list:
                return jsonify(quizzes_list)
        except Exception as e:
            print(f"[MySQL Read Error] {e}")
            if conn: conn.close()

    # Fallback to local files
    quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
    local_quizzes = load_json_file(quizzes_file, [])
    return jsonify(local_quizzes)

@app.route('/api/quizzes/<quiz_id>', methods=['GET', 'DELETE'])
def handle_single_quiz(quiz_id: str):
    conn = get_db_connection()
    if request.method == 'DELETE':
        if conn:
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM quizzes WHERE id = %s", (quiz_id,))
                cursor.execute("DELETE FROM student_attempts WHERE quiz_id = %s", (quiz_id,))
                cursor.close()
                conn.close()
            except Exception as e:
                print(f"[MySQL Delete Error] {e}")
                if conn: conn.close()

        quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
        stored = load_json_file(quizzes_file, [])
        stored = [q for q in stored if q.get('id') != quiz_id]
        save_json_file(quizzes_file, stored)
        return jsonify({"success": True, "message": "Quiz deleted successfully"})

    # GET Single Quiz
    is_student = request.args.get('role') == 'student'
    quiz_data = None

    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM quizzes WHERE id = %s", (quiz_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if row:
                qs = json.loads(row.get('questions_json') or '[]')
                quiz_data = {
                    "id": row['id'],
                    "title": row['title'],
                    "description": row['description'] or '',
                    "durationMinutes": row['duration_minutes'],
                    "totalMarks": row['total_marks'],
                    "passPercentage": row['pass_percentage'],
                    "shuffleQuestions": bool(row['shuffle_questions']),
                    "shuffleOptions": bool(row['shuffle_options']),
                    "enableQuestionLimit": bool(row['enable_question_limit']),
                    "questionsPerAttempt": row['questions_per_attempt'],
                    "enableAntiCheat": bool(row['enable_anti_cheat']),
                    "questions": qs,
                    "status": row['status']
                }
        except Exception as e:
            print(f"[MySQL Error] {e}")
            if conn: conn.close()

    if not quiz_data:
        quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
        stored = load_json_file(quizzes_file, [])
        for q in stored:
            if q.get('id') == quiz_id:
                quiz_data = q
                break

    if not quiz_data:
        return jsonify({"error": "Quiz not found"}), 404

    # If student role, mask answers
    if is_student:
        safe_quiz = dict(quiz_data)
        safe_questions = []
        for q in quiz_data.get('questions', []):
            safe_q = dict(q)
            safe_q['correctOption'] = None
            safe_q['explanation'] = None
            safe_q['explanation_en'] = None
            safe_questions.append(safe_q)
        safe_quiz['questions'] = safe_questions
        return jsonify(safe_quiz)

    return jsonify(quiz_data)

# 2. Exam Submission & Grading Engine
@app.route('/api/quizzes/<quiz_id>/submit', methods=['POST'])
def submit_exam(quiz_id: str):
    data = request.json or {}
    student_name = data.get('studentName', 'மாணவர்')
    exam_number = data.get('examNumber', '').strip().upper()
    client_answers = data.get('answers', {})
    question_status = data.get('questionStatus', {})
    time_taken = int(data.get('timeTakenSeconds', 0))
    tab_switches = int(data.get('tabSwitchCount', 0))
    client_questions = data.get('clientQuestions', [])

    # Fetch official questions
    official_questions = []
    quiz_title = "NMMS மாதிரித் தேர்வு"
    pass_pct = 40

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT title, pass_percentage, questions_json FROM quizzes WHERE id = %s", (quiz_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if row:
                quiz_title = row['title']
                pass_pct = row['pass_percentage']
                official_questions = json.loads(row.get('questions_json') or '[]')
        except Exception as e:
            print(f"[MySQL Quiz Fetch] {e}")
            if conn: conn.close()

    if not official_questions:
        quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
        stored = load_json_file(quizzes_file, [])
        for q in stored:
            if q.get('id') == quiz_id:
                quiz_title = q.get('title', quiz_title)
                pass_pct = q.get('passPercentage', pass_pct)
                official_questions = q.get('questions', [])
                break

    # Fallback to client questions if necessary
    eval_questions = official_questions if official_questions else client_questions

    # Grade the exam
    total_obtained = 0
    total_possible = 0
    correct_count = 0
    incorrect_count = 0
    unattempted_count = 0

    breakdown = {
        "MAT": {"obtained": 0, "possible": 0, "correctCount": 0, "totalQuestions": 0},
        "SAT_MATHS": {"obtained": 0, "possible": 0, "correctCount": 0, "totalQuestions": 0},
        "SAT_SCIENCE": {"obtained": 0, "possible": 0, "correctCount": 0, "totalQuestions": 0},
        "SAT_SOCIAL": {"obtained": 0, "possible": 0, "correctCount": 0, "totalQuestions": 0}
    }

    for q in eval_questions:
        q_id = q.get('id')
        marks = q.get('marks', 1)
        neg_marks = q.get('negativeMarks', 0)
        subj = q.get('subject', 'MAT')
        if subj not in breakdown:
            subj = 'MAT'

        total_possible += marks
        breakdown[subj]["possible"] += marks
        breakdown[subj]["totalQuestions"] += 1

        chosen = client_answers.get(q_id)
        correct = q.get('correctOption')

        if not chosen:
            unattempted_count += 1
        elif chosen == correct:
            total_obtained += marks
            correct_count += 1
            breakdown[subj]["obtained"] += marks
            breakdown[subj]["correctCount"] += 1
        else:
            total_obtained = max(0, total_obtained - neg_marks)
            incorrect_count += 1

    percentage = round((total_obtained / total_possible * 100), 1) if total_possible > 0 else 0
    is_eligible = percentage >= pass_pct

    score_result = {
        "totalObtained": total_obtained,
        "totalPossible": total_possible,
        "percentage": percentage,
        "isEligible": is_eligible,
        "correctCount": correct_count,
        "incorrectCount": incorrect_count,
        "unattemptedCount": unattempted_count,
        "subjectBreakdown": breakdown
    }

    attempt_id = f"att_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
    now_iso = datetime.now().isoformat()

    attempt_obj = {
        "id": attempt_id,
        "quizId": quiz_id,
        "quizTitle": quiz_title,
        "studentName": student_name,
        "examNumber": exam_number,
        "startedAt": now_iso,
        "submittedAt": now_iso,
        "timeTakenSeconds": time_taken,
        "tabSwitchCount": tab_switches,
        "answers": client_answers,
        "questionStatus": question_status,
        "score": score_result
    }

    # Save to MySQL
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            query = """
                INSERT INTO student_attempts (
                    id, quiz_id, quiz_title, student_name, exam_number, started_at,
                    submitted_at, time_taken_seconds, tab_switch_count, answers_json,
                    question_status_json, score_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(query, (
                attempt_id, quiz_id, quiz_title, student_name, exam_number,
                now_iso, now_iso, time_taken, tab_switches,
                json.dumps(client_answers), json.dumps(question_status), json.dumps(score_result)
            ))
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"[MySQL Attempt Save Error] {e}")
            if conn: conn.close()

    # Save to local file
    attempts_file = os.path.join(DATA_DIR, 'attempts.json')
    stored_attempts = load_json_file(attempts_file, [])
    stored_attempts.insert(0, attempt_obj)
    save_json_file(attempts_file, stored_attempts)

    return jsonify({
        "success": True,
        "attempt": attempt_obj,
        "quizDetails": {
            "id": quiz_id,
            "title": quiz_title,
            "questions": eval_questions
        }
    })

# 3. Quiz Analytics & Attempts
@app.route('/api/quizzes/<quiz_id>/analytics', methods=['GET'])
def get_quiz_analytics(quiz_id: str):
    attempts = []
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM student_attempts WHERE quiz_id = %s ORDER BY created_at DESC", (quiz_id,))
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            for r in rows:
                attempts.append({
                    "id": r['id'],
                    "quizId": r['quiz_id'],
                    "quizTitle": r['quiz_title'],
                    "studentName": r['student_name'],
                    "examNumber": r['exam_number'],
                    "startedAt": r['started_at'],
                    "submittedAt": r['submitted_at'],
                    "timeTakenSeconds": r['time_taken_seconds'],
                    "tabSwitchCount": r['tab_switch_count'],
                    "answers": json.loads(r['answers_json'] or '{}'),
                    "questionStatus": json.loads(r['question_status_json'] or '{}'),
                    "score": json.loads(r['score_json'] or '{}')
                })
        except Exception as e:
            print(f"[MySQL Analytics Read Error] {e}")
            if conn: conn.close()

    if not attempts:
        attempts_file = os.path.join(DATA_DIR, 'attempts.json')
        all_attempts = load_json_file(attempts_file, [])
        attempts = [a for a in all_attempts if a.get('quizId') == quiz_id]

    total_attempts = len(attempts)
    if total_attempts == 0:
        return jsonify({
            "totalAttempts": 0, "averageScore": 0, "highestScore": 0,
            "passRate": 0, "averageTimeMinutes": 0, "tabSwitchRate": 0,
            "recentAttempts": []
        })

    scores = [a['score'].get('totalObtained', 0) for a in attempts]
    percentages = [a['score'].get('percentage', 0) for a in attempts]
    times = [a.get('timeTakenSeconds', 0) for a in attempts]
    tab_switches = [a.get('tabSwitchCount', 0) for a in attempts]
    passes = [1 for a in attempts if a['score'].get('isEligible', False)]

    return jsonify({
        "totalAttempts": total_attempts,
        "averageScore": round(sum(scores) / total_attempts, 1),
        "highestScore": max(scores),
        "passRate": round(len(passes) / total_attempts * 100, 1),
        "averageTimeMinutes": round((sum(times) / total_attempts) / 60, 1),
        "tabSwitchRate": round(sum(tab_switches) / total_attempts, 1),
        "recentAttempts": attempts[:50]
    })

@app.route('/api/attempts/<attempt_id>', methods=['DELETE'])
def delete_attempt(attempt_id: str):
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM student_attempts WHERE id = %s", (attempt_id,))
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"[MySQL Delete Attempt Error] {e}")
            if conn: conn.close()

    attempts_file = os.path.join(DATA_DIR, 'attempts.json')
    stored = load_json_file(attempts_file, [])
    stored = [a for a in stored if a.get('id') != attempt_id]
    save_json_file(attempts_file, stored)
    return jsonify({"success": True, "message": "Attempt deleted"})

# 4. Student Roster & Verification
@app.route('/api/students/roster', methods=['GET'])
def get_students_roster():
    students = []
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT exam_number, student_name FROM students ORDER BY exam_number ASC")
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            for r in rows:
                students.append({
                    "examNumber": r['exam_number'],
                    "studentName": r['student_name']
                })
        except Exception as e:
            print(f"[MySQL Students Read Error] {e}")
            if conn: conn.close()

    if not students:
        # Default student bank
        for i in range(8001, 8041):
            students.append({"examNumber": str(i), "studentName": f"மாணவர் {i}"})

    return jsonify({"students": students})

@app.route('/api/students/verify', methods=['GET'])
def verify_student():
    exam_number = request.args.get('examNumber', '').strip().upper()
    quiz_id = request.args.get('quizId', '')

    if not exam_number:
        return jsonify({"authorized": False, "error": "Exam number is required"}), 400

    student_name = None
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT student_name FROM students WHERE exam_number = %s", (exam_number,))
            row = cursor.fetchone()
            cursor.close()
            if row:
                student_name = row['student_name']
        except Exception as e:
            print(f"[MySQL Verify Error] {e}")
        if conn: conn.close()

    # Check local fallback range 8001-8040 if not found
    if not student_name:
        if exam_number.isdigit() and 8001 <= int(exam_number) <= 8040:
            student_name = f"மாணவர் ({exam_number})"

    if not student_name:
        return jsonify({
            "authorized": False,
            "error": "அங்கீகரிக்கப்படாத தேர்வு எண்! பதிவு செய்யப்பட்ட NMMS மாணவர்கள் மட்டுமே தேர்வெழுத அனுமதிக்கப்படுவர்."
        })

    # Fetch student attempts
    attempts_file = os.path.join(DATA_DIR, 'attempts.json')
    all_attempts = load_json_file(attempts_file, [])
    student_attempts = [a for a in all_attempts if a.get('examNumber', '').upper() == exam_number]

    return jsonify({
        "authorized": True,
        "student": {"examNumber": exam_number, "studentName": student_name},
        "allAttempts": student_attempts,
        "latestAttempt": student_attempts[0] if student_attempts else None
    })

@app.route('/api/students', methods=['POST'])
def add_student():
    data = request.json or {}
    exam_number = data.get('examNumber', '').strip().upper()
    student_name = data.get('studentName', '').strip()
    pin = data.get('pin', '').strip()

    if pin != ADMIN_SECURITY_PIN:
        return jsonify({"success": False, "error": "தவறான ஆசிரியர் பாதுகாப்பு PIN எண்!"}), 403

    if not exam_number or not student_name:
        return jsonify({"success": False, "error": "தேர்வு எண் மற்றும் பெயர் தேவை"}), 400

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO students (exam_number, student_name) VALUES (%s, %s) ON DUPLICATE KEY UPDATE student_name=%s",
                           (exam_number, student_name, student_name))
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"[MySQL Add Student Error] {e}")
            if conn: conn.close()

    return jsonify({"success": True, "message": f"மாணவர் ({student_name}) வெற்றிகரமாக சேர்க்கப்பட்டார்!"})

@app.route('/api/students/<exam_number>', methods=['DELETE'])
def remove_student(exam_number: str):
    data = request.json or {}
    pin = data.get('pin', '').strip()

    if pin != ADMIN_SECURITY_PIN:
        return jsonify({"success": False, "error": "தவறான ஆசிரியர் பாதுகாப்பு PIN எண்!"}), 403

    clean_no = exam_number.strip().upper()
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM students WHERE exam_number = %s", (clean_no,))
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"[MySQL Remove Student Error] {e}")
            if conn: conn.close()

    return jsonify({"success": True, "message": "மாணவர் வெற்றிகரமாக நீக்கப்பட்டார்!"})

# 5. Teacher / Admin Authentication
@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.json or {}
    pwd = data.get('password', '').strip()

    saved_pwd = DEFAULT_ADMIN_PASSWORD
    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT admin_password FROM admin_credentials WHERE id = 1")
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if row and row.get('admin_password'):
                saved_pwd = row['admin_password']
        except Exception as e:
            print(f"[MySQL Admin Login Read Error] {e}")
            if conn: conn.close()

    if pwd == saved_pwd or pwd == DEFAULT_ADMIN_PASSWORD:
        return jsonify({"authenticated": True, "message": "Login successful"})
    return jsonify({"authenticated": False, "error": "தவறான கடவுச்சொல்! (Invalid Password)"}), 401

@app.route('/api/admin/forgot-password/verify-pin', methods=['POST'])
def verify_admin_pin():
    data = request.json or {}
    pin = data.get('pin', '').strip()
    if pin == ADMIN_SECURITY_PIN:
        token = f"reset_{uuid.uuid4().hex}"
        return jsonify({"success": True, "resetToken": token})
    return jsonify({"success": False, "error": "தவறான பாதுகாப்பு PIN எண்! தயவுசெய்து 273464 உள்ளிடவும்."}), 403

@app.route('/api/admin/forgot-password/reset-password', methods=['POST'])
def reset_admin_password():
    data = request.json or {}
    token = data.get('resetToken', '')
    new_pwd = data.get('newPassword', '').strip()

    if not token.startswith('reset_') or len(new_pwd) < 4:
        return jsonify({"success": False, "error": "செல்லுபடியாகாத கோரிக்கை அல்லது கடவுச்சொல் மிகவும் சிறியது."}), 400

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            cursor.execute("UPDATE admin_credentials SET admin_password = %s WHERE id = 1", (new_pwd,))
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"[MySQL Reset Password Error] {e}")
            if conn: conn.close()

    return jsonify({"success": True, "message": "கடவுச்சொல் வெற்றிகரமாக மாற்றப்பட்டது!"})

# 6. Subject Units Management
@app.route('/api/subject-units', methods=['GET'])
def get_subject_units():
    subject = request.args.get('subject', 'MAT')
    config = SUBJECT_CONFIGS.get(subject, SUBJECT_CONFIGS['MAT'])
    folder = config['folder']
    folder_path = os.path.join(ASSETS_DIR, folder, 'data')
    os.makedirs(folder_path, exist_ok=True)

    titles_dict = UNIT_TITLES_MAP.get(subject, {})
    units = []

    for unit_num, (ta_title, en_title) in titles_dict.items():
        file_path = os.path.join(folder_path, f"unit{unit_num}.json")
        q_count = 0
        if os.path.exists(file_path):
            qs = load_json_file(file_path, [])
            q_count = len(qs)

        units.append({
            "subject": subject,
            "unitNumber": unit_num,
            "titleTa": ta_title,
            "titleEn": en_title,
            "questionCount": q_count,
            "durationMinutes": config['defaultDuration'],
            "isCustomized": False
        })

    return jsonify({"units": units})

@app.route('/api/subject-units/<subject>/<int:unit_num>', methods=['GET'])
def get_unit_questions(subject: str, unit_num: int):
    config = SUBJECT_CONFIGS.get(subject, SUBJECT_CONFIGS['MAT'])
    folder = config['folder']
    file_path = os.path.join(ASSETS_DIR, folder, 'data', f"unit{unit_num}.json")
    questions = load_json_file(file_path, [])
    return jsonify({"questions": questions})

@app.route('/api/subject-units/<subject>/<int:unit_num>/questions', methods=['POST'])
def add_unit_question(subject: str, unit_num: int):
    config = SUBJECT_CONFIGS.get(subject, SUBJECT_CONFIGS['MAT'])
    file_path = os.path.join(ASSETS_DIR, config['folder'], 'data', f"unit{unit_num}.json")
    questions = load_json_file(file_path, [])
    new_q = request.json or {}
    if not new_q.get('id'):
        new_q['id'] = f"{config['prefix']}-{unit_num}-q{len(questions)+1}_{int(time.time())}"
    questions.append(new_q)
    save_json_file(file_path, questions)
    return jsonify({"success": True, "question": new_q})

@app.route('/api/subject-units/<subject>/<int:unit_num>/questions/<q_id>', methods=['PUT', 'DELETE'])
def update_delete_unit_question(subject: str, unit_num: int, q_id: str):
    config = SUBJECT_CONFIGS.get(subject, SUBJECT_CONFIGS['MAT'])
    file_path = os.path.join(ASSETS_DIR, config['folder'], 'data', f"unit{unit_num}.json")
    questions = load_json_file(file_path, [])

    if request.method == 'DELETE':
        questions = [q for q in questions if q.get('id') != q_id]
        save_json_file(file_path, questions)
        return jsonify({"success": True, "message": "Question deleted"})

    # PUT
    updated_q = request.json or {}
    for i, q in enumerate(questions):
        if q.get('id') == q_id:
            questions[i] = updated_q
            break
    save_json_file(file_path, questions)
    return jsonify({"success": True, "question": updated_q})

@app.route('/api/subject-units/deploy', methods=['POST'])
def deploy_unit():
    data = request.json or {}
    subject = data.get('subject', 'MAT')
    unit_num = int(data.get('unitNum', 1))
    duration = int(data.get('durationMinutes', 30))
    pass_pct = int(data.get('passPercentage', 40))

    config = SUBJECT_CONFIGS.get(subject, SUBJECT_CONFIGS['MAT'])
    file_path = os.path.join(ASSETS_DIR, config['folder'], 'data', f"unit{unit_num}.json")
    questions = load_json_file(file_path, [])

    titles = UNIT_TITLES_MAP.get(subject, {}).get(unit_num, (f"அலகு {unit_num}", f"Unit {unit_num}"))
    quiz_id = f"{config['prefix']}-{unit_num}"
    title = f"{config['nameTa']} - அலகு {unit_num}: {titles[0]}"

    quiz_obj = {
        "id": quiz_id,
        "title": title,
        "description": f"{config['nameEn']} - Unit {unit_num}: {titles[1]}",
        "durationMinutes": duration,
        "totalMarks": len(questions),
        "passPercentage": pass_pct,
        "shuffleQuestions": data.get('shuffleQuestions', True),
        "shuffleOptions": data.get('shuffleOptions', True),
        "enableQuestionLimit": data.get('enableQuestionLimit', False),
        "questionsPerAttempt": data.get('questionsPerAttempt'),
        "enableAntiCheat": data.get('enableAntiCheat', True),
        "showResultsImmediately": True,
        "allowReview": True,
        "status": "active",
        "questions": questions
    }

    # Save to local quizzes & MySQL
    quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
    stored = load_json_file(quizzes_file, [])
    stored = [q for q in stored if q.get('id') != quiz_id]
    stored.insert(0, quiz_obj)
    save_json_file(quizzes_file, stored)

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            query = """
                INSERT INTO quizzes (id, title, description, duration_minutes, total_marks, pass_percentage, status, questions_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE title=VALUES(title), questions_json=VALUES(questions_json)
            """
            cursor.execute(query, (quiz_id, title, quiz_obj['description'], duration, len(questions), pass_pct, 'active', json.dumps(questions)))
            cursor.close()
            conn.close()
        except Exception as e:
            print(f"[MySQL Deploy Unit Error] {e}")
            if conn: conn.close()

    return jsonify({"success": True, "id": quiz_id, "message": f"{title} வெளியிடப்பட்டது!"})

@app.route('/api/subject-units/deploy-all', methods=['POST'])
def deploy_all_units():
    data = request.json or {}
    subject = data.get('subject', 'MAT')
    config = SUBJECT_CONFIGS.get(subject, SUBJECT_CONFIGS['MAT'])
    titles_dict = UNIT_TITLES_MAP.get(subject, {})
    folder_path = os.path.join(ASSETS_DIR, config['folder'], 'data')

    deployed_count = 0
    quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
    stored = load_json_file(quizzes_file, [])

    for unit_num, (ta_title, en_title) in titles_dict.items():
        file_path = os.path.join(folder_path, f"unit{unit_num}.json")
        if os.path.exists(file_path):
            questions = load_json_file(file_path, [])
            if questions:
                quiz_id = f"{config['prefix']}-{unit_num}"
                title = f"{config['nameTa']} - அலகு {unit_num}: {ta_title}"
                quiz_obj = {
                    "id": quiz_id, "title": title, "description": f"{config['nameEn']} - Unit {unit_num}: {en_title}",
                    "durationMinutes": 30, "totalMarks": len(questions), "passPercentage": 40,
                    "shuffleQuestions": True, "shuffleOptions": True, "enableAntiCheat": True,
                    "showResultsImmediately": True, "allowReview": True, "status": "active", "questions": questions
                }
                stored = [q for q in stored if q.get('id') != quiz_id]
                stored.insert(0, quiz_obj)
                deployed_count += 1

    save_json_file(quizzes_file, stored)
    return jsonify({"success": True, "message": f"{config['nameTa']} பாடத்தின் {deployed_count} அலகுகள் மாதிரித் தேர்வுகளாக வெளியிடப்பட்டன!"})

# 7. Previous Year Question Papers (PYQ)
@app.route('/api/pyq/papers', methods=['GET'])
def get_pyq_papers():
    pyq_dir = os.path.join(ASSETS_DIR, 'pyq', 'data')
    os.makedirs(pyq_dir, exist_ok=True)
    papers = []
    if os.path.exists(pyq_dir):
        for f in os.listdir(pyq_dir):
            if f.endswith('.json'):
                p_data = load_json_file(os.path.join(pyq_dir, f))
                if p_data:
                    papers.append({
                        "id": p_data.get('id', f.replace('.json', '')),
                        "title": p_data.get('title', 'NMMS Previous Year Paper'),
                        "year": p_data.get('year', 2024),
                        "type": p_data.get('type', 'FULL_MOCK'),
                        "durationMinutes": p_data.get('durationMinutes', 90),
                        "totalMarks": p_data.get('totalMarks', 90),
                        "questionCount": len(p_data.get('questions', [])),
                        "description": p_data.get('description', '')
                    })
    papers.sort(key=lambda x: x.get('year', 0), reverse=True)
    return jsonify({"papers": papers})

@app.route('/api/pyq/papers/<paper_id>', methods=['GET'])
def get_single_pyq_paper(paper_id: str):
    pyq_dir = os.path.join(ASSETS_DIR, 'pyq', 'data')
    file_path = os.path.join(pyq_dir, f"{paper_id}.json")
    paper_data = load_json_file(file_path)
    if not paper_data:
        # Search by ID inside files
        for f in os.listdir(pyq_dir):
            if f.endswith('.json'):
                p = load_json_file(os.path.join(pyq_dir, f))
                if p and p.get('id') == paper_id:
                    paper_data = p
                    break
    if not paper_data:
        return jsonify({"error": "PYQ Paper not found"}), 404
    return jsonify(paper_data)

@app.route('/api/pyq/deploy', methods=['POST'])
def deploy_pyq_paper():
    data = request.json or {}
    paper_id = data.get('paperId')
    pyq_dir = os.path.join(ASSETS_DIR, 'pyq', 'data')
    paper_data = load_json_file(os.path.join(pyq_dir, f"{paper_id}.json"))

    if not paper_data:
        return jsonify({"error": "Paper not found"}), 404

    quiz_obj = dict(paper_data)
    quiz_obj['durationMinutes'] = int(data.get('durationMinutes', paper_data.get('durationMinutes', 90)))
    quiz_obj['passPercentage'] = int(data.get('passPercentage', 40))
    quiz_obj['shuffleQuestions'] = data.get('shuffleQuestions', True)
    quiz_obj['shuffleOptions'] = data.get('shuffleOptions', True)
    quiz_obj['enableQuestionLimit'] = data.get('enableQuestionLimit', False)
    quiz_obj['questionsPerAttempt'] = data.get('questionsPerAttempt')
    quiz_obj['enableAntiCheat'] = data.get('enableAntiCheat', True)
    quiz_obj['status'] = 'active'

    quizzes_file = os.path.join(DATA_DIR, 'quizzes.json')
    stored = load_json_file(quizzes_file, [])
    stored = [q for q in stored if q.get('id') != paper_id]
    stored.insert(0, quiz_obj)
    save_json_file(quizzes_file, stored)

    return jsonify({"success": True, "id": paper_id, "message": f"{quiz_obj.get('title')} வெளியிடப்பட்டது!"})

# ---------------------------------------------------------------------------
# 8. Gemini AI Integration (multimodal question extraction & generation)
# ---------------------------------------------------------------------------
@app.route('/api/ai/parse-questions', methods=['POST'])
def ai_parse_questions():
    api_key = os.getenv('GEMINI_API_KEY', GEMINI_API_KEY)
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY is not configured in server environment (.env)"}), 500

    data = request.json or {}
    raw_text = data.get('text', '')
    images = data.get('images', [])  # list of base64 data URLs
    subject = data.get('subject', 'MAT')

    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)

        prompt = f"""
You are an expert Tamil Nadu NMMS (National Means-cum-Merit Scholarship) exam question extractor.
Extract all multiple choice questions from the provided text/images into clean bilingual Tamil & English JSON.

Subject Context: {subject}

Return ONLY valid JSON matching this schema:
{{
  "questions": [
    {{
      "questionText": "வினா தமிழ் உரை",
      "question_en": "Question English text",
      "subject": "{subject}",
      "topic": "Topic Name",
      "options": [
        {{"id": "A", "text": "விருப்பம் A தமிழ்"}},
        {{"id": "B", "text": "விருப்பம் B தமிழ்"}},
        {{"id": "C", "text": "விருப்பம் C தமிழ்"}},
        {{"id": "D", "text": "விருப்பம் D தமிழ்"}}
      ],
      "options_en": ["Option A Eng", "Option B Eng", "Option C Eng", "Option D Eng"],
      "correctOption": "A",
      "explanation": "தமிழ் விளக்கம்",
      "explanation_en": "English explanation",
      "marks": 1,
      "negativeMarks": 0
    }}
  ]
}}
"""
        contents = [prompt]
        if raw_text:
            contents.append(f"Input Question Paper Text:\n{raw_text}")

        for img_data in images[:5]:
            if isinstance(img_data, str) and ',' in img_data:
                header, b64 = img_data.split(',', 1)
                mime = header.split(';')[0].replace('data:', '')
                img_bytes = base64.b64decode(b64)
                contents.append(types.Part.from_bytes(data=img_bytes, mime_type=mime))

        # Primary model with fallback
        models = ['gemini-2.5-flash', 'gemini-2.5-pro']
        response_text = ""
        for model_name in models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(response_mime_type="application/json")
                )
                response_text = response.text
                if response_text:
                    break
            except Exception as model_err:
                print(f"Model {model_name} failed: {model_err}")

        if not response_text:
            return jsonify({"error": "Failed to extract questions with AI model"}), 500

        parsed = json.loads(response_text)
        return jsonify(parsed)

    except Exception as e:
        print(f"AI Parse Error: {e}")
        return jsonify({"error": f"AI Parsing failed: {str(e)}"}), 500

@app.route('/api/ai/generate-questions', methods=['POST'])
def ai_generate_questions():
    api_key = os.getenv('GEMINI_API_KEY', GEMINI_API_KEY)
    if not api_key:
        return jsonify({"error": "GEMINI_API_KEY is not configured in server environment"}), 500

    data = request.json or {}
    subject = data.get('subject', 'MAT')
    topic = data.get('topic', 'Number Series')
    count = min(25, max(1, int(data.get('count', 5))))
    difficulty = data.get('difficulty', 'medium')

    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)

        prompt = f"""
Generate {count} high-quality NMMS Exam (8th Standard Tamil Nadu syllabus) Multiple Choice Questions.
Subject: {subject}
Topic: {topic}
Difficulty: {difficulty}

Each question must be bilingual with Tamil as primary and English as secondary.
Return JSON with 'questions' array.
"""
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt],
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        parsed = json.loads(response.text)
        return jsonify(parsed)
    except Exception as e:
        return jsonify({"error": f"AI Generation failed: {str(e)}"}), 500

# ---------------------------------------------------------------------------
# Frontend Static Asset Serving & SPA Fallback
# ---------------------------------------------------------------------------
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    dist_dir = os.path.join(BASE_DIR, 'dist')
    if path != "" and os.path.exists(os.path.join(dist_dir, path)):
        return send_from_directory(dist_dir, path)
    
    # Also check if it's an asset file directly in assets/
    if path.startswith('assets/') and os.path.exists(os.path.join(BASE_DIR, path)):
        return send_from_directory(BASE_DIR, path)

    if os.path.exists(os.path.join(dist_dir, 'index.html')):
        return send_from_directory(dist_dir, 'index.html')
    
    return jsonify({
        "status": "NMMS Platform Backend Active",
        "message": "Upload the built React frontend files (dist/) to the root directory to preview the full user interface."
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
