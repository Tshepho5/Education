-- FUSION_HIGH_APP PostgreSQL Schema

--DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS submissions CASCADE;
DROP TABLE IF EXISTS progress CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS teacher_classrooms CASCADE;
DROP TABLE IF EXISTS classrooms CASCADE;
DROP TABLE IF EXISTS children CASCADE;
DROP TABLE IF EXISTS subjects CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS employee_roles CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS textbooks CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);

INSERT INTO roles (name) VALUES 
  ('admin'), ('parent'), ('learner'), ('teacher')
ON CONFLICT DO NOTHING;

CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT
);

INSERT INTO departments (name, description) VALUES 
  ('Administration', 'Handles overall school management and administration.'),
  ('Academic', 'Responsible for teaching staff and curriculum.'),
  ('Maintenance', 'Manages cleaning, repairs, and facilities.'),
  ('IT', 'Oversees technology infrastructure and support.')
ON CONFLICT DO NOTHING;

CREATE TABLE employee_roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);

INSERT INTO employee_roles (name) VALUES 
  ('teacher'), ('Principal'), ('Vice_Principal')
ON CONFLICT DO NOTHING;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  full_name VARCHAR(255),
  surname VARCHAR(255),
  id_number VARCHAR(20),
  dob DATE,
  phone VARCHAR(20),
  physical_address TEXT,
  country VARCHAR(100),
  race VARCHAR(50),
  parent_type VARCHAR(50),
  reset_code VARCHAR(10),
  reset_expiry TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

select * from users;

CREATE TABLE subjects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 8 AND 12),
  stream VARCHAR(50) DEFAULT 'General' CHECK (stream IN ('General', 'Science', 'Commerce', 'Tourism'))
);

-- Seed CAPS Subjects (Abbreviated Sample)
INSERT INTO subjects (name, code, grade, stream) VALUES 
-- Science Stream (Grade 10-12)
('Mathematics', 'MATH10S', 10, 'Science'), ('Physical Sciences', 'PHSC10', 10, 'Science'), ('Life Sciences', 'LFSC10', 10, 'Science'),
('Mathematics', 'MATH11S', 11, 'Science'), ('Physical Sciences', 'PHSC11', 11, 'Science'), ('Life Sciences', 'LFSC11', 11, 'Science'),
('Mathematics', 'MATH12S', 12, 'Science'), ('Physical Sciences', 'PHSC12', 12, 'Science'), ('Life Sciences', 'LFSC12', 12, 'Science'),
-- Commerce Stream (Grade 10-12)
('Accounting', 'ACC10', 10, 'Commerce'), ('Business Studies', 'BUSS10', 10, 'Commerce'), ('Economics', 'ECON10', 10, 'Commerce'),
('Accounting', 'ACC11', 11, 'Commerce'), ('Business Studies', 'BUSS11', 11, 'Commerce'), ('Economics', 'ECON11', 11, 'Commerce'),
('Accounting', 'ACC12', 12, 'Commerce'), ('Business Studies', 'BUSS12', 12, 'Commerce'), ('Economics', 'ECON12', 12, 'Commerce'),
-- Tourism Stream (Grade 10-12)
('Tourism', 'TOUR10', 10, 'Tourism'), ('Mathematical Literacy', 'MLIT10', 10, 'Tourism'),
('Tourism', 'TOUR11', 11, 'Tourism'), ('Mathematical Literacy', 'MLIT11', 11, 'Tourism'),
('Tourism', 'TOUR12', 12, 'Tourism'), ('Mathematical Literacy', 'MLIT12', 12, 'Tourism'),
-- Compulsory Subjects (All Streams)
('English FAL', 'ENGF10', 10, 'General'), ('Home Language', 'HMLG10', 10, 'General'), ('Life Orientation', 'LFOR10', 10, 'General'),
('English FAL', 'ENGF11', 11, 'General'), ('Home Language', 'HMLG11', 11, 'General'), ('Life Orientation', 'LFOR11', 11, 'General'),
('English FAL', 'ENGF12', 12, 'General'), ('Home Language', 'HMLG12', 12, 'General'), ('Life Orientation', 'LFOR12', 12, 'General'),
-- Grade 8-9 General Curriculum
('Natural Sciences', 'NSCI08', 8, 'General'), ('EMS', 'EMSC08', 8, 'General'), ('Technology', 'TECH08', 8, 'General'), ('Social Sciences', 'SSCI08', 8, 'General'),
('Natural Sciences', 'NSCI09', 9, 'General'), ('EMS', 'EMSC09', 9, 'General'), ('Technology', 'TECH09', 9, 'General'), ('Social Sciences', 'SSCI09', 9, 'General')
ON CONFLICT DO NOTHING;

SELECT * FROM subjects;

CREATE TABLE children (
  id SERIAL PRIMARY KEY,
  learner_name VARCHAR(255) NOT NULL,
  learner_surname VARCHAR(255) NOT NULL,
  learner_id_number VARCHAR(20) UNIQUE NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 8 AND 12),
  stream VARCHAR(50) CHECK (grade < 10 OR stream IN ('Science', 'Commerce', 'Tourism')),
  subjects TEXT[] NOT NULL DEFAULT '{}',
  parent_id INTEGER REFERENCES users(id),
  learner_user_id INTEGER REFERENCES users(id),
  learner_number VARCHAR(20) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SELECT * FROM children;



select * from children;

CREATE TABLE employees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_role_id INTEGER REFERENCES employee_roles(id),
  full_name VARCHAR(255) NOT NULL,
  surname VARCHAR(255) NOT NULL,
  name INTEGER REFERENCES departments(id),
  subjects TEXT[] DEFAULT '{}',
  subject_codes TEXT[] DEFAULT '{}',
  grades_taught INTEGER[] DEFAULT '{}',
  classes_taught TEXT[] DEFAULT '{}',
  phone VARCHAR(20),
  email VARCHAR(255),
  hired_date DATE
);


-- SEEDING SAMPLE DATA (Employees & Workload)

-- 1. Create a Teacher User (Auth Record)
INSERT INTO users (email, password_hash, role_id, full_name, surname, id_number, dob, phone, physical_address, country, race, parent_type)
VALUES ('202247878@myturf.ul.ac.za', '#Butcher#$5$',(SELECT id FROM roles WHERE name = 'teacher'), 'Tshepho Letlalo', 'Makula', '0209205494088', '2002-09-20', '0692606618', '556 Mokgobu street, Maknweng A, Polokwane', 'South Africa', 'Black', 'Father'),
	   ('tbjmaetane1010@gmail.com', 'Johannes@08', (select id from roles where name = 'teacher'), 'Thabang', 'Maetane' ,'0208285930086', '2002-08-28', '0827637087', '123 maetane street', 'South Sudan', 'white', 'father'),
	   ('thapeloleshabane05@gmail.com', 'Thapelo@05',(SELECT ID FROM roles WHERE name= 'teacher'), 'Thapelo', 'Leshabane','0504225825083', '2005-05-22','0661420527','243 Rabothata street','South Africa','Coloured','Father')
ON CONFLICT DO NOTHING;

 Select * from users;
-- 2. Create the Employee Profile (Professional Workload)
INSERT INTO employees (
  user_id, employee_role_id, full_name, surname, name, subjects, subject_codes, grades_taught, classes_taught, phone, email, hired_date
) 
SELECT 
  u.id,                                   -- user_id
  er.id,                                  -- employee_role_id
  u.full_name,                            -- full_name (from users)
  u.surname,                              -- surname (from users)
  d.id,                                   -- department_id (stored in 'name' column)
  ARRAY['Mathematics'],                   -- subjects
  ARRAY['MATH10S', 'MATH11S', 'MATH12S'], -- subject_codes
  ARRAY[10, 11, 12],                      -- grades_taught
  ARRAY['10A', '11A', '12A'],             -- classes_taught
  u.phone,                                -- phone (from users)
  u.email,                                -- email (from users)
  '2026-01-15'::DATE                      -- hired_date
FROM users u
JOIN employee_roles er ON er.name = 'teacher'
JOIN departments d ON d.name = 'Academic'
WHERE u.email = '202247878@myturf.ul.ac.za'
ON CONFLICT (user_id) DO NOTHING;

SELECT * FROM employees;

-- ==========================================


CREATE TABLE progress (
  id SERIAL PRIMARY KEY,
  child_id INTEGER REFERENCES children(id) ON DELETE CASCADE,
  subject VARCHAR(100) NOT NULL,
  term VARCHAR(20) DEFAULT 'Term 1',
  grade DECIMAL(5,2), -- Represents score/percentage
  time_taken_seconds INTEGER,
  notes TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  grade_target INTEGER,
  stream_target VARCHAR(50),
  subject_target VARCHAR(255),
  role_target VARCHAR(50) DEFAULT 'all' CHECK (role_target IN ('all', 'admin', 'parent', 'learner')),
  is_assignment BOOLEAN DEFAULT FALSE,
  assignment_data JSONB,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SELECT * FROM announcements;
CREATE TABLE textbooks (
  id SERIAL PRIMARY KEY,
  subject VARCHAR(100) NOT NULL,
  grade INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
select * from textbooks;

CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  subject VARCHAR(100),
  grade INTEGER CHECK (grade BETWEEN 8 AND 12),
  stream VARCHAR(50) CHECK (stream IS NULL OR stream IN ('General', 'Science', 'Commerce', 'Tourism')),
  due_date TIMESTAMP,
  task_type VARCHAR(50) DEFAULT 'general' CHECK (task_type IN ('general', 'homework', 'assignment', 'revision')),
  content TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table to track learner task submissions and move them out of pending
CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    learner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,                -- Optional: store the learner's answer or file link
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'submitted',
    UNIQUE(task_id, learner_id)  -- Ensures a learner only has one submission entry per task
);


CREATE TABLE classrooms (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 8 AND 12),
  stream VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE children
ADD COLUMN classroom_id INTEGER REFERENCES classrooms(id);

CREATE TABLE teacher_classrooms (
  id SERIAL PRIMARY KEY,
  teacher_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  classroom_id INTEGER REFERENCES classrooms(id) ON DELETE CASCADE,
  subject VARCHAR(100) NOT NULL,
  UNIQUE (teacher_user_id, classroom_id, subject)
);

-- Logic-supporting Indexes
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_id_number ON users (id_number);
CREATE INDEX IF NOT EXISTS idx_children_learner_number ON children (learner_number);
CREATE INDEX IF NOT EXISTS idx_progress_child_id ON progress (child_id);
CREATE INDEX IF NOT EXISTS idx_children_parent ON children (parent_id);
CREATE INDEX IF NOT EXISTS idx_children_learner_user ON children (learner_user_id);
CREATE INDEX IF NOT EXISTS idx_children_subjects ON children USING GIN (subjects);
CREATE INDEX IF NOT EXISTS idx_employees_user ON employees (user_id);
CREATE INDEX IF NOT EXISTS idx_employees_grades ON employees USING GIN (grades_taught);
CREATE INDEX IF NOT EXISTS idx_announcements_target ON announcements (role_target);
CREATE INDEX IF NOT EXISTS idx_children_classroom ON children (classroom_id);
CREATE INDEX IF NOT EXISTS idx_tasks_target ON tasks (grade, stream, subject);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_submissions_task_learner ON submissions (task_id, learner_id);
