// API Helper - FUSION_HIGH_APP
const API_BASE = '/api';

async function apiCall(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` })
    },
    ...options
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'API error');
    }
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Auth
export async function register(userData) {
  return apiCall('/register', { method: 'POST', body: JSON.stringify(userData) });
}

export async function login(credentials) {
  return apiCall('/login', { method: 'POST', body: JSON.stringify(credentials) });
}

// Profile
export async function getProfile() {
  return apiCall('/profile');
}

export async function updateProfile(profileData) {
  return apiCall('/profile', { method: 'PUT', body: JSON.stringify(profileData) });
}

// Parent
export async function createChild(childData) {
  return apiCall('/children', { method: 'POST', body: JSON.stringify(childData) });
}

export async function getChildren() {
  return apiCall('/children');
}

// Progress
export async function getProgress(childId) {
  return apiCall(`/progress/${childId}`);
}

export async function getLearnerProgress() {
  return apiCall('/learner/progress');
}

export async function addProgress(progressData) {
  return apiCall('/progress', { method: 'POST', body: JSON.stringify(progressData) });
}

// Announcements
export async function createAnnouncement(annData) {
  return apiCall('/announcements', { method: 'POST', body: JSON.stringify(annData) });
}

export async function getAnnouncements(roleTarget) {
  return apiCall(`/announcements?role_target=${roleTarget}`);
}

// AI Tutor Endpoints
export async function getLearnerSubjects() {
  return apiCall('/learner/subjects');
}

export async function getLearnerAssignments() {
  return apiCall('/learner/assignments');
}

export async function getAITopics(subject) {
  return apiCall(`/learner/topics?subject=${encodeURIComponent(subject)}`);
}

export async function getAITask(subject, topicId) {
  return apiCall(`/ai/task?subject=${encodeURIComponent(subject)}&topicId=${topicId}`);
}

export async function gradeAITask(assessmentId, answers) {
  return apiCall('/ai/grade-task', { method: 'POST', body: JSON.stringify({ assessmentId, answers }) });
}

export async function gradeAssignment(assessmentId, answers) {
  return apiCall('/learner/grade-assignment', { method: 'POST', body: JSON.stringify({ assessmentId, answers }) });
}

export async function getLeaderboard(subject) {
  return apiCall(`/ai/leaderboard?subject=${encodeURIComponent(subject)}`);
}

export async function getTasksDashboard() {
  return apiCall('/tasks/dashboard');
}

export async function submitHomeTask(taskId) {
  return apiCall('/tasks/submit', { method: 'POST', body: JSON.stringify({ taskId }) });
}
