const db = require('../db/db');

const parseId = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getAccessibleChildForProgress = async (childId, user) => {
    if (user.role === 'parent') {
        const result = await db.query(
            'SELECT id FROM children WHERE id = $1 AND parent_id = $2',
            [childId, user.id]
        );
        return result.rows[0] || null;
    }

    if (user.role === 'teacher') {
        const result = await db.query(
            `SELECT c.id
             FROM children c
             JOIN employees e ON e.user_id = $2
             WHERE c.id = $1
               AND c.grade = ANY(e.grades_taught)
               AND EXISTS (
                   SELECT 1
                   FROM unnest(c.subjects) AS child_subject(name)
                   JOIN unnest(e.subjects) AS teacher_subject(name)
                     ON LOWER(child_subject.name) = LOWER(teacher_subject.name)
               )
             LIMIT 1`,
            [childId, user.id]
        );
        return result.rows[0] || null;
    }

    return null;
};

const teacherCanAssessSubject = async (childId, teacherId, subject) => {
    const result = await db.query(
        `SELECT c.id, e.id AS employee_id
         FROM children c
         JOIN employees e ON e.user_id = $2
         WHERE c.id = $1
           AND c.grade = ANY(e.grades_taught)
           AND EXISTS (
               SELECT 1 FROM unnest(c.subjects) AS child_subject(name)
               WHERE LOWER(child_subject.name) = LOWER($3)
           )
           AND EXISTS (
               SELECT 1 FROM unnest(e.subjects) AS teacher_subject(name)
               WHERE LOWER(teacher_subject.name) = LOWER($3)
           )
         LIMIT 1`,
        [childId, teacherId, subject]
    );
    return result.rows[0] || null;
};

exports.getLearnerProgress = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT p.id, p.subject, p.grade, p.grade as score, p.grade as percentage, 
              p.notes, p.notes as insight, p.notes as aiInsight, p.date, p.term, p.time_taken_seconds 
       FROM progress p JOIN children c ON p.child_id = c.id 
       WHERE c.learner_user_id = $1 ORDER BY p.date DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getChildProgress = async (req, res) => {
    const childId = parseId(req.params.childId);
    if (!childId) return res.status(400).json({ error: 'Invalid child ID' });

    try {
        const accessibleChild = await getAccessibleChildForProgress(childId, req.user);
        if (!accessibleChild) {
            return res.status(403).json({ error: 'You do not have access to this learner progress' });
        }

        if (req.user.role === 'teacher') {
            const result = await db.query(
                `SELECT p.id, p.subject, p.grade, p.grade as score, p.grade as percentage,
                  p.notes, p.notes as insight, p.notes as aiInsight, p.date, p.term, p.time_taken_seconds
                 FROM progress p
                 JOIN children c ON c.id = p.child_id
                 JOIN employees e ON e.user_id = $2
                 WHERE p.child_id = $1
                   AND c.grade = ANY(e.grades_taught)
                   AND EXISTS (
                       SELECT 1 FROM unnest(e.subjects) AS teacher_subject(name)
                       WHERE LOWER(teacher_subject.name) = LOWER(p.subject)
                   )
                 ORDER BY p.date DESC`,
                [childId, req.user.id]
            );
            return res.json(result.rows);
        }

        const result = await db.query(
            `SELECT id, subject, grade, grade as score, grade as percentage, 
              notes, notes as insight, notes as aiInsight, date, term, time_taken_seconds 
       FROM progress WHERE child_id = $1 ORDER BY date DESC`,
            [childId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.addProgress = async (req, res) => {
    const { child_id, subject, grade, notes, term } = req.body;
    const childId = parseId(child_id);
    if (!childId) return res.status(400).json({ error: 'Invalid child ID' });
    if (!subject || typeof subject !== 'string') return res.status(400).json({ error: 'Subject is required' });

    try {
        const access = await teacherCanAssessSubject(childId, req.user.id, subject);
        if (!access) {
            return res.status(403).json({ error: 'You can only add progress for learners and subjects assigned to you' });
        }

        const result = await db.query(
            'INSERT INTO progress (child_id, subject, grade, notes, term, employee_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [childId, subject, grade, notes, term || 'Term 1', access.employee_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};
