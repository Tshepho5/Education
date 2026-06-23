const db = require('../db/db'); // Points to the single source of truth in the db folder

const parseTaskId = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getLearnerDashboardTasks = async (req, res) => {
    const learnerId = req.user.id;

    try {
        const learner = await db.query(
            'SELECT grade, stream, subjects FROM children WHERE learner_user_id = $1',
            [learnerId]
        );

        if (learner.rows.length === 0) {
            return res.status(404).json({ error: 'Learner profile not found' });
        }

        const { grade, stream, subjects } = learner.rows[0];
        const query = `
            SELECT 
                t.id,
                t.title,
                t.description,
                t.subject,
                t.grade,
                t.stream,
                t.due_date,
                t.task_type,
                t.content,
                t.created_at,
                CASE WHEN s.id IS NOT NULL THEN true ELSE false END as is_submitted,
                s.submitted_at,
                s.status AS submission_status
            FROM tasks t
            LEFT JOIN submissions s ON t.id = s.task_id AND s.learner_id = $4
            WHERE t.is_active = TRUE
              AND (t.grade IS NULL OR t.grade = $1)
              AND (t.stream IS NULL OR t.stream = 'General' OR t.stream = $2)
              AND (t.subject IS NULL OR t.subject = ANY($3::text[]))
            ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC;
        `;
        
        const { rows } = await db.query(query, [grade, stream, subjects, learnerId]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

const submitTask = async (req, res) => {
    const { taskId, content } = req.body;
    const learnerId = req.user.id;
    const parsedTaskId = parseTaskId(taskId);

    if (!parsedTaskId) {
        return res.status(400).json({ error: 'Invalid task ID' });
    }

    try {
        const learner = await db.query(
            'SELECT grade, stream, subjects FROM children WHERE learner_user_id = $1',
            [learnerId]
        );

        if (learner.rows.length === 0) {
            return res.status(404).json({ error: 'Learner profile not found' });
        }

        const { grade, stream, subjects } = learner.rows[0];
        const task = await db.query(
            `SELECT id
             FROM tasks
             WHERE id = $1
               AND is_active = TRUE
               AND (grade IS NULL OR grade = $2)
               AND (stream IS NULL OR stream = 'General' OR stream = $3)
               AND (subject IS NULL OR subject = ANY($4::text[]))
             LIMIT 1`,
            [parsedTaskId, grade, stream, subjects]
        );

        if (task.rows.length === 0) {
            return res.status(403).json({ error: 'You do not have access to this task' });
        }

        await db.query(
            `INSERT INTO submissions (task_id, learner_id, content)
             VALUES ($1, $2, $3)
             ON CONFLICT (task_id, learner_id)
             DO UPDATE SET content = EXCLUDED.content, submitted_at = CURRENT_TIMESTAMP, status = 'submitted'`,
            [parsedTaskId, learnerId, content || 'Task attempted']
        );
        res.status(200).json({ message: 'Task submitted successfully' });
    } catch (error) {
        console.error('Error submitting task:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { getLearnerDashboardTasks, submitTask };
