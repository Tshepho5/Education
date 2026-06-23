// Main App Logic - FUSION_HIGH_APP

import { getProfile, updateProfile, getChildren, getProgress, getLearnerProgress, getAnnouncements, getLearnerSubjects, getLearnerAssignments, getAITopics, getAITask, gradeAITask, gradeAssignment, getLeaderboard, getTasksDashboard, submitHomeTask } from './api.js';

// Check if logged in on load
document.addEventListener('DOMContentLoaded', checkAuth);

function normalizeDashboardRole(role) {
  const normalized = (role || '').toLowerCase();
  const roleMap = {
    administrator: 'admin',
    principal: 'admin',
    vice_principal: 'admin',
    'vice-principal': 'admin'
  };
  return roleMap[normalized] || normalized;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeWithLineBreaks(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function encodeForInlineArg(value) {
  return encodeURIComponent(String(value ?? ''));
}

function checkAuth() {
  const token = localStorage.getItem('token');
  if (token) {
    getProfile().then(user => {
      loadDashboard(user.role);
    }).catch(() => {
      localStorage.removeItem('token');
    });
  }
}

export function loadDashboard(role) {
  window.location.href = `/dashboard/${normalizeDashboardRole(role)}`;
}

window.showSection = function(sectionId) {
  // Hide all sections marked with 'dashboard-section' class
  document.querySelectorAll('.dashboard-section').forEach(section => {
    section.style.display = 'none';
  });
  // Show the target section
  const target = document.getElementById(sectionId);
  if (target) target.style.display = 'block';
};

// Sidebar navigation for Subjects
window.viewSubjects = function() {
  showSection('subjects-section');
  loadLearnerDashboard(); // Ensure subjects are loaded and AI-ready
};

// Dashboard loader (used in dashboard.html)
window.loadDashboardContent = async function() {
  const role = normalizeDashboardRole(localStorage.getItem('userRole'));
  document.body.classList.add('dashboard');
  document.querySelector('.dashboard-header h1').textContent = `Welcome to Dashboard - ${role.charAt(0).toUpperCase() + role.slice(1)}`;
  document.querySelector('.role-badge').textContent = role.toUpperCase();

  switch (role) {
    case 'parent':
      await loadParentDashboard();
      break;
    case 'teacher':
      await loadTeacherDashboard();
      break;
    case 'admin':
      await loadAdminDashboard();
      break;
    case 'learner':
      await loadLearnerDashboard();
      break;
  }
};

async function loadParentDashboard() {
  showLoading(document.querySelector('.dashboard'));
  try {
    const children = await getChildren();
    displayChildren(children);

    const announcements = await getAnnouncements('parent');
    displayAnnouncements(announcements);
  } catch (error) {
    alert('Error loading dashboard: ' + error.message);
  } finally {
    hideLoading(document.querySelector('.dashboard'));
  }
}

function displayChildren(children) {
  const container = document.getElementById('childrenList');
  if (children.length === 0) {
    container.innerHTML = '<p>No children registered.</p>';
    return;
  }
  container.innerHTML = children.map(child => `
    <div class="card">
      <h3>${escapeHtml(child.learner_name)} ${escapeHtml(child.learner_surname)}</h3>
      <p>Learner Email: ${escapeHtml(child.learner_email)}</p>
      <button onclick="viewProgress(${Number(child.id)})" class="btn btn-info">View Progress</button>
    </div>
  `).join('');
}

async function viewProgress(childId) {
  try {
    const progress = await getProgress(childId);
    displayProgress(progress);
  } catch (error) {
    alert(error.message);
  }
}
// Modal display for progress - simplified
function displayProgress(progress) {
  const modal = document.getElementById('progressModal');
  modal.querySelector('tbody').innerHTML = progress.map(p => `
    <tr>
      <td>${escapeHtml(p.subject)}</td>
      <td>${escapeHtml(p.grade)}</td>
      <td>${escapeHtml(p.notes || '')}</td>
      <td>${new Date(p.date).toLocaleDateString()}</td>
    </tr>
  `).join('');
  modal.style.display = 'block';
}

// Similar for other roles...
async function loadTeacherDashboard() {
  showLoading(document.querySelector('.dashboard'));
  try {
    const announcements = await getAnnouncements('teacher');
    displayAnnouncements(announcements);
  } catch (error) {
    alert('Error: ' + error.message);
  } finally {
    hideLoading(document.querySelector('.dashboard'));
  }
}

async function loadAdminDashboard() {
  // Admin: manage users, announcements
  showLoading();
}

async function loadLearnerDashboard() {
  const container = document.querySelector('.dashboard');
  showLoading(container);
  try {
    // 1. Load Profile & Subjects
    const profile = await getProfile();
    const subjectData = await getLearnerSubjects();
    
    document.getElementById('learnerName').textContent = `${profile.full_name} ${profile.surname}`;
    document.getElementById('learnerMeta').textContent = `Grade ${profile.academic?.grade} | ${profile.academic?.stream} Stream`;

    // 2. Render Subjects as Cards (links if AI enabled)
    const subjectList = document.getElementById('subjectList');
    if (subjectList) subjectList.innerHTML = subjectData.subjects.map(sub => `
      <div class="card subject-card ${sub.aiEnabled ? 'ai-active' : ''}">
        <div class="card-body">
          <h4>${escapeHtml(sub.name)}</h4>
          ${sub.aiEnabled
            ? `<button onclick="openAITutor(decodeURIComponent('${encodeForInlineArg(sub.name)}'))" class="btn btn-primary btn-sm">Self-Study with AI</button>`
            : `<span class="badge bg-secondary">No AI Content Available</span>`}
        </div>
      </div>
    `).join('');

    // 3. Load Progress History
    const history = await getLearnerProgress(); // Own progress via learner endpoint
    displayProgressHistory(history);

    // 4. Load Home Page Tasks (Pending vs Completed tracking)
    const tasks = await getTasksDashboard();
    displayDashboardTasks(tasks);

    const announcements = await getAnnouncements('learner');
    displayAnnouncements(announcements);

    const assignments = await getLearnerAssignments();
    displayAssignments(assignments);
    loadLearnerProfile(profile);

    // Ensure the overview section is visible by default
    showSection('overview-section');
  } catch (error) {
    console.error('Learner Dashboard Error:', error);
  } finally {
    hideLoading(container);
  }
}

// AI Tutor Flow
window.openAITutor = async function(subject) {
  const tutorSubject = document.getElementById('tutorSubject');
  const tutorView = document.getElementById('tutorView');
  const mainDashboard = document.getElementById('mainDashboard');

  if (!tutorSubject || !tutorView || !mainDashboard) return console.error('Dashboard UI elements missing');

  tutorSubject.textContent = subject;
  tutorView.style.display = 'block';
  mainDashboard.style.display = 'none';
  
  // Reset UI from previous sessions
  document.getElementById('lessonContent').style.display = 'none';
  document.getElementById('quizResults').innerHTML = '';
  
  const topicSelect = document.getElementById('topicSelector');
  topicSelect.innerHTML = '<option value="">Loading topics...</option>';
  
  const tutorViewEl = document.getElementById('tutorView');
  showLoading(tutorViewEl);
  try {
    const topics = await getAITopics(subject);
    
    if (topics && topics.length > 0) {
      topicSelect.innerHTML = `<option value="">-- Select a Topic --</option>` + 
        topics.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.topic)}</option>`).join('');
    } else {
      topicSelect.innerHTML = `<option value="">No chapters found for this subject.</option>`;
    }
  } catch (error) {
    console.error('Error loading AI topics:', error);
    alert('Failed to load AI topics: ' + error.message);
  } finally {
    hideLoading(tutorViewEl);
  }
};

window.startLesson = async function() {
  const subject = document.getElementById('tutorSubject').textContent;
  const topicId = document.getElementById('topicSelector').value;
  if (!topicId) return alert('Please select a topic');

  const lessonContentEl = document.getElementById('lessonContent');
  showLoading(lessonContentEl);
  try {
    const task = await getAITask(subject, topicId);
    if (!task) {
      alert('No AI task content received for this topic.');
      return;
    }
    
    // Clear previous results
    document.getElementById('quizResults').innerHTML = '';
    window.currentAssessmentId = task.assessmentId;

    // Render Content
    const safeExplanation = escapeWithLineBreaks(task.explanation || 'No explanation available.');
    const safeExamples = escapeWithLineBreaks(task.examples || '');

    document.getElementById('explanationArea').innerHTML = `
      <div class="study-content">
        <div class="explanation-text"><h6>Core Concepts & Notes</h6>${safeExplanation}</div>
        ${task.formula ? `<div class="math-box">$$${escapeHtml(task.formula)}$$</div>` : ''}
        ${task.examples ? `<div class="examples-box mt-3 p-3 bg-light border-start border-4 border-primary"><h6>Worked Examples</h6>${safeExamples}</div>` : ''}
        ${task.answerInstructions ? `<div class="alert alert-warning mt-2 py-1 small"><strong>Formatting Hint:</strong> ${escapeHtml(task.answerInstructions)}</div>` : ''}
      </div>
      <div class="mt-4 p-3 border-top text-center" id="quizTransitionArea">
        <p class="mb-3 text-muted">Finished studying the examples? Test your knowledge with a quick AI-generated quiz.</p>
        <button onclick="revealQuizSection()" class="btn btn-success">Yes, I'm Ready for the Quiz!</button>
      </div>
    `;
    
    // Render Questions
    const questionsArea = document.getElementById('questionsArea');
    questionsArea.style.display = 'none'; // Hide by default
    questionsArea.innerHTML = (task.questions || []).map(q => `
      <div class="question-item mb-3">
        <p><strong>Q: ${escapeHtml(q.question)}</strong></p>
        <input type="text" class="form-control quiz-answer" data-id="${escapeHtml(q.id)}" placeholder="Your answer...">
      </div>
    `).join('');

    // Ensure submit button is hidden initially
    if (document.getElementById('submitQuizBtn')) document.getElementById('submitQuizBtn').style.display = 'none';

    lessonContentEl.style.display = 'block';
    // Render LaTeX if KaTeX is present
    if (window.renderMathInElement) window.renderMathInElement(document.getElementById('explanationArea'));
  } catch (error) {
    console.error('Error loading AI task:', error);
    alert('Failed to load AI lesson: ' + error.message);
  } finally {
    hideLoading(lessonContentEl);
  }
};

window.revealQuizSection = function() {
  document.getElementById('quizTransitionArea').style.display = 'none';
  document.getElementById('questionsArea').style.display = 'block';
  const submitBtn = document.getElementById('submitQuizBtn');
  if (submitBtn) submitBtn.style.display = 'block';
  document.getElementById('questionsArea').scrollIntoView({ behavior: 'smooth' });
};

window.submitQuiz = async function() {
  const answers = {};
  document.querySelectorAll('.quiz-answer').forEach(input => {
    answers[input.dataset.id] = input.value;
  });

  let result;
  if (window.isTeacherAssignment) {
    result = await gradeAssignment(window.currentAssessmentId, answers);
    window.isTeacherAssignment = false;
  } else {
    result = await gradeAITask(window.currentAssessmentId, answers);
  }
  
  document.getElementById('quizResults').innerHTML = `
    <div class="alert alert-info">
      <h4>Result: ${escapeHtml(result.percentage)}%</h4>
      <p><strong>Insight:</strong> ${escapeHtml(result.aiInsight)}</p>
      <p><strong>Feedback:</strong> ${escapeHtml(result.feedback)}</p>
      <p><small>Time taken: ${escapeHtml(result.timeTaken)} seconds</small></p>
    </div>
  `;
  
  // Refresh performance history after submission
  loadLearnerDashboard();
};

function displayAssignments(assignments) {
  const container = document.getElementById('assignmentsList');
  if (!container) return;
  if (assignments.length === 0) {
    container.innerHTML = '<p class="text-muted">No pending assignments.</p>';
    return;
  }
  container.innerHTML = assignments.map(asn => `
    <div class="card mb-3">
      <div class="card-body">
        <h5>${escapeHtml(asn.title)}</h5>
        <p class="small text-muted">${escapeHtml(asn.subject_target)} | Grade ${escapeHtml(asn.grade_target)}</p>
        <button onclick="startAssignment(${Number(asn.id)})" class="btn btn-outline-primary btn-sm">Take Assignment</button>
      </div>
    </div>
  `).join('');
}

function displayDashboardTasks(tasks) {
  const container = document.getElementById('dashboardTasks') || document.getElementById('pending-assignments');
  if (!container) return;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    container.innerHTML = '<p class="text-muted">No tasks assigned.</p>';
    return;
  }

  const pendingTasks = tasks.filter(task => !task.is_submitted);
  const completedTasks = tasks.filter(task => task.is_submitted);

  const renderTask = (task, completed = false) => {
    const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date';
    return `
      <div class="card mb-3">
        <div class="card-body">
          <h5>${escapeHtml(task.title)}</h5>
          <p class="small text-muted">${escapeHtml(task.subject || 'General')} | ${escapeHtml(dueDate)}</p>
          ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}
          ${completed
            ? '<span class="badge bg-success">Submitted</span>'
            : `<button onclick="submitDashboardTask(${Number(task.id)})" class="btn btn-outline-primary btn-sm">Mark Submitted</button>`}
        </div>
      </div>
    `;
  };

  container.innerHTML = `
    ${pendingTasks.length ? pendingTasks.map(task => renderTask(task)).join('') : '<p class="text-muted">No pending tasks.</p>'}
    ${completedTasks.length ? `<h5 class="mt-4">Submitted Tasks</h5>${completedTasks.map(task => renderTask(task, true)).join('')}` : ''}
  `;
}

window.submitDashboardTask = async function(taskId) {
  try {
    await submitHomeTask(taskId);
    const tasks = await getTasksDashboard();
    displayDashboardTasks(tasks);
  } catch (error) {
    alert(error.message);
  }
};

window.startAssignment = async function(assignmentId) {
  document.getElementById('tutorView').style.display = 'block';
  document.getElementById('mainDashboard').style.display = 'none';
  const lessonContentEl = document.getElementById('lessonContent');
  showLoading(lessonContentEl);
  
  try {
    const assignments = await getLearnerAssignments();
    const asn = assignments.find(a => a.id == assignmentId);
    window.currentAssessmentId = assignmentId;
    window.isTeacherAssignment = true;

    document.getElementById('tutorSubject').textContent = asn.subject_target;
    document.getElementById('explanationArea').innerHTML = `<h6>${escapeHtml(asn.title)}</h6><p>${escapeHtml(asn.content)}</p>`;
    const questions = typeof asn.assignment_data === 'string' ? JSON.parse(asn.assignment_data) : asn.assignment_data;
    
    document.getElementById('questionsArea').innerHTML = questions.map(q => `
      <div class="question-item mb-3">
        <p><strong>Q: ${escapeHtml(q.question)}</strong></p>
        <input type="text" class="form-control quiz-answer" data-id="${escapeHtml(q.id)}" placeholder="Your answer...">
      </div>
    `).join('');
    
    lessonContentEl.style.display = 'block';
    document.getElementById('quizResults').innerHTML = '';
  } catch (error) {
    alert('Error loading assignment: ' + error.message);
  } finally {
    hideLoading(lessonContentEl);
  }
};

function displayProgressHistory(history) {
  const tbody = document.getElementById('performanceHistory');
  if (!tbody) return;
  tbody.innerHTML = history.map(p => `
    <tr>
      <td>${escapeHtml(p.subject)}</td>
      <td><span class="score-pill">${escapeHtml(p.percentage)}%</span></td>
      <td>${escapeHtml(p.time_taken_seconds || '--')}s</td>
      <td><small>${escapeHtml(p.aiInsight || 'No insight')}</small></td>
      <td>${new Date(p.date).toLocaleDateString()}</td>
    </tr>
  `).join('');
}

function loadLearnerProfile(profile) {
  const form = document.getElementById('profileForm');
  if (!form) return;
  form.full_name.value = profile.full_name || '';
  form.surname.value = profile.surname || '';
  form.email.value = profile.email || '';
  form.phone.value = profile.phone || '';
  form.physical_address.value = profile.physical_address || '';
}

window.saveProfile = async function(e) {
  if (e) e.preventDefault();
  const form = document.getElementById('profileForm');
  const formData = Object.fromEntries(new FormData(form));
  showLoading(form);
  try {
    await updateProfile(formData);
    alert('Profile updated successfully!');
  } catch (error) {
    alert('Update failed: ' + error.message);
  } finally {
    hideLoading(form);
  }
};

window.loadLeaderboard = async function() {
  const subject = document.getElementById('tutorSubject').textContent;
  const board = await getLeaderboard(subject);
  const list = document.getElementById('leaderboardList');
  list.innerHTML = board.map((entry, index) => `
    <li class="list-group-item d-flex justify-content-between align-items-center">
      <span>#${index + 1} Learner ${escapeHtml(entry.rank_id)}</span>
      <span class="badge bg-success rounded-pill">${escapeHtml(entry.score)}%</span>
    </li>
  `).join('') || '<li class="list-group-item">No entries yet.</li>';
};

window.closeTutor = function() {
  document.getElementById('tutorView').style.display = 'none';
  document.getElementById('mainDashboard').style.display = 'block';
  document.getElementById('lessonContent').style.display = 'none';
  document.getElementById('quizResults').innerHTML = '';
}

function displayAnnouncements(anns) {
  const container = document.getElementById('announcementsList');
  container.innerHTML = anns.map(ann => `
    <div class="announcement">
      <h4>${escapeHtml(ann.title)}</h4>
      <p>${escapeHtml(ann.content)}</p>
      <small>${new Date(ann.created_at).toLocaleString()}</small>
    </div>
  `).join('');
}

// Global utils
export function showLoading(el = document.body) {
  el.classList.add('loading');
  if (!el.querySelector('.spinner')) {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    el.appendChild(spinner);
  }
}

export function hideLoading(el = document.body) {
  el.classList.remove('loading');
  const spinner = el.querySelector('.spinner');
  if (spinner) spinner.remove();
}

// Logout
window.logout = function() {
  localStorage.clear();
  window.location.href = '/';
};
