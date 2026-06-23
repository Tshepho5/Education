require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db/db'); // Point to the db/db.js connection pool
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const authController = require('./controllers/authController');
const teacherController = require('./controllers/teacherController');
const learnerController = require('./controllers/learnerController');
const userController = require('./controllers/userController');
const parentController = require('./controllers/parentController');
const progressController = require('./controllers/progressController');
const announcementController = require('./controllers/announcementController');
const taskController = require('./controllers/taskController');

const app = express();
const PORT = process.env.PORT || 4000;
const IP = (process.env.IP || 'localhost').trim();  // Network IP or fallback to localhost
const MAX_JSON_BODY = process.env.MAX_JSON_BODY || '1mb';
const MAX_TEXTBOOK_UPLOAD_MB = Number.parseInt(process.env.MAX_TEXTBOOK_UPLOAD_MB || '25', 10);
const MAX_TEXTBOOK_UPLOAD_BYTES = MAX_TEXTBOOK_UPLOAD_MB * 1024 * 1024;
const dashboardRoleMap = {
  admin: 'admin',
  administrator: 'admin',
  principal: 'admin',
  vice_principal: 'admin',
  'vice-principal': 'admin',
  parent: 'parent',
  learner: 'learner',
  teacher: 'teacher'
};

const parseOrigins = (value) => (value || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const defaultCorsOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(IP && IP !== 'localhost' ? [`http://${IP}:${PORT}`] : [])
];
const allowedCorsOrigins = parseOrigins(process.env.CORS_ORIGINS);
const corsOrigins = allowedCorsOrigins.length > 0 ? allowedCorsOrigins : defaultCorsOrigins;

const corsOptions = {
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number.parseInt(process.env.API_RATE_LIMIT || '300', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number.parseInt(process.env.AUTH_RATE_LIMIT || '20', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' }
});

const sanitizeUploadName = (originalName) => {
  const ext = path.extname(originalName).toLowerCase();
  const baseName = path.basename(originalName, ext)
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'textbook';
  return `${Date.now()}-${baseName}${ext}`;
};

// Ensure upload directory exists
const uploadDir = 'uploads/textbooks/';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer for PDF storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/textbooks/'),
  filename: (req, file, cb) => cb(null, sanitizeUploadName(file.originalname))
});
const upload = multer({ 
  storage,
  limits: {
    fileSize: MAX_TEXTBOOK_UPLOAD_BYTES,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
    if (!isPdf) return cb(new Error('Only PDF textbook uploads are allowed'));
    return cb(null, true);
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: MAX_JSON_BODY }));
app.use(express.urlencoded({ extended: false, limit: MAX_JSON_BODY }));
app.use('/api', apiLimiter);
app.use(express.static('public', {
  dotfiles: 'deny',
  index: false,
  maxAge: '1h'
}));
app.use('/uploads', express.static('uploads', {
  dotfiles: 'deny',
  index: false,
  maxAge: '1h',
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
  }
}));

// JWT Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token || token === 'null' || token === 'undefined') {
    console.error(`[AUTH ERROR] Missing or invalid token string: ${token}`);
    return res.status(401).json({ error: 'Access denied: No valid session token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error(`[AUTH ERROR] ${err.name}: ${err.message}. Received token starts with: ${token.substring(0, 10)}...`);
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Role Middleware
const requireRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient role' });
  }
  next();
};

// Auth & Profile
app.post('/api/register', authLimiter, authController.register);
app.post('/api/login', authLimiter, authController.login);
app.post('/api/forgot-password', authLimiter, authController.forgotPassword);
app.post('/api/verify-reset-code', authLimiter, authController.verifyOTP);
app.post('/api/reset-password', authLimiter, authController.resetPassword);
app.get('/api/profile', authenticateToken, userController.getProfile);
app.put('/api/profile', authenticateToken, userController.updateProfile);

// Teacher Routes
app.get('/api/teacher/workload', authenticateToken, requireRole(['teacher']), teacherController.getWorkload);
app.get('/api/teacher/classlist', authenticateToken, requireRole(['teacher']), teacherController.getClassList);
app.get('/api/teacher/textbook-topics', authenticateToken, requireRole(['teacher']), teacherController.getTopicsFromTextbook);
app.get('/api/teacher/my-textbooks', authenticateToken, requireRole(['teacher']), teacherController.getMyTextbooks);
app.post('/api/teacher/upload-textbook', authenticateToken, requireRole(['teacher']), upload.single('textbook'), teacherController.uploadTextbook);
app.post('/api/ai/generate-assignment-questions', authenticateToken, requireRole(['teacher']), teacherController.generateAIQuestions);
app.post('/api/teacher/assignments', authenticateToken, requireRole(['teacher']), teacherController.publishAssignment);

// Learner Routes
app.get('/api/learner/subjects', authenticateToken, requireRole(['learner']), learnerController.getSubjects);
app.get('/api/learner/topics', authenticateToken, requireRole(['learner']), learnerController.getTopics);
app.get('/api/learner/assignments', authenticateToken, requireRole(['learner']), learnerController.getAssignments);
app.get('/api/learner/progress', authenticateToken, requireRole(['learner']), progressController.getLearnerProgress);
app.post('/api/learner/ask-ai', authenticateToken, requireRole(['learner']), learnerController.askAITutor);
app.post('/api/learner/summarize', authenticateToken, requireRole(['learner']), learnerController.summarizeTopic);
app.get('/api/learner/study-plan', authenticateToken, requireRole(['learner']), learnerController.generateStudyPlan);
app.get('/api/tasks/dashboard', authenticateToken, requireRole(['learner']), taskController.getLearnerDashboardTasks);
app.post('/api/tasks/submit', authenticateToken, requireRole(['learner']), taskController.submitTask);

// Parent: Children
app.post('/api/children', authenticateToken, requireRole(['parent', 'teacher']), parentController.registerChild);
app.get('/api/children', authenticateToken, requireRole(['parent', 'teacher']), parentController.getChildren);

// Progress (teacher/parent)
app.get('/api/progress/:childId', authenticateToken, requireRole(['parent', 'teacher']), progressController.getChildProgress);
app.post('/api/progress', authenticateToken, requireRole(['teacher']), progressController.addProgress);

// AI Tutor: Get Topics
app.get('/api/ai/task', authenticateToken, requireRole(['learner']), learnerController.getTask);
app.post('/api/ai/grade-task', authenticateToken, requireRole(['learner']), learnerController.gradeAITask);
app.post('/api/learner/grade-assignment', authenticateToken, requireRole(['learner']), learnerController.gradeAssignment);
app.get('/api/ai/leaderboard', authenticateToken, learnerController.getLeaderboard);

// Announcements
app.post('/api/announcements', authenticateToken, requireRole(['teacher', 'admin']), announcementController.createAnnouncement);
app.get('/api/announcements', authenticateToken, announcementController.getAnnouncements);

// Serve dashboard index
// Auth Page Routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/auth/index.html');
});

app.get('/register', (req, res) => {
  res.sendFile(__dirname + '/public/auth/registrationForm.html');
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(__dirname + '/public/auth/ForgotPassword.html');
});

// Serve dashboard index
app.get('/dashboard/:role', (req, res) => {
  const requestedRole = req.params.role.toLowerCase().replace(/\.html$/, '');
  const dashboardRole = dashboardRoleMap[requestedRole];

  if (!dashboardRole) {
    return res.status(404).send('Dashboard not found');
  }

  res.sendFile(path.join(__dirname, 'public', 'dashboards', `${dashboardRole}.html`));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Uploaded file is too large. Maximum size is ${MAX_TEXTBOOK_UPLOAD_MB}MB.`
      : err.message;
    return res.status(400).json({ error: message });
  }

  if (err.message === 'Only PDF textbook uploads are allowed') {
    return res.status(415).json({ error: err.message });
  }

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS origin is not allowed' });
  }

  return next(err);
});

app.listen(PORT, IP, () => {
  console.log(`Server running at http://${IP}:${PORT}`);
});

module.exports = app;
