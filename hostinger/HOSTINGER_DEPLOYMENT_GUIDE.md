# 🚀 Hostinger Deployment Guide for NMMS Quiz Platform
## Hostinger hPanel + phpMyAdmin (MySQL) + Python Backend Setup

This document provides a step-by-step guide to hosting this application on **Hostinger Web Hosting / Cloud Hosting** using **hPanel**, **phpMyAdmin (MySQL)**, and **Python (WSGI / Flask)**.

---

## 📋 Overview of Files in the `hostinger/` Package

| File | Purpose |
|---|---|
| `hostinger/schema.sql` | Complete MySQL database structure & default data to import in **phpMyAdmin** |
| `hostinger/app.py` | Full Python (Flask) backend handling all `/api/*` endpoints, grading, AI & MySQL |
| `hostinger/passenger_wsgi.py` | Hostinger Python App Manager entry point |
| `hostinger/requirements.txt` | Python dependencies (Flask, mysql-connector-python, google-genai, etc.) |
| `hostinger/.htaccess` | Apache/LiteSpeed routing for React SPA frontend + Python WSGI backend |
| `hostinger/.env.example` | Template for MySQL credentials and Gemini API Key |

---

## 🛠️ Step 1: Create MySQL Database in Hostinger hPanel

1. Log into your **Hostinger hPanel** (`https://hpanel.hostinger.com`).
2. Navigate to **Databases** ➔ **MySQL Databases**.
3. Under **Create a New MySQL Database and User**:
   - **Database name:** Enter a name (e.g., `nmms_db` ➔ full name will be `u123456789_nmms_db`).
   - **Username:** Enter a username (e.g., `nmms_user` ➔ full name `u123456789_nmms_user`).
   - **Password:** Generate or create a strong password (e.g., `SecurePass@2026!`).
4. Click **Create**.
5. Note down:
   - **Database Name:** `u123456789_nmms_db`
   - **Database Username:** `u123456789_nmms_user`
   - **Database Password:** `YourStrongPassword`
   - **Database Host:** `localhost`

---

## 🗄️ Step 2: Import Database Tables via phpMyAdmin

1. In hPanel, under **Databases** ➔ **MySQL Databases**, find your newly created database.
2. Click the **Enter phpMyAdmin** button next to your database.
3. In phpMyAdmin, click on your database name on the left sidebar.
4. Click on the **Import** tab at the top.
5. Click **Choose File** and select `hostinger/schema.sql`.
6. Click **Import / Go** at the bottom.
7. You will see 5 tables created:
   - `admin_credentials` (Default admin password: `nmms@2026`, PIN: `273464`)
   - `students` (Pre-loaded with Roll numbers 8001–8040)
   - `quizzes` (Dynamic quizzes, PYQ & unit tests)
   - `student_attempts` (Student scorecards, timings, answers)
   - `custom_subject_units` (Unit questions)

---

## 🐍 Step 3: Setup Python Application in Hostinger hPanel

*(Available on Hostinger Cloud Hosting, VPS, and Shared plans with Python App Support)*

1. In hPanel, search for **Python** or go to **Advanced** ➔ **Python App Manager** (or **Websites** ➔ **Python**).
2. Click **Create Application**:
   - **Python Version:** Select `Python 3.10` or `Python 3.11` or `3.12`.
   - **Application Root:** `public_html` (or your subdomain folder, e.g., `public_html/nmms`).
   - **Application URL:** Select your domain (e.g., `yourdomain.com`).
   - **Application Startup File:** `passenger_wsgi.py`.
   - **Application Entry Point:** `application`.
3. Click **Create**.

---

## 📦 Step 4: Upload Application Files

### Option A: Via Hostinger File Manager
1. In hPanel, go to **Files** ➔ **File Manager**.
2. Open `public_html`.
3. Build the frontend locally or export:
   ```bash
   npm run build
   ```
4. Upload all files into `public_html`:
   - Contents of `dist/` (i.e., `index.html`, `assets/`)
   - `assets/` folder from the root (containing `pyq/`, `matquiz/`, `satmaths/`, `satscience/`, `satsocial/`)
   - `hostinger/app.py`
   - `hostinger/passenger_wsgi.py`
   - `hostinger/requirements.txt`
   - `hostinger/.htaccess`
   - `.env` (create new file based on `hostinger/.env.example`)

---

## ⚙️ Step 5: Configure `.env` on Hostinger

Create a file named `.env` in `public_html/` with your credentials:

```env
DB_HOST=localhost
DB_USER=u123456789_nmms_user
DB_PASSWORD=YourStrongPassword
DB_NAME=u123456789_nmms_db
DB_PORT=3306

GEMINI_API_KEY=AIzaSy...Your_Gemini_API_Key
ADMIN_SECURITY_PIN=273464
DEFAULT_ADMIN_PASSWORD=nmms@2026
```

---

## 📥 Step 6: Install Python Dependencies

1. In Hostinger hPanel ➔ **Python App Manager**:
2. Click **Configuration** for your app.
3. Under **Modules / Dependencies**:
   - Enter `requirements.txt` path and click **Install Pip Dependencies** / **Run Pip Install**.
   - Or connect via **SSH Terminal** in hPanel:
     ```bash
     cd public_html
     source virtualenv/bin/activate
     pip install -r requirements.txt
     ```
4. Click **Restart Application** in the Python App Manager.

---

## ✅ Step 7: Verify Everything Works!

1. Open your domain in browser: `https://yourdomain.com/`
2. Test **Student Login** with Roll No `8001` (Karthik).
3. Test **Teacher Admin Login** (`/` ➔ Teacher Admin Login):
   - Default Password: `nmms@2026`
   - Security Reset PIN: `273464`
4. Test taking a quiz and submitting to confirm scores are stored in MySQL!

---

## 🇮🇳 தமிழ் குறிப்புகள் (Tamil Instructions)

1. **Hostinger hPanel**-இல் **Databases ➔ MySQL** பகுதிக்குச் சென்று புதிய டேட்டாபேஸ் மற்றும் பயனரை உருவாக்கவும்.
2. **phpMyAdmin**-ஐ திறந்து `hostinger/schema.sql` கோப்பினை **Import** செய்யவும்.
3. **Python App Manager**-இல் `passenger_wsgi.py` கோப்பினை Startup File ஆக தேர்வு செய்யவும்.
4. `dist/` கோப்புகள், `app.py`, `requirements.txt`, மற்றும் `.htaccess` ஆகியவற்றை `public_html`-இல் பதிவேற்றவும்.
5. `.env` கோப்பில் உங்கள் MySQL விவரங்கள் மற்றும் Gemini API Key-ஐ உள்ளிட்டு **Restart Application** கொடுக்கவும்.
