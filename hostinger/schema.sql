-- NMMS Quiz Application Database Schema for Hostinger MySQL (phpMyAdmin)
-- Database Character Set: utf8mb4 / utf8mb4_unicode_ci

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------------
-- 1. Table structure for table `admin_credentials`
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `admin_credentials` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `admin_password` VARCHAR(255) NOT NULL DEFAULT 'nmms@2026',
  `security_pin` VARCHAR(50) NOT NULL DEFAULT '273464',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default admin credentials if not exists
INSERT INTO `admin_credentials` (`id`, `admin_password`, `security_pin`)
VALUES (1, 'nmms@2026', '273464')
ON DUPLICATE KEY UPDATE `id`=`id`;

-- --------------------------------------------------------
-- 2. Table structure for table `students`
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `students` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `exam_number` VARCHAR(50) NOT NULL UNIQUE,
  `student_name` VARCHAR(150) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_exam_number` (`exam_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default registered students
INSERT IGNORE INTO `students` (`exam_number`, `student_name`) VALUES
('8001', 'கார்த்திக் (Karthik)'),
('8002', 'பிரியா (Priya)'),
('8003', 'தினேஷ் (Dinesh)'),
('8004', 'அனிதா (Anitha)'),
('8005', 'சரவணன் (Saravanan)'),
('8006', 'கவியரசு (Kaviyarasu)'),
('8007', 'தீபிகா (Deepika)'),
('8008', 'மணிகண்டன் (Manikandan)'),
('8009', 'ரம்யா (Ramya)'),
('8010', 'விஜய் (Vijay)'),
('8011', 'நவீன் (Naveen)'),
('8012', 'சந்தியா (Sandhiya)'),
('8013', 'பிரவீன் (Praveen)'),
('8014', 'சுவேதா (Swetha)'),
('8015', 'அருண் (Arun)'),
('8016', 'மீனா (Meena)'),
('8017', 'சூர்யா (Surya)'),
('8018', 'பவித்ரா (Pavithra)'),
('8019', 'ஹரிஹரன் (Hariharan)'),
('8020', 'லாவண்யா (Lavanya)'),
('8021', 'விக்னேஷ் (Vignesh)'),
('8022', 'திவ்யா (Divya)'),
('8023', 'சஞ்சய் (Sanjay)'),
('8024', 'கௌசல்யா (Kowsalya)'),
('8025', 'அஜய் (Ajay)'),
('8026', 'பானுப்பிரியா (Bhanupriya)'),
('8027', 'கோகுல் (Gokul)'),
('8028', 'ஜனனி (Janani)'),
('8029', 'மகேஷ் (Mahesh)'),
('8030', 'சினேகா (Sneha)'),
('8031', 'ரஞ்சித் (Ranjith)'),
('8032', 'பூஜா (Pooja)'),
('8033', 'சக்திவேல் (Sakthivel)'),
('8034', 'கீர்த்தனா (Keerthana)'),
('8035', 'பிரகாஷ் (Prakash)'),
('8036', 'நிஷா (Nisha)'),
('8037', 'மாதவன் (Madhavan)'),
('8038', 'அபூர்வா (Apoorva)'),
('8039', 'சுரேஷ் (Suresh)'),
('8040', 'யாமினி (Yamini)');

-- --------------------------------------------------------
-- 3. Table structure for table `quizzes`
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `quizzes` (
  `id` VARCHAR(100) NOT NULL PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `duration_minutes` INT NOT NULL DEFAULT 30,
  `total_marks` INT NOT NULL DEFAULT 20,
  `pass_percentage` INT NOT NULL DEFAULT 40,
  `shuffle_questions` TINYINT(1) NOT NULL DEFAULT 1,
  `shuffle_options` TINYINT(1) NOT NULL DEFAULT 1,
  `enable_question_limit` TINYINT(1) NOT NULL DEFAULT 0,
  `questions_per_attempt` INT NULL,
  `enable_anti_cheat` TINYINT(1) NOT NULL DEFAULT 1,
  `show_results_immediately` TINYINT(1) NOT NULL DEFAULT 1,
  `allow_review` TINYINT(1) NOT NULL DEFAULT 1,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `questions_json` LONGTEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_quiz_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 4. Table structure for table `student_attempts`
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `student_attempts` (
  `id` VARCHAR(100) NOT NULL PRIMARY KEY,
  `quiz_id` VARCHAR(100) NOT NULL,
  `quiz_title` VARCHAR(255) NOT NULL,
  `student_name` VARCHAR(150) NOT NULL,
  `exam_number` VARCHAR(50) NOT NULL,
  `started_at` VARCHAR(50) NOT NULL,
  `submitted_at` VARCHAR(50) NOT NULL,
  `time_taken_seconds` INT NOT NULL DEFAULT 0,
  `tab_switch_count` INT NOT NULL DEFAULT 0,
  `answers_json` LONGTEXT NOT NULL,
  `question_status_json` LONGTEXT NOT NULL,
  `score_json` LONGTEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_attempt_quiz` (`quiz_id`),
  INDEX `idx_attempt_exam_number` (`exam_number`),
  INDEX `idx_attempt_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- 5. Table structure for table `custom_subject_units`
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `custom_subject_units` (
  `id` VARCHAR(100) NOT NULL PRIMARY KEY,
  `subject` VARCHAR(50) NOT NULL,
  `unit_number` INT NOT NULL,
  `title_ta` VARCHAR(255) NOT NULL,
  `title_en` VARCHAR(255) NOT NULL,
  `questions_json` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `idx_subj_unit` (`subject`, `unit_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
